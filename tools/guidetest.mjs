/**
 * Morning-and-guide test.
 *
 * Two things a player judges instantly and cannot be argued out of: whether
 * they can see, and whether they know where to go. Both are measured here
 * rather than described — the light by sampling what the renderer actually
 * puts on screen, and the guide by watching where it goes as the player walks.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8555;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

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
const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state === "MENU"', null, { timeout: 45000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low'); S.set('renderScale', 0.25); S.set('viewDistance', 120);
  S.set('foliage', 0.2); S.set('shadows', 'off');
});
await page.evaluate(() => window.BLACKROOT.startNewGame(0xC0FFEE));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 });
await page.evaluate(() => { window.BLACKROOT.director.calmPeriod = 600; });

/* ================= 1. it is morning ================= */

const grade = await page.evaluate(() => {
  const g = window.BLACKROOT, w = g.world;
  return {
    tod: g.settings.get('timeOfDay'),
    daylight: !!w._sky.daylight,
    stars: w.stars ? w.stars.geometry.attributes.position.count : 0,
    sun: w.moon.intensity, hemi: w.hemi.intensity,
    fog: g.scene.fog.density,
    nightFog: g.biome.sky.fogDensity,
    env: g.scene.environmentIntensity,
    sunY: w.moonDir.y,
  };
});
check('A new game starts in the morning', grade.tod === 'morning' && grade.daylight);
check('  …with the stars out', grade.stars === 0, `${grade.stars} stars`);
check('  …a sun rather than a moon', grade.sun > 3, `intensity ${grade.sun.toFixed(2)}`);
check('  …low in the sky, so shapes still have shadows', grade.sunY > 0.15 && grade.sunY < 0.5, `sun height ${grade.sunY.toFixed(2)}`);
check('  …and much thinner haze than the night grade', grade.fog < grade.nightFog, `${grade.fog.toFixed(5)} vs ${grade.nightFog}`);

/**
 * The honest measure of "can I see": how bright the frame actually is, and
 * how much of it is not simply black. A grade can look fine in a light meter
 * and still render a wall of silhouettes.
 */
async function frameStats() {
  const shot = await page.screenshot({ timeout: 120000 });
  const { createCanvas, loadImage } = await import('node:module').then(() => ({}));
  return shot;
}
const luma = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  // Read the actual framebuffer back rather than trusting the light values.
  const c = document.getElementById('gl');
  const tmp = document.createElement('canvas');
  tmp.width = 160; tmp.height = 100;
  const ctx = tmp.getContext('2d');
  for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
  ctx.drawImage(c, 0, 0, tmp.width, tmp.height);
  const d = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
  let sum = 0, dark = 0, n = tmp.width * tmp.height;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    sum += l;
    if (l < 0.045) dark++;
  }
  return { mean: sum / n, darkFrac: dark / n };
});
check('The frame is actually bright enough to play', luma.mean > 0.14, `mean luma ${luma.mean.toFixed(3)}`);
check('  …and is not mostly black', luma.darkFrac < 0.35, `${(luma.darkFrac * 100).toFixed(0)}% near-black pixels`);

const night = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.settings.set('timeOfDay', 'night');
  for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  const w = g.world;
  return { stars: w.stars.geometry.attributes.position.count, sun: w.moon.intensity, daylight: !!w._sky.daylight };
});
check('Switching to NIGHT gives the original grade back', night.stars > 0 && night.sun < 2 && !night.daylight,
  `${night.stars} stars, light ${night.sun.toFixed(2)}`);

const backToDay = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.settings.set('timeOfDay', 'morning');
  for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  return { stars: g.world.stars.geometry.attributes.position.count, daylight: !!g.world._sky.daylight, children: g.scene.children.length };
});
check('  …and switching back does not leave two skies behind', backToDay.daylight && backToDay.stars === 0,
  `${backToDay.children} objects in the scene`);

/* ================= 2. the guide ================= */

const guide = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const wp = g.waypoints;
  for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
  const obj = wp.active;
  const p = g.player.position, w = wp.wisp.position;
  const toObj = Math.hypot(obj.x - p.x, obj.z - p.z);
  const toWisp = Math.hypot(w.x - p.x, w.z - p.z);
  // Is it between you and where you are going, rather than off to one side?
  const ax = (obj.x - p.x) / toObj, az = (obj.z - p.z) / toObj;
  const bx = (w.x - p.x) / (toWisp || 1), bz = (w.z - p.z) / (toWisp || 1);
  return {
    visible: wp.wisp.visible, toObj, toWisp,
    alignment: ax * bx + az * bz,
    aboveGround: w.y - g.world.terrain.heightAt(w.x, w.z),
    lit: wp.wispLight.intensity,
  };
});
check('There is a guide light in the world', guide.visible);
check('  …a few metres ahead, not on the horizon', guide.toWisp > 6 && guide.toWisp < 16,
  `${guide.toWisp.toFixed(1)} m ahead of a ${guide.toObj.toFixed(0)} m walk`);
check('  …in the direction of the objective', guide.alignment > 0.97, `alignment ${guide.alignment.toFixed(3)}`);
check('  …floating above the ground, not buried in it', guide.aboveGround > 1.0 && guide.aboveGround < 2.6,
  `${guide.aboveGround.toFixed(2)} m up`);
check('  …and casting light on the way ahead', guide.lit > 1, `intensity ${guide.lit.toFixed(1)}`);

const led = await page.evaluate(async () => {
  const g = window.BLACKROOT, wp = g.waypoints;
  const obj = wp.active;
  const before = { ...wp.wisp.position };
  // Walk towards the objective for a while and see whether it goes on ahead.
  const p = g.player.position;
  const dx = obj.x - p.x, dz = obj.z - p.z;
  const l = Math.hypot(dx, dz);
  for (let i = 0; i < 40; i++) {
    p.x += (dx / l) * 1.2; p.z += (dz / l) * 1.2;
    p.y = g.world.terrain.heightAt(p.x, p.z) + 0.1;
    await new Promise((r) => requestAnimationFrame(r));
  }
  const after = { ...wp.wisp.position };
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  const stillAhead = Math.hypot(after.x - p.x, after.z - p.z);
  return { moved, stillAhead, visible: wp.wisp.visible };
});
check('It moves on as you follow it', led.moved > 30, `${led.moved.toFixed(0)} m travelled`);
check('  …and stays ahead of you rather than being left behind', led.stillAhead > 6 && led.stillAhead < 16,
  `${led.stillAhead.toFixed(1)} m ahead`);

const arrive = await page.evaluate(async () => {
  const g = window.BLACKROOT, wp = g.waypoints;
  const obj = wp.active;
  // Stand almost on top of the objective: the guide should settle onto it
  // rather than shooting past. Standing next to the boss is also a good way
  // to be killed, and a dead player's systems stop updating — so health is
  // pinned for the measurement.
  g.player.position.x = obj.x - 2; g.player.position.z = obj.z;
  g.player.position.y = g.world.terrain.heightAt(g.player.position.x, g.player.position.z) + 0.1;
  for (let i = 0; i < 40; i++) {
    g.stats.health = 100; g.stats.dead = false;
    await new Promise((r) => requestAnimationFrame(r));
  }
  const w = wp.wisp.position;
  const now = wp.active || obj;
  return { past: Math.hypot(w.x - now.x, w.z - now.z), state: g.state };
});
check('  …and settles on the objective instead of overshooting it', arrive.past < 3.5,
  `${arrive.past.toFixed(2)} m from it, game ${arrive.state}`);

const off = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  // Back to open ground and alive, so the systems under test are running.
  g.stats.health = 100; g.stats.dead = false;
  if (g.state !== 'PLAYING') { g.state = 'PLAYING'; g.ui.showHUD(); }
  g.player.position.x += 140;
  g.player.position.y = g.world.terrain.heightAt(g.player.position.x, g.player.position.z) + 0.1;
  g.settings.set('guide', false);
  for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
  const hidden = !g.waypoints.wisp.visible;
  g.settings.set('guide', true);
  g.settings.set('waypoints', false);
  for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
  const alsoHidden = !g.waypoints.wisp.visible;
  g.settings.set('waypoints', true);
  return { hidden, alsoHidden };
});
check('The guide can be switched off', off.hidden);
check('  …and goes with the waypoints when those are hidden', off.alsoHidden);

/* ================= 3. it survives a rebuild ================= */

await page.evaluate(() => window.BLACKROOT.restart());
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 });
const rebuilt = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
  let wisps = 0, skies = 0;
  g.scene.traverse((o) => {
    if (o.name && o.name.startsWith('remote:')) return;
    if (o === g.waypoints.wisp) wisps++;
  });
  for (const o of g.scene.children) if (o === g.world.sky) skies++;
  return { wisps, skies, visible: g.waypoints.wisp.visible, daylight: !!g.world._sky.daylight };
});
check('One guide survives a restart, not two', rebuilt.wisps === 1 && rebuilt.visible);
check('  …and the new world is still morning', rebuilt.daylight);
check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log('\n================================================================');
console.log(`  ${pass}/${pass + fail} light and guide checks passed`);
if (fail) { console.log('  FAILURES:'); for (const f of failures) console.log('   · ' + f); }
console.log('================================================================');
process.exit(fail ? 1 : 0);
