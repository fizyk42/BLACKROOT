/**
 * Audio test.
 *
 * The only honest way to check a soundtrack from a headless browser is to
 * listen to it: an AnalyserNode is spliced onto the master bus and the RMS of
 * the actual output is measured. A test that only asserts "startMusic() was
 * called" would have passed happily against the old build, which was silent.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8522;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok, d }); console.log(`${ok ? ' PASS' : ' FAIL'}  ${n}${d ? '   ' + d : ''}`); };

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
  // A real audio device is not available headless, so the browser is told to
  // synthesise one; the graph still runs and the analyser still measures it.
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e).slice(0, 200)); console.log('PAGEERROR', String(e).slice(0, 300)); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(200); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });

/** Splice an analyser onto the master bus and expose an RMS probe. */
const installProbe = () => page.evaluate(async () => {
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  A.init(); A.resume();
  if (!A.ctx) return false;
  const an = A.ctx.createAnalyser();
  an.fftSize = 2048;
  A.master.connect(an);
  const buf = new Float32Array(an.fftSize);
  window.__rms = (ms = 700) => new Promise((res) => {
    let peak = 0, sum = 0, n = 0;
    const t0 = performance.now();
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const r = Math.sqrt(s / buf.length);
      peak = Math.max(peak, r); sum += r; n++;
      // setTimeout, not requestAnimationFrame: under a software rasteriser
      // rAF runs about once a second, which would sample a 200 ms gunshot
      // roughly never.
      if (performance.now() - t0 < ms) setTimeout(tick, 8);
      else res({ peak: +peak.toFixed(5), mean: +(sum / Math.max(1, n)).toFixed(5), frames: n });
    };
    tick();
  });
  return { state: A.ctx.state, sampleRate: A.ctx.sampleRate };
});
const probe = await installProbe();
check('The audio engine starts', !!probe && probe.state !== undefined, `context ${probe && probe.state}, ${probe && probe.sampleRate} Hz`);

/* ---- menu theme ---- */
await page.evaluate(async () => {
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  A.stopMusic(); A.startMusic('menu'); A.setDread(0.12);
});
await sleep(2500);
const menu = await page.evaluate(() => window.__rms(1400));
check('There is menu music, at calm, without being asked twice', menu.peak > 0.004,
  `peak ${menu.peak}, mean ${menu.mean} over ${menu.frames} frames`);

/* ---- the score is not just one drone ---- */
const structure = await page.evaluate(async () => {
  const M = await import('/scripts/core/Music.js');
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  const d = A.music;
  const palettes = Object.keys(M.PALETTES);
  const scales = new Set(palettes.map((p) => M.PALETTES[p].scale));
  const bpms = new Set(palettes.map((p) => M.PALETTES[p].bpm));
  return {
    palettes, nPal: palettes.length, nScales: scales.size, nBpm: bpms.size,
    layers: Object.keys(d.layer || {}),
    running: d.running,
  };
});
check('Every biome has a musical palette of its own', structure.nPal >= 7 && structure.nScales >= 4 && structure.nBpm >= 5,
  `${structure.nPal} palettes, ${structure.nScales} modes, ${structure.nBpm} tempos`);
check('The arrangement has separate layers', structure.layers.length === 5, structure.layers.join(', '));

/* ---- intensity actually changes the music ---- */
const quiet = await page.evaluate(async () => {
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  A.setDread(0);
  await new Promise((r) => setTimeout(r, 2600));
  return window.__rms(1600);
});
const loud = await page.evaluate(async () => {
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  A.setDread(1);
  await new Promise((r) => setTimeout(r, 3200));
  return window.__rms(1600);
});
check('Calm is quiet but never silent', quiet.peak > 0.002, `peak ${quiet.peak}`);
check('Dread makes the score build', loud.peak > quiet.peak * 1.25,
  `calm ${quiet.peak} → dread ${loud.peak}`);

const layerGains = await page.evaluate(async () => {
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  const g = {};
  for (const k of Object.keys(A.music.layer)) g[k] = +A.music.layer[k].gain.value.toFixed(3);
  return g;
});
check('Dread brings in the percussion and the shimmer',
  layerGains.perc > 0.2 && layerGains.shimmer > 0.05,
  JSON.stringify(layerGains));

/* ---- sound effects ----
 *
 * Measured at the menu rather than in a live run. Under a software rasteriser
 * a single frame blocks the main thread for the better part of a second, which
 * starves the very sampling loop doing the measuring — the effects are as loud
 * either way, but only one of the two situations can be measured honestly.
 */
const sfx = await page.evaluate(async () => {
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  A.stopMusic(); A.stopAmbience();
  await new Promise((r) => setTimeout(r, 900));
  const out = {};
  const listen = { x: 0, y: 0, z: 0 };
  A.updateListener(listen, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  await new Promise((r) => setTimeout(r, 120));
  out.silence = await window.__rms(400);
  for (const [name, fn] of [
    ['gunshot', () => A.gunshot('rifle', { x: 0.2, y: 0, z: -0.4 })],
    ['shotgun', () => A.gunshot('shotgun', { x: 0.2, y: 0, z: -0.4 })],
    ['footstep', () => { for (let i = 0; i < 4; i++) setTimeout(() => A.footstep('grass', false), i * 90); }],
    ['creature', () => A.mutantGrowl('stalker', { x: 1, y: 0, z: -3 })],
    ['scream', () => A.mutantScream({ x: 2, y: 0, z: -6 })],
    ['impact', () => A.impact('wood', { x: 0, y: 0, z: -5 })],
    ['reload', () => A.reloadStep('magOut')],
    ['pickup', () => A.pickup()],
  ]) {
    const m = window.__rms(700);
    fn();
    out[name] = await m;
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
});
// "clearly audible" = several times the noise floor, not merely non-zero
const louder = (k) => sfx[k].peak > Math.max(0.02, sfx.silence.peak * 5);
check('Silence is silent with the score stopped', sfx.silence.peak < 0.01, `peak ${sfx.silence.peak}`);
for (const k of ['gunshot', 'shotgun', 'footstep', 'creature', 'scream', 'impact', 'reload', 'pickup']) {
  check(`Sound effect: ${k}`, louder(k), `peak ${sfx[k].peak}`);
}
check('A shotgun is louder than a footstep', sfx.shotgun.peak > sfx.footstep.peak,
  `${sfx.shotgun.peak} vs ${sfx.footstep.peak}`);

/* ---- and the game actually triggers them ---- */
await page.evaluate(() => window.BLACKROOT.settings.applyPreset('low'));
await page.evaluate(() => { const S = window.BLACKROOT.settings; S.set('renderScale', 0.14); S.set('viewDistance', 80); S.set('foliage', 0.25); S.set('shadows', 'off'); });
await page.evaluate(() => window.BLACKROOT.startNewGame(0x5150));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 400000 });
await sleep(2500);

const inGame = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  const calls = [];
  const wrap = (k) => { const o = A[k].bind(A); A[k] = (...a) => { calls.push(k); return o(...a); }; };
  for (const k of ['gunshot', 'footstep', 'reloadStep', 'flashlightClick']) wrap(k);
  g.weapons.cooldown = 0;
  g.weapons.tryFire();
  g.weapons.magazine = 1;
  g.weapons.startReload();
  g.flashlight.toggle();
  const L = A.ctx.listener;
  const cam = g.camera.position;
  const lis = L.positionX ? { x: L.positionX.value, y: L.positionY.value, z: L.positionZ.value } : cam;
  return {
    calls, running: A.music && A.music.running, palette: A.music && A.music.paletteId,
    amb: !!A._ambientGains,
    listenerOffset: +Math.hypot(lis.x - cam.x, lis.y - cam.y, lis.z - cam.z).toFixed(2),
  };
});
check('The run starts its own score', inGame.running && inGame.palette === 'hollow', `palette ${inGame.palette}`);
check('Ambience is running', inGame.amb);
check('Gameplay actually triggers sound', inGame.calls.includes('gunshot') && inGame.calls.includes('reloadStep') && inGame.calls.includes('flashlightClick'),
  inGame.calls.join(', '));
check('The listener is on the camera, so positional audio is correct',
  inGame.listenerOffset < 1.0, `${inGame.listenerOffset} m from the camera`);

/* ---- the palette follows the biome ---- */
const swapped = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  await g.buildRun(0x5150, 'abyss', 1);
  g.enterPlay();
  await new Promise((r) => setTimeout(r, 1500));
  const A = (await import('/scripts/core/AudioManager.js')).Audio;
  return { palette: A.music && A.music.paletteId, running: A.music && A.music.running };
});
check('Changing biome changes the music', swapped.palette === 'abyss' && swapped.running, `palette ${swapped.palette}`);

check('No audio errors', errors.length === 0, errors[0] || '');

const pass = results.filter((r) => r.ok).length;
console.log('\n' + '='.repeat(64));
console.log(`  ${pass}/${results.length} audio checks passed`);
console.log('='.repeat(64));
await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
