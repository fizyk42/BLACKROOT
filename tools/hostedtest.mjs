/**
 * hostedtest — proves the hosted build survives being embedded.
 *
 * `dist/BLACKROOT-hosted.html` is page *content*, not a document: the host
 * supplies the doctype, head and body. That changes three things about the
 * environment, and each one has broken a browser game before:
 *
 *   1. The host's own reset stylesheet loads BEFORE the game's, so anything
 *      the game does not explicitly set is the host's, not the browser's.
 *   2. The page usually runs inside an iframe, so `requestPointerLock` can be
 *      refused outright — the one failure mode that makes a first-person game
 *      completely unplayable rather than slightly worse.
 *   3. Keyboard events go to whichever document has focus, which is the parent
 *      until something inside the frame is clicked.
 *
 * So this suite builds a realistic host wrapper, loads the game inside an
 * iframe with pointer lock DENIED, and checks it still boots, still generates a
 * world, still moves, and falls back to cursor look rather than sitting there.
 *
 *   node tools/hostedtest.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8419;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The host document, written to match what a wrapping host actually provides:
 * a charset and viewport meta, and a small reset with a light background and a
 * 14px system font. If the game's own CSS does not beat that reset, the page
 * comes out white with the wrong typeface, and this is where we find out.
 */
function hostSkeleton(content) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: light; }
body { margin: 0; background: #faf9f7; font: 14px system-ui, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
</head>
<body>
${content}
</body>
</html>`;
}

/** A page that embeds the host document in an iframe with no pointer-lock allow. */
function framePage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#222}
iframe{border:0;width:100vw;height:100vh;display:block}
</style></head>
<body><iframe id="f" src="/hosted.html"></iframe></body></html>`;
}

function serve(hosted) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      // The browser asks the wrapper page for a favicon on its own initiative.
      // Answering 204 keeps a stub-server 404 out of the console-error check,
      // which is there to catch the game's mistakes, not the harness's.
      if (p === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      if (p === '/frame.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(framePage());
      }
      if (p === '/hosted.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(hostSkeleton(hosted));
      }
      res.writeHead(404).end('nope');
    });
    s.listen(PORT, () => resolve(s));
  });
}

(async () => {
  const hosted = await readFile(path.join(root, 'dist/BLACKROOT-hosted.html'), 'utf8');

  // --- static shape, before a browser is involved ---
  check('hosted build exists', hosted.length > 100000, `${(hosted.length / 1024).toFixed(0)} KB`);
  check('no doctype of its own', !/<!doctype/i.test(hosted));
  check('no <html> of its own', !/<html[\s>]/i.test(hosted));
  check('no <head> of its own', !/<head[\s>]/i.test(hosted));
  check('no <body> of its own', !/<body[\s>]/i.test(hosted));
  check('keeps <header> elements', /<header>/i.test(hosted), 'the tag the first guard wrongly ate');
  check('title is hoisted to the top', /^<title>/.test(hosted.trimStart()));
  check('stylesheet is inlined', hosted.includes('<style>') && hosted.includes('--ink:'));
  check('no external stylesheet link', !/<link[^>]+stylesheet/i.test(hosted));
  check('no external script src', !/<script[^>]+src=/i.test(hosted));
  check('bundle is inlined', hosted.includes('THREE') || hosted.length > 900000);
  check('canvas is present', hosted.includes('id="gl"'));
  check('focus shim is present', hosted.includes('window.focus()'));

  const server = await serve(hosted);
  const browser = await chromium.launch({
    executablePath: EXE,
    args: [
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${PORT}/frame.html`);
  const frame = page.frames().find((f) => f.url().includes('hosted.html'))
    || await page.waitForEvent('frameattached').then(() => page.frames().find((f) => f.url().includes('hosted.html')));
  check('embedded in an iframe', !!frame);

  // Deny pointer lock the way a frame without allow="pointer-lock" does.
  await frame.evaluate(() => {
    const deny = function () {
      const err = new DOMException('pointer lock is not allowed here', 'SecurityError');
      document.dispatchEvent(new Event('pointerlockerror'));
      return Promise.reject(err);
    };
    Element.prototype.requestPointerLock = deny;
    if (document.body) document.body.requestPointerLock = deny;
  });
  check('pointer lock denied, as in a sandboxed frame', true);

  await frame.waitForFunction('!!window.BLACKROOT', null, { timeout: 30000 });
  check('game boots inside the frame', true);

  const ctx = await frame.evaluate(() => !!window.BLACKROOT.renderer.getContext());
  check('WebGL2 context created inside the frame', ctx);

  // The host's reset must not win.
  const style = await frame.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { bg: cs.backgroundColor, font: cs.fontFamily, margin: cs.marginTop, overflow: cs.overflow };
  });
  check('game background beats the host reset', style.bg !== 'rgb(250, 249, 247)', style.bg);
  check('game typeface beats the host reset', /mono/i.test(style.font), style.font.slice(0, 40));
  check('body margin is zero', style.margin === '0px', style.margin);
  check('page does not scroll', style.overflow === 'hidden', style.overflow);

  for (let i = 0; i < 6; i++) { await frame.press('body', 'Space').catch(() => {}); await sleep(250); }
  await frame.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 30000 });
  check('reaches the main menu', true);

  await frame.evaluate(() => {
    const S = window.BLACKROOT.settings;
    S.applyPreset('low');
    S.set('renderScale', 0.1);
    S.set('viewDistance', 70);
    S.set('foliage', 0.3);
    S.set('shadows', 'off');
  });

  const t0 = Date.now();
  await frame.evaluate(() => window.BLACKROOT.startNewGame(0x1234abcd));
  await frame.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 240000 });
  check('generates a world and starts playing', true, `${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await frame.evaluate(() => {
    window.__keepPlaying = setInterval(() => {
      const g = window.BLACKROOT;
      if (g && g.state === 'PLAYING') g._pauseReasons.delete('menu');
    }, 80);
  });

  // The whole point: with pointer lock refused, the game must still be
  // playable. That is what the cursor-look fallback is for.
  const look = await frame.evaluate(() => {
    const i = window.BLACKROOT.input;
    return { softLook: !!i.softLook, lockFailed: !!i.lockFailed, lookActive: !!i.lookActive };
  });
  check('falls back to cursor look when lock is refused', look.softLook || look.lockFailed,
    `softLook=${look.softLook} lockFailed=${look.lockFailed}`);

  // Looking around must actually change the camera.
  const before = await frame.evaluate(() => window.BLACKROOT.player.yaw);
  await frame.evaluate(() => {
    const el = document.getElementById('gl') || document.body;
    for (let i = 0; i < 12; i++) {
      el.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: 480 + i * 22, clientY: 270, movementX: 22, movementY: 0,
      }));
    }
  });
  await sleep(400);
  const after = await frame.evaluate(() => window.BLACKROOT.player.yaw);
  check('mouse movement turns the camera', Math.abs(after - before) > 0.001,
    `yaw ${before.toFixed(3)} -> ${after.toFixed(3)}`);

  // And movement keys must reach the game through the frame.
  const p0 = await frame.evaluate(() => {
    const p = window.BLACKROOT.player.position; return { x: p.x, z: p.z };
  });
  await frame.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
  });
  await sleep(1200);
  await frame.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
  });
  const p1 = await frame.evaluate(() => {
    const p = window.BLACKROOT.player.position; return { x: p.x, z: p.z };
  });
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('keyboard reaches the game inside the frame', moved > 0.4, `${moved.toFixed(2)} m`);

  const world = await frame.evaluate(() => {
    const g = window.BLACKROOT;
    return { ents: g.entities.active.length, hp: Math.round(g.player.stats.health) };
  });
  check('world is populated', world.ents > 0, `${world.ents} entities`);
  check('player is alive', world.hp > 0, `${world.hp} hp`);

  // localStorage is the save slot; a sandboxed frame can refuse it.
  const storage = await frame.evaluate(() => {
    try {
      localStorage.setItem('__probe', '1');
      const v = localStorage.getItem('__probe');
      localStorage.removeItem('__probe');
      return v === '1' ? 'works' : 'silent';
    } catch (e) { return 'blocked'; }
  });
  check('saving works in the frame', storage === 'works', storage);

  const fatal = errors.filter((e) => !/WebGL|SwiftShader|GroupMarker|Automatic fallback|deprecated/i.test(e));
  check('no unexpected console errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.error(`    ✗ ${f.name}  ${f.detail}`);
    process.exit(1);
  }
})();
