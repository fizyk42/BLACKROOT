/** Full-resolution screenshots for eyeballing the art direction. */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8126;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    await stat(f);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(path.join(root, 'tools/shots'), { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(200); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });

await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('medium');
  S.set('renderScale', 1.0);
  S.set('viewDistance', 150);
  S.set('foliage', 0.9);
  S.set('shadows', 'low');
  S.set('showFps', false);
});
await page.evaluate(() => window.BLACKROOT.startNewGame(0x1234abcd));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 240000 });
await sleep(4000);

const shot = async (name, setup, settle = 4500) => {
  if (setup) await page.evaluate(setup);
  await sleep(settle);
  await page.screenshot({ path: path.join(root, 'tools/shots/full-' + name + '.png') });
  console.log('shot', name);
};

await shot('01-camp-nolight', () => {
  const g = window.BLACKROOT;
  g.flashlight.on = false;
  g.player.pitch = -0.06;
});
await shot('02-camp-light', () => {
  const g = window.BLACKROOT;
  g.flashlight.on = true;
});
await shot('03-forest', () => {
  const g = window.BLACKROOT;
  const T = g.world.terrain;
  const s = T.findWalkable(120, 60, Math.random, 40, 60);
  g.player.position.set(s.x, s.y + 0.2, s.z);
  g.player.yaw = 1.1; g.player.pitch = -0.05;
  g.flashlight.on = true;
});
await shot('04-tower', () => {
  const g = window.BLACKROOT;
  const lm = g.world.landmarks.find((l) => l.type === 'tower');
  g.player.position.set(lm.x + 26, g.world.terrain.heightAt(lm.x + 26, lm.z + 26) + 0.2, lm.z + 26);
  g.player.yaw = Math.atan2(-(lm.x - (lm.x + 26)), -(lm.z - (lm.z + 26)));
  g.player.pitch = 0.30;
  g.flashlight.on = true;
});
await shot('05-ranger', () => {
  const g = window.BLACKROOT;
  const lm = g.world.landmarks.find((l) => l.type === 'ranger') || g.world.landmarks.find((l) => l.type === 'cabin');
  g.player.position.set(lm.x + 11, g.world.terrain.heightAt(lm.x + 11, lm.z + 11) + 0.2, lm.z + 11);
  g.player.yaw = Math.atan2(11, 11) + Math.PI;
  g.player.pitch = -0.02;
  g.flashlight.on = true;
});
await shot('06-mutant', () => {
  const g = window.BLACKROOT;
  const f = g.player.forward;
  const x = g.player.position.x + f.x * 7, z = g.player.position.z + f.z * 7;
  const m = g.entities.spawnMutant('stalker', x, z);
  m.state = 'STALK'; m.alertLevel = 0.5;
  const b = g.entities.spawnMutant('brute', x + 3.5, z + 1.5);
  b.state = 'STALK';
  g.flashlight.on = true;
});
await shot('07-lake', () => {
  const g = window.BLACKROOT;
  const T = g.world.terrain;
  g.player.position.set(T.lake.x + T.lake.r + 6, 0, T.lake.z);
  g.player.position.y = T.heightAt(g.player.position.x, g.player.position.z) + 0.2;
  g.player.yaw = Math.atan2(-(T.lake.x - g.player.position.x), -(T.lake.z - g.player.position.z));
  g.player.pitch = 0.02;
  g.flashlight.on = true;
});

await browser.close();
server.close();
