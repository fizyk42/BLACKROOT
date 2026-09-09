/**
 * Co-op with no server — the case that produced "Could not reach the server."
 *
 * There is deliberately no `server.mjs` running anywhere in this test. Two
 * browser windows open the game, one hosts, the other joins with the code it
 * was given, and the assertions are the same ones the networked suite makes:
 * same seed, same terrain, each sees the other move, chat and marks arrive,
 * a downed player can be picked up.
 *
 * It also checks the thing that was actually wrong before: that a player who
 * simply presses HOST with no server anywhere ends up in a working game rather
 * than at a dead end.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8557;
const DEAD = 'ws://127.0.0.1:59998/net';      // nothing is listening here, ever
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0; const failures = [];
const check = (l, ok, d = '') => {
  if (ok) { pass++; console.log(` PASS  ${l}${d ? '   ' + d : ''}`); }
  else { fail++; failures.push(l); console.log(` FAIL  ${l}${d ? '   ' + d : ''}`); }
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    await stat(f);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404).end('x'); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
// One browser context, because "the same computer" is the whole premise: the
// windows have to share an origin to share a message bus.
const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });

async function client(name) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state === "MENU"', null, { timeout: 45000 });
  await page.evaluate((n) => {
    const S = window.BLACKROOT.settings;
    S.applyPreset('low'); S.set('renderScale', 0.14); S.set('viewDistance', 60);
    S.set('foliage', 0.14); S.set('shadows', 'off');
    window.BLACKROOT.net.setName(n);
  }, name);
  return { page, errors };
}

const A = await client('ALPHA');
const B = await client('BRAVO');

const waitFor = (c, fn, arg, ms = 20000) =>
  c.page.waitForFunction(fn, arg, { timeout: ms, polling: 120 }).then(() => true).catch(() => false);

/* ================= 1. pressing HOST with no server anywhere ================= */

const hosted = await A.page.evaluate(async (url) => {
  const g = window.BLACKROOT;
  const seed = 0xBEEF;
  const t0 = Date.now();
  const ok = await g.net.host(url, { seed, route: g.routeFor(seed) });
  return {
    ok, ms: Date.now() - t0, code: g.net.code, isLocal: g.net.isLocal,
    err: g.net.error, state: g.net.state, seed: g.net.world?.seed,
  };
}, DEAD);

check('Hosting with no server anywhere still gives you a game', hosted.ok === true,
  hosted.err || `state ${hosted.state}`);
check('  …with a real six-character code', /^[A-Z0-9]{6}$/.test(hosted.code || ''), hosted.code);
check('  …running on this computer rather than a server', hosted.isLocal === true);
check('  …and it does not sit there for ten seconds first', hosted.ms < 15000, `${(hosted.ms / 1000).toFixed(1)}s`);
check('  …carrying the seed the host chose', hosted.seed === 0xBEEF);

const told = await A.page.evaluate(() =>
  Array.from(document.querySelectorAll('#co-chatlog div')).map((e) => e.textContent).join(' | '));
check('  …and the player is told what that means', /this computer/i.test(told), told.slice(0, 120));

/* ================= 2. the second window joins by code ================= */

const seen = await B.page.evaluate((code) => window.BLACKROOT.net.localRooms().includes(code), hosted.code);
check('The other window can see the code being hosted here', seen,
  await B.page.evaluate(() => window.BLACKROOT.net.localRooms().join(', ') || 'none'));

const joined = await B.page.evaluate(async ({ url, code }) => {
  const g = window.BLACKROOT;
  const ok = await g.net.join(url, code, { local: g.net.localRooms().includes(code) });
  return { ok, err: g.net.error, code: g.net.code, isLocal: g.net.isLocal, seed: g.net.world?.seed, route: g.net.world?.route };
}, { url: DEAD, code: hosted.code });

check('The same code joins the same game', joined.ok && joined.code === hosted.code, joined.err || joined.code);
check('  …with the same seed', joined.seed === 0xBEEF);
check('  …and the same road through the biomes',
  joined.route.join(',') === await A.page.evaluate(() => window.BLACKROOT.net.world.route.join(',')),
  joined.route.join(','));

check('The host is told somebody joined', await waitFor(A, 'window.BLACKROOT.net.roster.size === 1'),
  await A.page.evaluate(() => [...window.BLACKROOT.net.roster.values()].map((p) => p.name).join(', ')));

const wrong = await B.page.evaluate(async (url) => {
  const g = window.BLACKROOT;
  const ok = await g.net.join(url, 'ZZZZZZ', { local: true });
  const err = g.net.error;
  return { ok, err };
}, DEAD);
check('A code nobody is hosting says so, and says what to do', wrong.ok === false && /ZZZZZZ/.test(wrong.err),
  wrong.err);
check('  …and mentions the server for friends elsewhere', /server/i.test(wrong.err));

// Re-join for the rest of the test.
await B.page.evaluate(async ({ url, code }) => {
  await window.BLACKROOT.net.join(url, code, { local: true });
}, { url: DEAD, code: hosted.code });
await waitFor(A, 'window.BLACKROOT.net.roster.size === 1');

/* ================= 3. it is a real shared game ================= */

await A.page.evaluate(() => window.BLACKROOT.startCoop());
await A.page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 120000 });
await B.page.evaluate(() => window.BLACKROOT.startCoop());
await B.page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 120000 });

const worlds = await Promise.all([A, B].map((c) => c.page.evaluate(() => {
  const g = window.BLACKROOT, t = g.world.terrain;
  return {
    biome: g.biomeId,
    probe: [[0, 0], [120, -80], [-240, 310]].map(([x, z]) => Math.round(t.heightAt(x, z) * 100) / 100).join(','),
    landmarks: g.world.landmarks.length,
  };
})));
check('Both windows generated the identical world',
  worlds[0].probe === worlds[1].probe && worlds[0].landmarks === worlds[1].landmarks,
  `${worlds[0].biome} · ${worlds[0].probe}`);

check('Each sees the other as a figure in the world',
  await waitFor(A, 'window.BLACKROOT.net.players.size === 1')
  && await waitFor(B, 'window.BLACKROOT.net.players.size === 1'));

const before = await B.page.evaluate(() => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  return p ? { x: p.group.position.x, z: p.group.position.z } : null;
});
await A.page.evaluate(async () => {
  const g = window.BLACKROOT;
  for (let i = 0; i < 20; i++) {
    g.player.position.x += 2.0; g.player.position.z -= 1.25;
    g.player.position.y = g.world.terrain.heightAt(g.player.position.x, g.player.position.z) + 0.1;
    await new Promise((r) => setTimeout(r, 90));
  }
});
const moved = await waitFor(B, ({ x, z }) => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  return p && Math.hypot(p.group.position.x - x, p.group.position.z - z) > 25;
}, before, 15000);
check('  …and sees them walk', moved);

await A.page.evaluate(() => window.BLACKROOT.net.say('behind the rocks'));
check('Chat crosses between the windows',
  await waitFor(B, 'window.BLACKROOT.net.chat.some((c) => c.m === "behind the rocks")'));

await A.page.evaluate(() => {
  const g = window.BLACKROOT;
  g.net.ping({ x: g.player.position.x + 30, y: g.player.position.y, z: g.player.position.z }, 'over here');
});
check('  …so do map marks',
  await waitFor(B, 'window.BLACKROOT.waypoints.list.some((w) => w.kind === "squad")'));

await B.page.evaluate(() => {
  const g = window.BLACKROOT;
  g.stats.health = 0; g.stats.dead = true; g.stats.causeOfDeath = 'a stalker';
});
const down = await waitFor(A, () => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  return p && p.down === true;
}, null, 15000);
check('A player who dies goes down in front of the squad', down);

await A.page.evaluate(() => {
  const p = [...window.BLACKROOT.net.players.values()][0];
  if (p) window.BLACKROOT.net.revive(p.id, 40);
});
check('  …and can be picked back up',
  await waitFor(B, 'window.BLACKROOT.state === "PLAYING" && window.BLACKROOT.stats.health > 30'),
  await B.page.evaluate(() => `${Math.round(window.BLACKROOT.stats.health)} hp`));

/* ================= 4. closing the host window ================= */

await B.page.evaluate(() => { window.__left = false; window.BLACKROOT.net.on('notice', (m) => { if (/left|lost|Connection/i.test(m)) window.__left = true; }); });
await A.page.close();
const survived = await B.page.evaluate(async () => {
  const g = window.BLACKROOT;
  const frames0 = g.rafCount;
  await new Promise((r) => setTimeout(r, 1500));
  return { state: g.state, running: g.rafCount > frames0 };
});
check('Closing the host window does not take the other one down',
  survived.state === 'PLAYING' && survived.running, `game ${survived.state}`);
check('No page errors in the guest', B.errors.length === 0, B.errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log('\n================================================================');
console.log(`  ${pass}/${pass + fail} server-less co-op checks passed`);
if (fail) { console.log('  FAILURES:'); for (const f of failures) console.log('   · ' + f); }
console.log('================================================================');
process.exit(fail ? 1 : 0);
