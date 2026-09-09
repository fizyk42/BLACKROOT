/**
 * Reference captures — one frame from each biome, plus each boss and each
 * mutant on a turntable. Slow (every biome is generated from scratch under a
 * software rasteriser), but it is the only way to actually look at the game
 * from here.
 *
 *   node tools/biomeshots.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8520;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(root, 'tools/shots');
const ONLY = process.argv.includes('--creatures') ? 'creatures'
  : process.argv.includes('--worlds') ? 'worlds' : 'all';

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
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(200); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('medium');
  S.set('renderScale', 0.42); S.set('viewDistance', 130); S.set('foliage', 0.5);
  S.set('shadows', 'off'); S.set('brightness', 1.75);
});

await page.evaluate(() => window.BLACKROOT.startNewGame(0xA11CE));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 400000 });

/** Put the camera somewhere with a view, and clear the UI out of the frame. */
const compose = async (opts = {}) => page.evaluate((o) => {
  const g = window.BLACKROOT;
  const T = g.world.terrain;
  // find a high, open spot near the player and look out from it
  let best = null;
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 180;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z) > 380) continue;
    const y = T.heightAt(x, z);
    if (T.isWater(x, z)) continue;
    if (T.slopeAt(x, z) > 0.35) continue;
    if (!best || y > best.y) best = { x, y, z };
  }
  if (best) {
    g.player.position.set(best.x, best.y + (o.lift || 0), best.z);
    g.player.velocity.set(0, 0, 0);
  }
  // Look outward from the middle of the map so the shot has depth in it
  // rather than a rim cliff two metres from the lens.
  const outward = Math.atan2(-(0 - (best ? best.x : 0)), -(0 - (best ? best.z : 0)));
  g.player.yaw = o.yaw !== undefined ? o.yaw : outward + Math.PI;
  g.player.pitch = o.pitch !== undefined ? o.pitch : -0.04;
  // The lamp blows out whatever is nearest; these are landscape shots.
  g.flashlight.on = false;
  g.flashlight.spot.intensity = 0;
  g.ui.el.biomeCard.classList.add('hidden');
  g.ui.el.hud.classList.toggle('hidden', !!o.hideHud);
}, opts);

const BIOMES = ONLY === 'creatures' ? [] : ['hollow', 'void', 'abyss', 'cinder', 'permafrost', 'bloom'];
for (const id of BIOMES) {
  if (id !== 'hollow') {
    await page.evaluate(async (b) => {
      const g = window.BLACKROOT;
      await g.buildRun(0xA11CE, b, 1);
      g.enterPlay();
    }, id);
    await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 400000 });
  }
  await compose({ lift: id === 'abyss' ? 16 : 1.5, pitch: id === 'abyss' ? 0.03 : -0.03, hideHud: true });
  await sleep(6000);
  await page.screenshot({ path: path.join(OUT, `world-${id}.png`), timeout: 180000 });
  console.log('captured', id);
}

/* ---- creature turntable: reuse the armoury stage ---- */
await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const THREE = await import('three');
  const C = await import('/scripts/entities/CreatureModels.js');
  const B = await import('/scripts/entities/Bosses.js');
  const A = g.armoury;
  // Borrow the armoury's lit turntable to photograph creatures against a
  // neutral background instead of hunting for one in a dark forest.
  g.openArmoury('menu');
  A.tab = 'weapons';
  // The armoury redraws its own weapon every frame, so the weapon has to be
  // taken off the turntable rather than merely hidden.
  if (A.gunModel) A.gunHolder.remove(A.gunModel);
  A.gunModel = null;
  A._subject = new THREE.Group();
  A.pivot.add(A._subject);
  window.__showCreature = (kind, id) => {
    while (A._subject.children.length) A._subject.remove(A._subject.children[0]);
    const model = kind === 'boss' ? B.BOSS_FACTORIES[id]() : C.CREATURE_FACTORIES[id]();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    // Frame by the longest axis, not by height: a Crawler is half a metre
    // tall and two metres long, and scaling it by height fills the lens with
    // one rib.
    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    model.position.set(-c.x, -c.y, -c.z);
    A._subject.add(model);
    A._subject.scale.setScalar(0.34 / Math.max(0.001, span));
    A.el.name.textContent = id.toUpperCase();
    A.el.sub.textContent = kind === 'boss' ? 'BIOME BOSS' : 'MUTANT';
    A.yaw = 0.6;
    A.spin = 0;
  };
});

const CREATURES = ONLY === 'worlds' ? [] : ['stalker', 'brute', 'crawler', 'screamer', 'choir', 'drowned', 'ashwalker', 'rimewretch', 'sporebearer'];
for (const id of CREATURES) {
  await page.evaluate((c) => window.__showCreature('mutant', c), id);
  await sleep(2600);
  await page.screenshot({ path: path.join(OUT, `mutant-${id}.png`), timeout: 120000 });
  console.log('captured', id);
}
const BOSSES = ONLY === 'worlds' ? [] : ['warden', 'chorister', 'gillfather', 'pyreking', 'hoarmother', 'motherstalk'];
for (const id of BOSSES) {
  await page.evaluate((c) => window.__showCreature('boss', c), id);
  await sleep(2600);
  await page.screenshot({ path: path.join(OUT, `boss-${id}.png`), timeout: 120000 });
  console.log('captured', id);
}

console.log('shots written to tools/shots/');
await browser.close();
server.close();
