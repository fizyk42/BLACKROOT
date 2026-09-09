/**
 * Controller test.
 *
 * Playwright cannot emulate a physical gamepad, so this injects a virtual one
 * by overriding navigator.getGamepads() before the page scripts run. Everything
 * downstream — detection, deadzones, the CoD button layout, aim assist, menu
 * navigation — is then exercised for real.
 *
 *   node tools/padtest.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8477;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
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
const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));

// ---- virtual DualSense, installed before any page script runs ----
await page.addInitScript(() => {
  const pad = {
    id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
    index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: { playEffect: () => Promise.resolve('complete'), reset: () => Promise.resolve() },
  };
  window.__vpad = {
    pad,
    set(axes, buttons) {
      if (axes) for (const [i, v] of Object.entries(axes)) pad.axes[i] = v;
      if (buttons) for (const [i, v] of Object.entries(buttons)) {
        pad.buttons[i] = { pressed: v > 0.5, touched: v > 0.1, value: v };
      }
      pad.timestamp = performance.now();
    },
    clear() {
      pad.axes = [0, 0, 0, 0];
      pad.buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    },
    connect() {
      window.dispatchEvent(new CustomEvent('gamepadconnected'));
      // the real event carries .gamepad, so fake that shape too
      const ev = new Event('gamepadconnected');
      ev.gamepad = pad;
      window.dispatchEvent(ev);
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
});

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(220); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });

await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low');
  S.set('renderScale', 0.1); S.set('viewDistance', 70);
  S.set('foliage', 0.3); S.set('shadows', 'off');
});

// ---- detection ----
await page.evaluate(() => window.__vpad.connect());
await sleep(400);
const det = await page.evaluate(() => {
  const P = window.BLACKROOT.padDebug;
  return { connected: P.connected, brand: P.brand, id: P.id.slice(0, 24) };
});
check('Controller is detected', det.connected, det.id);
check('DualSense identified as PlayStation', det.brand === 'playstation', `brand=${det.brand}`);

const glyphs = await page.evaluate(() => {
  const P = window.BLACKROOT.padDebug;
  return { use: P.glyphFor('use'), jump: P.glyphFor('jump'), fire: P.glyphFor('fire') };
});
check('PlayStation glyphs used', glyphs.use === '□' && glyphs.jump === '✕',
  `use=${glyphs.use} jump=${glyphs.jump} fire=${glyphs.fire}`);

// ---- into the game ----
await page.evaluate(() => window.BLACKROOT.startNewGame(0x1234abcd));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 200000 });
await sleep(1200);

const simWait = (s) => page.evaluate(async (sec) => {
  const g = window.BLACKROOT; const t0 = g.time;
  const deadline = performance.now() + sec * 14000 + 4000;
  while (g.time - t0 < sec && performance.now() < deadline) await new Promise((r) => setTimeout(r, 40));
}, s);

// ---- left stick moves ----
const move = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const p0 = { x: g.player.position.x, z: g.player.position.z };
  window.__vpad.set({ 1: -1 });                 // left stick fully forward
  const t0 = g.time;
  let peak = 0;
  while (g.time - t0 < 1.2) {
    await new Promise((r) => setTimeout(r, 40));
    peak = Math.max(peak, Math.hypot(g.player.velocity.x, g.player.velocity.z));
  }
  window.__vpad.clear();
  const moved = Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z);
  return { moved, peak };
});
check('Left stick moves the player', move.moved > 0.8, `${move.moved.toFixed(2)} m, peak ${move.peak.toFixed(2)} m/s`);

// ---- analog walk: half deflection is slower than full ----
const analog = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const speedAt = async (v) => {
    g.stats.stamina = 100;
    window.__vpad.set({ 1: v });
    const t0 = g.time; let peak = 0;
    while (g.time - t0 < 1.1) { await new Promise((r) => setTimeout(r, 40)); peak = Math.max(peak, Math.hypot(g.player.velocity.x, g.player.velocity.z)); }
    window.__vpad.clear();
    const t1 = g.time; while (g.time - t1 < 0.4) await new Promise((r) => setTimeout(r, 40));
    return peak;
  };
  const half = await speedAt(-0.45);
  const full = await speedAt(-1);
  return { half, full };
});
check('Stick deflection is analog, not on/off', analog.half < analog.full * 0.85,
  `half ${analog.half.toFixed(2)} m/s vs full ${analog.full.toFixed(2)} m/s`);

// ---- deadzone ----
const dz = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  window.__vpad.set({ 1: -0.06 });              // inside the deadzone
  const t0 = g.time; let peak = 0;
  while (g.time - t0 < 0.7) { await new Promise((r) => setTimeout(r, 40)); peak = Math.max(peak, Math.hypot(g.player.velocity.x, g.player.velocity.z)); }
  window.__vpad.clear();
  return peak;
});
check('Deadzone rejects stick drift', dz < 0.05, `peak ${dz.toFixed(3)} m/s inside deadzone`);

// ---- right stick looks ----
const look = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const y0 = g.player.yaw, p0 = g.player.pitch;
  window.__vpad.set({ 2: 1 });                  // right stick right
  let t0 = g.time; while (g.time - t0 < 1.0) await new Promise((r) => setTimeout(r, 40));
  const y1 = g.player.yaw;
  window.__vpad.clear();
  window.__vpad.set({ 3: -1 });                 // right stick up
  t0 = g.time; while (g.time - t0 < 0.8) await new Promise((r) => setTimeout(r, 40));
  const p1 = g.player.pitch;
  window.__vpad.clear();
  return { dyaw: y1 - y0, dpitch: p1 - p0 };
});
check('Right stick turns the camera', Math.abs(look.dyaw) > 0.4, `${look.dyaw.toFixed(2)} rad yaw`);
check('Right stick pitches the camera up', look.dpitch > 0.15, `${look.dpitch.toFixed(2)} rad pitch`);

// ---- triggers ----
const trig = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.weapons.mags.set('pistol9', 15);
  const mag0 = g.weapons.magazine;
  window.__vpad.set(null, { 7: 1.0 });          // R2 fire
  let t0 = g.time; while (g.time - t0 < 0.6) await new Promise((r) => setTimeout(r, 30));
  window.__vpad.clear();
  const fired = mag0 - g.weapons.magazine;

  window.__vpad.set(null, { 6: 1.0 });          // L2 ADS
  t0 = g.time; while (g.time - t0 < 0.9) await new Promise((r) => setTimeout(r, 30));
  const ads = g.weapons.ads;
  window.__vpad.clear();
  t0 = g.time; while (g.time - t0 < 0.6) await new Promise((r) => setTimeout(r, 30));
  return { fired, ads, adsAfter: g.weapons.ads };
});
check('R2 / RT fires the weapon', trig.fired > 0, `${trig.fired} round(s)`);
check('L2 / LT aims down sights', trig.ads > 0.7, `ads=${trig.ads.toFixed(2)}`);
check('Releasing L2 leaves ADS', trig.adsAfter < 0.4, `ads=${trig.adsAfter.toFixed(2)}`);

// ---- light trigger pull does not fire ----
const feather = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.weapons.mags.set('pistol9', 15);
  const mag0 = g.weapons.magazine;
  window.__vpad.set(null, { 7: 0.25 });         // below the break point
  const t0 = g.time; while (g.time - t0 < 0.6) await new Promise((r) => setTimeout(r, 30));
  window.__vpad.clear();
  return mag0 - g.weapons.magazine;
});
check('Trigger has a break point', feather === 0, `${feather} rounds on a 25% pull`);

// ---- face buttons ----
const face = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const out = {};
  // Hold for a number of rendered FRAMES, not seconds: the pad is polled once
  // per frame, and under a software rasteriser a 200 ms hold can span none.
  const frames = async (n) => { const f0 = g.rafCount; let guard = 0; while (g.rafCount - f0 < n && guard++ < 600) await new Promise((r) => setTimeout(r, 20)); };
  const tap = async (i) => {
    window.__vpad.set(null, { [i]: 1 });
    await frames(3);
    window.__vpad.clear();
    await frames(3);
  };

  // ✕ / A -> jump
  g.stats.stamina = 100;
  window.__vpad.set(null, { 0: 1 });
  let t0 = g.time, airborne = false;
  const jf = g.rafCount;
  while (g.rafCount - jf < 6) { await new Promise((r) => setTimeout(r, 25)); if (!g.player.grounded) airborne = true; }
  window.__vpad.clear();
  out.jump = airborne;
  t0 = g.time; while (g.time - t0 < 1.2) await new Promise((r) => setTimeout(r, 30));

  // ○ / B -> crouch (held)
  const h0 = g.player.height;
  window.__vpad.set(null, { 1: 1 });
  await frames(6);
  out.crouch = g.player.height < h0 - 0.3;
  window.__vpad.clear();
  t0 = g.time; while (g.time - t0 < 0.6) await new Promise((r) => setTimeout(r, 30));

  // □ / X -> reload when nothing to interact with
  g.weapons.mags.set('pistol9', 5);
  g.inventory.add('ammo9', 40);
  g.interaction.current = null;
  await tap(2);
  t0 = g.time; while (g.time - t0 < 2.6 && g.weapons.state === 'reloading') await new Promise((r) => setTimeout(r, 30));
  out.reload = g.weapons.magazine > 5;

  // L1 -> flashlight
  const fl0 = g.flashlight.on;
  await tap(4);
  out.flashlight = g.flashlight.on !== fl0;

  // R3 -> melee swing
  g.weapons.cooldown = 0;
  g.weapons.meleeSwing = 0;
  window.__vpad.set(null, { 11: 1 });
  let sawSwing = false;
  for (let k = 0; k < 10 && !sawSwing; k++) {
    await frames(1);
    if (g.weapons.meleeSwing > 0 || g.weapons.cooldown > 0) sawSwing = true;
  }
  window.__vpad.clear();
  await frames(2);
  out.melee = sawSwing;

  // D-pad up -> quick slot 1
  g.inventory.assignQuick(0, 'pistol9');
  g.useItem('knife');
  t0 = g.time; while (g.time - t0 < 0.5) await new Promise((r) => setTimeout(r, 30));
  await tap(12);
  t0 = g.time; while (g.time - t0 < 0.6) await new Promise((r) => setTimeout(r, 30));
  out.dpad = g.weapons.currentId === 'pistol9';

  return out;
});
check('✕ / A jumps', face.jump);
check('○ / B crouches', face.crouch);
check('□ / X reloads contextually', face.reload);
check('L1 / LB toggles the flashlight', face.flashlight);
check('R3 melees', face.melee);
check('D-pad selects a quick slot', face.dpad);

// ---- sprint on L3 ----
const sprint = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.stats.stamina = 100;
  window.__vpad.set({ 1: -1 });
  let t0 = g.time; while (g.time - t0 < 0.4) await new Promise((r) => setTimeout(r, 30));
  window.__vpad.set({ 1: -1 }, { 10: 1 });        // click L3
  t0 = g.time; while (g.time - t0 < 0.2) await new Promise((r) => setTimeout(r, 30));
  window.__vpad.set({ 1: -1 }, { 10: 0 });
  t0 = g.time; let peak = 0;
  while (g.time - t0 < 1.2) { await new Promise((r) => setTimeout(r, 30)); peak = Math.max(peak, Math.hypot(g.player.velocity.x, g.player.velocity.z)); }
  const sprinting = g.player.sprinting;
  window.__vpad.clear();
  t0 = g.time; while (g.time - t0 < 0.6) await new Promise((r) => setTimeout(r, 30));
  return { peak, sprinting, afterRelease: g.player.sprinting };
});
check('L3 sprints', sprint.peak > 5.0 || sprint.sprinting, `peak ${sprint.peak.toFixed(2)} m/s`);
check('Sprint drops when the stick is released', !sprint.afterRelease);

// ---- aim assist ----
const assist = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.settings.set('padAimAssist', 1.0);
  // clear the area, stand in the open
  for (const e of g.entities.active.slice()) {
    if (Math.hypot(e.position.x - g.player.position.x, e.position.z - g.player.position.z) < 90) {
      e.alive = false; e.corpse = true; e.deathTimer = 999;
    }
  }
  let clear = null;
  for (let i = 0; i < 400 && !clear; i++) {
    const c = g.world.terrain.findWalkable(g.player.position.x, g.player.position.z, Math.random, 6, 60);
    let ok = true;
    for (const b of g.world.structureBoxes) if (Math.hypot(b.x - c.x, b.z - c.z) < Math.max(b.hw, b.hd) + 14) { ok = false; break; }
    if (ok) clear = c;
  }
  clear = clear || g.world.terrain.findWalkable(g.player.position.x, g.player.position.z, Math.random, 20, 30);
  g.player.position.set(clear.x, clear.y + 0.2, clear.z);
  g.player.pitch = 0;
  let t0 = g.time; while (g.time - t0 < 0.4) await new Promise((r) => setTimeout(r, 30));

  // put a target 14 m ahead, then aim slightly off it
  const f = g.player.forward;
  const tx = g.player.position.x + f.x * 14, tz = g.player.position.z + f.z * 14;
  const m = g.entities.spawnMutant('brute', tx, tz);
  m.state = 'IDLE'; m.alertLevel = 0;
  t0 = g.time; while (g.time - t0 < 0.3) await new Promise((r) => setTimeout(r, 30));

  const aimError = () => {
    const dx = m.position.x - g.player.position.x;
    const dz = m.position.z - g.player.position.z;
    const want = Math.atan2(-dx, -dz);
    let e = want - g.player.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    return Math.abs(e);
  };

  // Start from an exact 0.06 rad error and turn the correct way toward it.
  // yaw increases turn one way; the player applies `yaw -= look.x`, so a
  // positive stick X reduces yaw.
  const onTarget = () => Math.atan2(-(m.position.x - g.player.position.x), -(m.position.z - g.player.position.z));
  const run = async (assistOn) => {
    g.settings.set('padAimAssist', assistOn ? 1.0 : 0);
    g.player.yaw = onTarget() + 0.12;
    g.player.pitch = 0;
    let tt = g.time; while (g.time - tt < 0.25) await new Promise((r) => setTimeout(r, 25));
    const start = aimError();
    window.__vpad.set({ 2: 0.30 });        // turn toward the target
    tt = g.time; while (g.time - tt < 0.40) await new Promise((r) => setTimeout(r, 25));
    window.__vpad.clear();
    tt = g.time; while (g.time - tt < 0.15) await new Promise((r) => setTimeout(r, 25));
    return { start, end: aimError() };
  };
  const on = await run(true);
  const off = await run(false);
  const before = on.start;
  const withAssist = on.end;
  const without = off.end;
  g.settings.set('padAimAssist', 1.0);
  m.alive = false; m.corpse = true; m.deathTimer = 999;
  return { before, withAssist, without, target: !!g.aimTarget };
});
check('Aim assist pulls the reticle onto a target',
  assist.withAssist < assist.without - 0.005,
  `error ${assist.before.toFixed(3)} -> ${assist.withAssist.toFixed(3)} rad with assist, ${assist.without.toFixed(3)} without`);

// ---- pause / menu navigation ----
const menu = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const frames = async (n) => { const f0 = g.rafCount; let guard = 0; while (g.rafCount - f0 < n && guard++ < 600) await new Promise((r) => setTimeout(r, 20)); };
  const tap = async (i) => {
    window.__vpad.set(null, { [i]: 1 });
    await frames(3);
    window.__vpad.clear();
    await frames(3);
  };
  await tap(9);                                   // OPTIONS -> pause
  const paused = !document.getElementById('pause').classList.contains('hidden');
  // Wait for focus rather than assuming a frame has run — under SwiftShader a
  // fixed sleep can cover no frames at all.
  let focusedFirst = false;
  for (let i = 0; i < 60 && !focusedFirst; i++) {
    await new Promise((r) => setTimeout(r, 60));
    focusedFirst = !!document.querySelector('#pause .pad-focus');
  }
  window.__vpad.set({ 1: 1 });                    // stick down
  await new Promise((r) => setTimeout(r, 300));
  window.__vpad.clear();
  await new Promise((r) => setTimeout(r, 200));
  const focusMoved = !!document.querySelector('#pause .pad-focus');
  const focusText = document.querySelector('#pause .pad-focus')?.textContent?.trim();
  await tap(9);                                   // OPTIONS again -> resume
  await new Promise((r) => setTimeout(r, 350));
  return { paused, focusedFirst, focusMoved, focusText, resumed: g.state === 'PLAYING' && !g.paused };
});
check('OPTIONS / MENU opens the pause screen', menu.paused);
check('Menus take controller focus', menu.focusedFirst && menu.focusMoved, `focus on "${menu.focusText}"`);
check('OPTIONS resumes the game', menu.resumed);

// ---- pointer lock is not required on a pad ----
const noLock = await page.evaluate(() => ({
  locked: window.BLACKROOT.padDebug.pointerLocked,
  playing: window.BLACKROOT.state === 'PLAYING',
  paused: window.BLACKROOT.paused,
}));
check('Gameplay runs without pointer lock on a controller', noLock.playing && !noLock.paused && !noLock.locked);

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log('\n' + '='.repeat(64));
console.log(`  ${results.length - failed.length}/${results.length} controller checks passed`);
for (const f of failed) console.log(`   - ${f.name} ${f.detail}`);
console.log('='.repeat(64));
process.exit(failed.length ? 1 : 0);
