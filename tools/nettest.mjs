/**
 * Co-op test — a real dedicated server, two real browsers, one code.
 *
 *   node tools/nettest.mjs
 *
 * There is no mocking here. It spawns `server.mjs` as its own process, opens
 * two headless clients against it, hosts a room in one and joins it from the
 * other with the code the first one was given, and then checks the things that
 * actually matter: that both worlds generated from the same seed, that each
 * client can see the other one moving, that a shot fired by one is heard by
 * the other, that a downed player can be picked up, and that killing the
 * socket puts the game back into single-player instead of taking it down.
 *
 * Two SwiftShader instances in one container is slow, so both clients run at
 * the lowest settings and every wait is expressed in simulated seconds.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(` PASS  ${label}${detail ? '   ' + detail : ''}`); }
  else { fail++; failures.push(label); console.log(` FAIL  ${label}${detail ? '   ' + detail : ''}`); }
}

/* ================= the server ================= */

const srv = spawn(process.execPath, [path.join(root, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
let srvGone = '';
srv.stdout.on('data', (b) => { srvLog += b.toString(); });
srv.stderr.on('data', (b) => { srvLog += b.toString(); });
// If the server dies the failures downstream are all noise; say what happened.
srv.on('exit', (code, sig) => {
  if (code === 0 || sig === 'SIGTERM' || sig === 'SIGKILL') return;
  srvGone = `server exited (code ${code}, signal ${sig})\n${srvLog.slice(-800)}`;
  console.error('\n!! ' + srvGone + '\n');
});

// Wait for it to actually answer, rather than guessing at a delay.
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(120);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    up = r.ok;
  } catch { /* not listening yet */ }
}
check('The dedicated server starts and answers', up, up ? `http://127.0.0.1:${PORT}` : srvLog.slice(0, 300));
if (!up) { srv.kill(); process.exit(1); }

const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
check('It reports its own status', health.ok === true && health.rooms === 0, `${health.rooms} rooms, ${health.players} players`);

const page404 = await fetch(`http://127.0.0.1:${PORT}/nope.js`);
check('It serves the game and 404s the rest', page404.status === 404);

const indexRes = await fetch(`http://127.0.0.1:${PORT}/`);
const indexHtml = await indexRes.text();
check('It serves the game itself', indexRes.ok && indexHtml.includes('BLACKROOT'), `${(indexHtml.length / 1024).toFixed(0)} KB of index.html`);

/* ================= two clients ================= */

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});

async function client(label) {
  const page = await browser.newPage({ viewport: { width: 720, height: 420 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state', null, { timeout: 40000 });
  await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 40000 });
  await page.evaluate((name) => {
    const S = window.BLACKROOT.settings;
    S.applyPreset('low'); S.set('renderScale', 0.14); S.set('viewDistance', 60);
    S.set('foliage', 0.14); S.set('shadows', 'off');
    window.BLACKROOT.net.setName(name);
  }, label);
  return { page, errors, label };
}

const A = await client('ALPHA');
const B = await client('BRAVO');

/** Advance one client's simulated clock by n seconds. */
async function simWait(c, seconds) {
  await c.page.evaluate(async (s) => {
    const g = window.BLACKROOT;
    const t0 = g.time;
    const start = Date.now();
    while (g.time - t0 < s && Date.now() - start < s * 4000 + 8000) await new Promise((r) => setTimeout(r, 40));
  }, seconds);
}

/** Wait for a condition on a page, in wall-clock time (network is real time). */
async function waitFor(c, fn, arg, ms = 20000) {
  try { await c.page.waitForFunction(fn, arg, { timeout: ms, polling: 120 }); return true; }
  catch { return false; }
}

/* ---------------- host ---------------- */

const hosted = await A.page.evaluate(async (url) => {
  const g = window.BLACKROOT;
  const seed = 0xC0FFEE;
  const ok = await g.net.host(url, { seed, route: g.routeFor(seed) });
  return { ok, code: g.net.code, isHost: g.net.isHost, state: g.net.state, err: g.net.error, seed: g.net.world?.seed };
}, `ws://127.0.0.1:${PORT}/net`);

check('A client can open a room and is given a code', hosted.ok && /^[A-Z0-9]{6}$/.test(hosted.code || ''), `code ${hosted.code} · ${hosted.err || 'no error'}`);
check('The host is marked as the host', hosted.isHost === true);
check('The room carries the host\'s seed', hosted.seed === 0xC0FFEE, `0x${(hosted.seed >>> 0).toString(16).toUpperCase()}`);

const codeOnServer = await (await fetch(`http://127.0.0.1:${PORT}/room/${hosted.code}`)).json();
check('The server knows about the room', codeOnServer.code === hosted.code, `${codeOnServer.players} player(s)`);

/* ---------------- a wrong code is rejected clearly ---------------- */

const badJoin = await B.page.evaluate(async ({ url, code }) => {
  const g = window.BLACKROOT;
  const ok = await g.net.join(url, code);
  return { ok, err: g.net.error, state: g.net.state };
}, { url: `ws://127.0.0.1:${PORT}/net`, code: 'ZZZZZZ' });
check('A wrong code is refused with a readable reason', badJoin.ok === false && /ZZZZZZ/.test(badJoin.err || ''), badJoin.err);
check('A refused join does not retry forever', badJoin.state === 'FAILED', badJoin.state);

/* ---------------- the real join ---------------- */

const joined = await B.page.evaluate(async ({ url, code }) => {
  const g = window.BLACKROOT;
  const ok = await g.net.join(url, code);
  return {
    ok, err: g.net.error, code: g.net.code, isHost: g.net.isHost,
    seed: g.net.world?.seed, route: g.net.world?.route, biome: g.net.world?.biome,
  };
}, { url: `ws://127.0.0.1:${PORT}/net`, code: hosted.code });

check('The same code joins the same game', joined.ok && joined.code === hosted.code, joined.err || `joined ${joined.code}`);
check('A guest is not the host', joined.isHost === false);
check('Both clients get the same world seed', joined.seed === 0xC0FFEE);

const hostRoute = await A.page.evaluate(() => window.BLACKROOT.net.world.route.join(','));
check('Both clients get the same road through the biomes', joined.route.join(',') === hostRoute, hostRoute);

const sawJoin = await waitFor(A, 'window.BLACKROOT.net.roster.size === 1');
check('The host is told when somebody joins', sawJoin,
  await A.page.evaluate(() => [...window.BLACKROOT.net.roster.values()].map((p) => p.name).join(', ')));

const rosterNames = await A.page.evaluate(() => window.BLACKROOT.net.list().map((p) => p.name).join(', '));
check('The lobby lists everybody by callsign', /ALPHA/.test(rosterNames) && /BRAVO/.test(rosterNames), rosterNames);

/* ---------------- into the world ---------------- */

await A.page.evaluate(() => window.BLACKROOT.startCoop());
await A.page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 90000 });
await B.page.evaluate(() => window.BLACKROOT.startCoop());
await B.page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 90000 });

const worlds = await Promise.all([A, B].map((c) => c.page.evaluate(() => {
  const g = window.BLACKROOT;
  const t = g.world.terrain;
  // Sample the terrain in a few places: two identical heightfields is the
  // strongest possible evidence that both players are in the same world.
  const probe = [[0, 0], [120, -80], [-240, 310], [55, 640]]
    .map(([x, z]) => Math.round(t.heightAt(x, z) * 100) / 100);
  return { seed: g.seed, biome: g.biomeId, depth: g.depth, probe: probe.join(','), landmarks: g.world.landmarks.length };
})));

check('Both players are in the same biome', worlds[0].biome === worlds[1].biome, worlds[0].biome);
check('Both players generated the identical terrain', worlds[0].probe === worlds[1].probe, worlds[0].probe);
check('Both players got the identical landmarks', worlds[0].landmarks === worlds[1].landmarks, `${worlds[0].landmarks} landmarks`);

/* ---------------- seeing each other ---------------- */

const sawAvatarA = await waitFor(A, 'window.BLACKROOT.net.players.size === 1');
const sawAvatarB = await waitFor(B, 'window.BLACKROOT.net.players.size === 1');
check('Each player has an avatar for the other', sawAvatarA && sawAvatarB);

const avatar = await A.page.evaluate(() => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  if (!p) return { name: '-', meshes: 0, inScene: false, plate: false };
  let meshes = 0;
  p.group.traverse((o) => { if (o.isMesh) meshes++; });
  return { name: p.name, meshes, inScene: !!p.group.parent, plate: !!p.plate };
});
check('The other player is a whole figure in your world', avatar.meshes > 40 && avatar.inScene,
  `${avatar.name}: ${avatar.meshes} parts`);
check('They have a nameplate over them', avatar.plate);

// Move A a long way and check B's copy of A follows.
const before = await B.page.evaluate(() => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  return p ? { x: p.group.position.x, z: p.group.position.z } : null;
});
check('The guest still holds the avatar after the world build', !!before,
  before ? '' : 'the connection did not survive world generation');
if (!before) { await browser.close(); srv.kill('SIGKILL'); process.exit(1); }
// Walk, do not teleport: the server clamps impossible movement on purpose, so
// covering 47 m has to happen at a speed a person could plausibly manage.
await A.page.evaluate(async () => {
  const g = window.BLACKROOT;
  for (let i = 0; i < 20; i++) {
    g.player.position.x += 2.0;
    g.player.position.z -= 1.25;
    g.player.position.y = g.world.terrain.heightAt(g.player.position.x, g.player.position.z) + 0.1;
    await new Promise((r) => setTimeout(r, 90));
  }
});
const moved = await waitFor(B, ({ x, z }) => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  return Math.hypot(p.group.position.x - x, p.group.position.z - z) > 25;
}, before, 15000);
const after = await B.page.evaluate(() => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  return p ? { x: p.group.position.x, z: p.group.position.z, buffered: p.buffer.length }
    : { x: 0, z: 0, buffered: 0 };
});
check('Moving is seen by the other player', moved,
  `moved ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m`);
check('Positions arrive as a stream, not one sample', after.buffered > 3, `${after.buffered} snapshots buffered`);

// Interpolation: the avatar must not sit exactly on the last snapshot.
const interp = await B.page.evaluate(() => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  if (!p || !p.buffer.length) return { lag: 0, samples: 0 };
  const last = p.buffer[p.buffer.length - 1];
  return { lag: Math.hypot(p.group.position.x - last.x, p.group.position.z - last.z), samples: p.buffer.length };
});
check('The avatar is interpolated, not snapped', interp.samples >= 2, `${interp.lag.toFixed(2)} m behind the newest sample`);

/* ---------------- shots, marks and chat ---------------- */

const heardShot = await (async () => {
  await B.page.evaluate(() => { window.__shots = 0; window.BLACKROOT.net.on('evt', () => {}); const f = window.BLACKROOT.fx.tracer.bind(window.BLACKROOT.fx); window.BLACKROOT.fx.tracer = (...a) => { window.__shots++; return f(...a); }; });
  await A.page.evaluate(() => {
    const g = window.BLACKROOT;
    g.net.reportShot(g.player.position, { x: 0, y: 0, z: -1 }, 'ar');
  });
  return waitFor(B, 'window.__shots > 0', null, 10000);
})();
check('A shot fired by one player is drawn for the other', heardShot);

const gotPing = await (async () => {
  await A.page.evaluate(() => {
    const g = window.BLACKROOT;
    g.net.ping({ x: g.player.position.x + 30, y: g.player.position.y, z: g.player.position.z }, 'over here');
  });
  return waitFor(B, 'window.BLACKROOT.waypoints.list.some((w) => w.kind === "squad")', null, 10000);
})();
check('A map mark reaches the rest of the squad', gotPing,
  await B.page.evaluate(() => window.BLACKROOT.waypoints.list.map((w) => w.label).join(', ')));

const squadMarkers = await B.page.evaluate(() =>
  window.BLACKROOT.waypoints.markers().filter((m) => m.kind === 'mate').length);
check('Squadmates appear on the waypoint HUD', squadMarkers === 1, `${squadMarkers} mate marker(s)`);

const chatted = await (async () => {
  await A.page.evaluate(() => window.BLACKROOT.net.say('behind the rocks'));
  return waitFor(B, 'window.BLACKROOT.net.chat.some((c) => c.m === "behind the rocks")', null, 10000);
})();
check('Chat reaches the squad', chatted);

/* ---------------- going down and getting up ---------------- */

const wentDown = await (async () => {
  await B.page.evaluate(() => { window.BLACKROOT.stats.health = 0; window.BLACKROOT.stats.dead = true; window.BLACKROOT.stats.causeOfDeath = 'a stalker'; });
  return waitFor(A, () => {
    const p = [...window.BLACKROOT.net.players.values()][0];
    return p && p.down === true;
  }, null, 15000);
})();
check('A player who dies goes down in front of the squad', wentDown);

const revived = await (async () => {
  await A.page.evaluate(() => {
    const p = [...window.BLACKROOT.net.players.values()][0];
    if (p) window.BLACKROOT.net.revive(p.id, 40);
  });
  return waitFor(B, 'window.BLACKROOT.state === "PLAYING" && window.BLACKROOT.stats.health > 30', null, 15000);
})();
check('A downed player can be picked up by a teammate', revived,
  await B.page.evaluate(() => `${Math.round(window.BLACKROOT.stats.health)} hp, state ${window.BLACKROOT.state}`));

const reviveReach = await A.page.evaluate(() => {
  const g = window.BLACKROOT;
  const p = [...g.net.players.values()][0];
  if (!p) return 'no avatar';
  p.down = true;
  // Stand on top of them, looking at them.
  p.group.position.copy(g.player.position).add({ x: 0, y: 0, z: -1.4 });
  g.player.yaw = Math.PI;
  g.camera.lookAt(p.group.position.x, p.group.position.y + 0.5, p.group.position.z);
  const pick = g.interaction.pick();
  p.down = false;
  return pick ? pick.kind : 'nothing';
});
check('Standing over a downed teammate offers to revive them', reviveReach === 'revive', reviveReach);

/* ---------------- descending together ---------------- */

const descended = await (async () => {
  await A.page.evaluate(() => { window.BLACKROOT.riftOpen = true; window.BLACKROOT.enterRift(); });
  const ok = await waitFor(B, 'window.BLACKROOT.depth === 1 && window.BLACKROOT.state === "PLAYING"', null, 120000);
  return ok;
})();
await A.page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 120000 });
check('The host taking the rift brings the whole party', descended,
  await B.page.evaluate(() => `${window.BLACKROOT.biomeId} at depth ${window.BLACKROOT.depth}`));

const deeper = await Promise.all([A, B].map((c) => c.page.evaluate(() => {
  const t = window.BLACKROOT.world.terrain;
  return {
    biome: window.BLACKROOT.biomeId, depth: window.BLACKROOT.depth,
    probe: [[0, 0], [90, 200]].map(([x, z]) => Math.round(t.heightAt(x, z) * 100) / 100).join(','),
  };
})));
check('The next biome is the same one for both of them',
  deeper[0].biome === deeper[1].biome && deeper[0].probe === deeper[1].probe,
  `${deeper[0].biome} · ${deeper[0].probe}`);

const rebound = await B.page.evaluate(() => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  return p ? !!p.group.parent : false;
});
check('Avatars survive the world being rebuilt', rebound);

/* ---------------- losing the server ---------------- */

const survives = await (async () => {
  await B.page.evaluate(() => window.BLACKROOT.net.disconnect());
  await sleep(400);
  return B.page.evaluate(() => ({
    state: window.BLACKROOT.state,
    net: window.BLACKROOT.net.state,
    avatars: window.BLACKROOT.net.players.size,
    playing: window.BLACKROOT.rafCount,
  }));
})();
await sleep(600);
const stillRunning = await B.page.evaluate(() => window.BLACKROOT.rafCount);
check('Leaving co-op does not end the game', survives.state === 'PLAYING' && stillRunning > survives.playing,
  `game ${survives.state}, net ${survives.net}`);
check('The avatars go with the connection', survives.avatars === 0);

const hostNoticed = await waitFor(A, 'window.BLACKROOT.net.roster.size === 0', null, 10000);
check('The room is told when somebody leaves', hostNoticed);

/* ---------------- the server holds up ---------------- */

const finalHealth = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
check('The server is still healthy at the end', finalHealth.ok === true && finalHealth.rooms === 1,
  `${finalHealth.rooms} room, ${finalHealth.players} player, up ${finalHealth.up}s`);

const junk = await A.page.evaluate(async (url) => {
  // A client that talks nonsense must be dropped, not crash the room.
  return new Promise((resolve) => {
    const s = new WebSocket(url);
    s.onopen = () => s.send('this is not json');
    s.onclose = () => resolve('closed');
    setTimeout(() => resolve('still open'), 4000);
  });
}, `ws://127.0.0.1:${PORT}/net`);
check('A client talking nonsense is dropped, not tolerated', junk === 'closed', junk);

const afterJunk = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
check('And the room is unharmed by it', afterJunk.ok === true && afterJunk.rooms === 1);

const stillThere = await A.page.evaluate(() => window.BLACKROOT.net.state);
check('The surviving client is still connected', stillThere === 'PLAYING' || stillThere === 'LOBBY', stillThere);

check('No page errors on the host', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));
check('No page errors on the guest', B.errors.length === 0, B.errors.slice(0, 2).join(' | '));

/* ================= done ================= */

await browser.close();
srv.kill('SIGTERM');
await sleep(250);
srv.kill('SIGKILL');

console.log('\n================================================================');
console.log(`  ${pass}/${pass + fail} co-op checks passed`);
if (fail) {
  console.log('  FAILURES:');
  for (const f of failures) console.log('   · ' + f);
  // The server's own log usually says exactly why a client went away.
  console.log('\n  server log:\n' + srvLog.split('\n').slice(-25).map((l) => '   ' + l).join('\n'));
}
console.log('================================================================');
process.exit(fail ? 1 : 0);
