/**
 * Look test — can the player turn around, in every way the mouse can fail?
 *
 *   node tools/looktest.mjs
 *
 * Looking around is the one input whose failure is total and silent: if
 * pointer lock does not engage, the old build simply never turned, with no
 * error in the console and nothing on screen to explain it. So each way it can
 * fail is reproduced here for real, in the browser, and the assertion is
 * always the same one that matters — *did the view actually rotate*.
 *
 * The failures reproduced:
 *   · pointer lock refused outright (requestPointerLock throws)
 *   · pointer lock silently ignored (the promise resolves, nothing happens)
 *   · pointer lock granted but movementX/movementY always report zero
 *     (remote desktops and a few trackpad drivers do exactly this)
 *   · a trackpad's much smaller deltas
 *   · a trackpad's two-finger scroll, which used to cycle the whole weapon
 *     list in one flick
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8547;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(` PASS  ${label}${detail ? '   ' + detail : ''}`); }
  else { fail++; failures.push(label); console.log(` FAIL  ${label}${detail ? '   ' + detail : ''}`); }
}

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

/**
 * `breakLock` is injected before any of the game's code runs, so the game sees
 * a browser that behaves the way a broken one does — no test hooks, no special
 * cases in the game itself.
 *
 *   'none'    the browser works
 *   'throw'   requestPointerLock throws synchronously
 *   'ignore'  requestPointerLock resolves and never locks
 *   'error'   requestPointerLock fires a pointerlockerror event
 *   'dead'    the lock engages but every movementX/Y is zero
 */
async function client(breakLock = 'none') {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript((mode) => {
    if (mode === 'none') return;
    const proto = Element.prototype;
    if (mode === 'throw') {
      proto.requestPointerLock = function () { throw new DOMException('blocked', 'NotSupportedError'); };
    } else if (mode === 'ignore') {
      proto.requestPointerLock = function () { return Promise.resolve(); };
    } else if (mode === 'error') {
      proto.requestPointerLock = function () {
        setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 10);
        return Promise.resolve();
      };
    } else if (mode === 'dead') {
      // The lock is granted, so document.pointerLockElement is set and the
      // game believes everything is fine — but the deltas are all zero.
      const real = proto.requestPointerLock;
      proto.requestPointerLock = function () {
        const el = this;
        Object.defineProperty(document, 'pointerLockElement', { get: () => el, configurable: true });
        setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 5);
        return Promise.resolve();
      };
      proto.ownerDocumentExitPointerLock = null;
      document.exitPointerLock = function () {
        Object.defineProperty(document, 'pointerLockElement', { get: () => null, configurable: true });
        document.dispatchEvent(new Event('pointerlockchange'));
      };
      for (const k of ['movementX', 'movementY']) {
        Object.defineProperty(MouseEvent.prototype, k, { get: () => 0, configurable: true });
      }
    }
  }, breakLock);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state === "MENU"', null, { timeout: 45000 });
  await page.evaluate(() => {
    const S = window.BLACKROOT.settings;
    S.applyPreset('low'); S.set('renderScale', 0.14); S.set('viewDistance', 60);
    S.set('foliage', 0.14); S.set('shadows', 'off');
    S.set('lookMode', 'auto'); S.set('trackpad', 'auto'); S.set('edgeTurn', 1.0);
  });
  await page.evaluate(() => window.BLACKROOT.startNewGame(0xC0FFEE));
  await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 });
  await page.evaluate(() => { window.BLACKROOT.director.calmPeriod = 600; });
  await settle(page);
  return { page, errors };
}

/**
 * Wait for the look system to stop making up its mind. Asking for pointer lock
 * is asynchronous, the fallback has a retry timed to clear Chrome's post-Esc
 * lock-out, and a lock can be granted a second after it was requested — so a
 * diagnostic read straight after the world loads catches the system mid-flight
 * and says nothing useful.
 */
async function settle(page) {
  await page.waitForFunction(
    () => { const d = window.BLACKROOT.input.lookDiagnostics; return d.locked || d.softLook; },
    null, { timeout: 20000, polling: 100 }
  ).catch(() => {});
  // Give a late-arriving real lock time to supersede the fallback.
  await sleep(2200);
}

/** Turn by dragging the pointer, the way a person moves a mouse or a finger. */
async function drag(page, steps, dx, dy, from = { x: 450, y: 280 }) {
  await page.mouse.move(from.x, from.y);
  let x = from.x, y = from.y;
  for (let i = 0; i < steps; i++) {
    x += dx; y += dy;
    await page.mouse.move(x, y);
  }
  return { x, y };
}

/** How far the view turned, in radians, while `fn` ran. */
async function yawDelta(page, fn) {
  const a = await page.evaluate(() => window.BLACKROOT.player.yaw);
  await fn();
  // The look delta is consumed on the next simulated frame, so give it a few.
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  const b = await page.evaluate(() => window.BLACKROOT.player.yaw);
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ================= 1. the normal path still works ================= */

const ok = await client('none');
{
  const d = await ok.page.evaluate(() => window.BLACKROOT.input.lookDiagnostics);
  // Headless Chromium grants pointer lock, but not always promptly; either way
  // the requirement is that the look system settles into *a* working state
  // rather than into nothing, which is what the old build did.
  check('An unbroken browser ends up with a working look path', d.locked || d.softLook,
    d.locked ? 'mouse captured' : 'cursor look');
  check('  …and prefers real mouse capture when it is available', d.locked === true || d.lockFailed === true,
    `locked=${d.locked} failed=${d.lockFailed}`);

  // A captured mouse reports movementX/Y, which Playwright synthesises.
  const turn = await yawDelta(ok.page, () => drag(ok.page, 12, 18, 0));
  check('A captured mouse turns the view', Math.abs(turn) > 0.15, `${(turn * 57.3).toFixed(1)}°`);

  const pitch = await ok.page.evaluate(async () => {
    const p0 = window.BLACKROOT.player.pitch;
    return { p0 };
  });
  await drag(ok.page, 12, 0, -16);
  await ok.page.evaluate(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r)); });
  const p1 = await ok.page.evaluate(() => window.BLACKROOT.player.pitch);
  check('It looks up and down too', Math.abs(p1 - pitch.p0) > 0.1, `pitch ${(p1 * 57.3).toFixed(1)}°`);

  const clamp = await ok.page.evaluate(async () => {
    const g = window.BLACKROOT;
    // Shove the pitch well past vertical and confirm it is held inside range.
    for (let i = 0; i < 40; i++) { g.input.mouse.dy -= 400; await new Promise((r) => requestAnimationFrame(r)); }
    return g.player.pitch;
  });
  check('Pitch stays inside its limits', Math.abs(clamp) < Math.PI / 2, `${(clamp * 57.3).toFixed(1)}°`);
}

/* ================= 2. pointer lock refused ================= */

for (const [mode, label] of [['throw', 'throws'], ['ignore', 'is silently ignored'], ['error', 'fires an error']]) {
  const c = await client(mode);
  const d = await c.page.evaluate(() => window.BLACKROOT.input.lookDiagnostics);
  check(`Pointer lock that ${label} falls back to cursor look`,
    d.softLook === true && d.locked === false, `soft=${d.softLook} failed=${d.lockFailed}`);

  const turn = await yawDelta(c.page, () => drag(c.page, 14, 16, 0));
  check(`  …and the player can still turn (${mode})`, Math.abs(turn) > 0.15, `${(turn * 57.3).toFixed(1)}°`);

  const hidden = await c.page.evaluate(() => document.body.classList.contains('softlook'));
  check(`  …with the system cursor hidden (${mode})`, hidden);

  const told = await c.page.evaluate(() =>
    Array.from(document.querySelectorAll('#toasts .toast, #subtitles')).map((e) => e.textContent).join(' | '));
  check(`  …and the player is told why (${mode})`, /cursor look/i.test(told), told.slice(0, 90));

  const fires = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    const before = g.stats.shotsFired;
    g.weapons.equip('pistol9');
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    g.input.setVirtualMouse(true);
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    g.input.setVirtualMouse(false);
    return g.stats.shotsFired - before;
  });
  check(`  …and can still shoot (${mode})`, fires > 0, `${fires} shot(s)`);

  check(`  …with no page errors (${mode})`, c.errors.length === 0, c.errors.slice(0, 2).join(' | '));
  await c.page.close();
}

/* ================= 3. the lock that lies ================= */

{
  const c = await client('dead');
  // It starts out believing it is locked, exactly as the real bug does.
  const before = await c.page.evaluate(() => window.BLACKROOT.input.lookDiagnostics);
  check('A lock that reports no movement starts out looking fine', before.locked === true, `locked=${before.locked}`);

  // Moving the mouse produces events with zero deltas. That is the tell.
  await drag(c.page, 30, 10, 0);
  await c.page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r)); });
  const after = await c.page.evaluate(() => window.BLACKROOT.input.lookDiagnostics);
  check('It is detected as broken and abandoned', after.lockBroken === true && after.softLook === true,
    `broken=${after.lockBroken} soft=${after.softLook}`);

  const turn = await yawDelta(c.page, () => drag(c.page, 14, 16, 0, { x: 300, y: 280 }));
  check('  …and the player can turn after all', Math.abs(turn) > 0.15, `${(turn * 57.3).toFixed(1)}°`);
  check('  …with no page errors', c.errors.length === 0, c.errors.slice(0, 2).join(' | '));
  await c.page.close();
}

/* ================= 4. cursor look reaches all the way round ================= */

{
  const c = await client('ignore');
  // Cursor look cannot turn further than the window is wide, so the edges have
  // to keep the turn going. Park the pointer in the right-hand band and hold.
  const spun = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    const y0 = g.player.yaw;
    let total = 0, last = y0;
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      let d = g.player.yaw - last;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      total += d; last = g.player.yaw;
    }
    return { total, edge: { ...g.input.edge } };
  }, await c.page.mouse.move(896, 280));
  check('Holding the pointer at the screen edge keeps turning',
    Math.abs(spun.total) > Math.PI, `${(spun.total * 57.3).toFixed(0)}° · edge.x ${spun.edge.x.toFixed(2)}`);

  const lit = await c.page.evaluate(() => {
    const el = document.getElementById('lookedge');
    return { shown: !el.classList.contains('hidden'), right: parseFloat(el.querySelector('.r').style.opacity || '0') };
  });
  check('  …and the driving edge is lit so it is obvious why', lit.shown && lit.right > 0.3,
    `right edge opacity ${lit.right}`);

  const stopped = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    // Pointer back to the middle: the turn must stop dead.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 280, bubbles: true }));
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    const y0 = g.player.yaw;
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    return Math.abs(g.player.yaw - y0);
  });
  check('  …and stops when the pointer comes back inside', stopped < 0.02, `${(stopped * 57.3).toFixed(2)}° of drift`);

  const left = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 280, bubbles: true }));
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    const y0 = g.player.yaw;
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    let d = g.player.yaw - y0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // Leaving the window must not leave the camera spinning behind an
    // alt-tabbed window with no way to stop it.
    document.dispatchEvent(new Event('mouseleave'));
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    const y1 = g.player.yaw;
    for (let i = 0; i < 24; i++) await new Promise((r) => requestAnimationFrame(r));
    return { d, drift: Math.abs(g.player.yaw - y1) };
  });
  // Pushing right turns the view right, which decreases yaw; the left edge is
  // therefore the positive direction.
  check('  …turns the other way at the other edge', left.d > 0.2, `${(left.d * 57.3).toFixed(0)}°`);
  check('  …and stops when the pointer leaves the window', left.drift < 0.02, `${(left.drift * 57.3).toFixed(2)}° of drift`);

  const off = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    g.settings.set('edgeTurn', 0);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 898, clientY: 280, bubbles: true }));
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
    const y0 = g.player.yaw;
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    const d = Math.abs(g.player.yaw - y0);
    g.settings.set('edgeTurn', 1);
    return d;
  });
  check('  …and edge turning can be switched off', off < 0.02, `${(off * 57.3).toFixed(2)}°`);
  await c.page.close();
}

/* ================= 5. trackpads ================= */

{
  const c = await client('none');
  const sniff = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    const before = g.input.trackpadActive;
    // A trackpad's two-finger scroll: many small, fractional, partly
    // horizontal deltas. A wheel notch is none of those things.
    for (let i = 0; i < 6; i++) {
      document.dispatchEvent(new WheelEvent('wheel', { deltaY: 3.4, deltaX: 1.2, deltaMode: 0, bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { before, after: g.input.trackpadActive, detected: g.input.trackpadDetected };
  });
  check('A trackpad is recognised from how it scrolls', sniff.before === false && sniff.after === true);

  const boost = await c.page.evaluate(() => {
    const g = window.BLACKROOT;
    const read = () => { g.input.mouse.dx = 100; return g.input.takeLook(1).x; };
    g.settings.set('trackpad', 'off');
    const plain = read();
    g.settings.set('trackpad', 'on');
    const boosted = read();
    g.settings.set('trackpad', 'auto');
    return { plain, boosted };
  });
  check('  …and its smaller deltas are boosted', boost.boosted > boost.plain * 1.8,
    `${boost.plain.toFixed(4)} -> ${boost.boosted.toFixed(4)} rad per 100 px`);

  const flick = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    // Read synchronously: the game loop consumes the wheel every frame to
    // switch weapons, so anything measured after an await has already gone.
    g.input.takeWheel();
    for (let i = 0; i < 20; i++) {
      document.dispatchEvent(new WheelEvent('wheel', { deltaY: 4.1, deltaMode: 0, bubbles: true }));
    }
    const flickTicks = g.input.takeWheel();
    // A gap between gestures starts the count again, exactly as a real hand
    // lifting off the pad would.
    await new Promise((r) => setTimeout(r, 500));
    g.input.takeWheel();
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, deltaMode: 0, bubbles: true }));
    const notchTicks = g.input.takeWheel();
    return { flickTicks, notchTicks };
  });
  check('  …and one trackpad flick is not a dozen weapon switches',
    Math.abs(flick.flickTicks) <= 1, `${flick.flickTicks} tick(s) from 20 events`);
  check('  …while one wheel notch is still one switch', Math.abs(flick.notchTicks) === 1, `${flick.notchTicks}`);
  await c.page.close();
}

/* ================= 6. the player can choose ================= */

{
  const c = await client('none');
  const forced = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    g.settings.set('lookMode', 'cursor');
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return g.input.lookDiagnostics;
  });
  check('CURSOR mode can be chosen even when capture works',
    forced.softLook === true && forced.locked === false, `soft=${forced.softLook}`);

  const turn = await yawDelta(c.page, () => drag(c.page, 14, 16, 0, { x: 300, y: 280 }));
  check('  …and turns the view', Math.abs(turn) > 0.15, `${(turn * 57.3).toFixed(1)}°`);

  const back = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    g.settings.set('lookMode', 'auto');
    await new Promise((r) => setTimeout(r, 2600));
    return g.input.lookDiagnostics;
  });
  check('  …and switching back restores a working look path', back.locked || back.softLook,
    back.locked ? 'mouse captured' : 'cursor look');

  const panel = await c.page.evaluate(() => {
    window.BLACKROOT.ui.buildSettings('controls');
    return document.getElementById('settings-body').textContent;
  });
  check('The controls screen explains the state of the look system',
    /Look mode/i.test(panel) && /(MOUSE CAPTURED|CURSOR LOOK|Look mode is chosen)/i.test(panel));
  check('  …and offers the trackpad and edge-turn controls',
    /Trackpad boost/i.test(panel) && /Edge turn speed/i.test(panel));

  // Paused: the pointer has to come back so menus are usable.
  const paused = await c.page.evaluate(async () => {
    const g = window.BLACKROOT;
    g.settings.set('lookMode', 'cursor');
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    g.pause();
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    const off = !document.body.classList.contains('softlook');
    g.resume();
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    return { off, back: document.body.classList.contains('softlook'), state: g.state };
  });
  check('Pausing gives the cursor back', paused.off);
  check('  …and resuming takes it again', paused.back && paused.state === 'PLAYING');
  check('  …without pausing the game the moment cursor look starts', paused.state === 'PLAYING');
  check('No page errors anywhere in the look tests', c.errors.length === 0, c.errors.slice(0, 2).join(' | '));
  await c.page.close();
}

await ok.page.close();
await browser.close();
server.close();

console.log('\n================================================================');
console.log(`  ${pass}/${pass + fail} look checks passed`);
if (fail) { console.log('  FAILURES:'); for (const f of failures) console.log('   · ' + f); }
console.log('================================================================');
process.exit(fail ? 1 : 0);
