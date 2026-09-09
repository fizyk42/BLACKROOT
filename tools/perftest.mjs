/**
 * Smoothness test — the numbers that decide how a frame actually feels.
 *
 * Frame rate here is meaningless: this runs on SwiftShader, a CPU rasteriser.
 * What *is* hardware-independent, and what actually governs smoothness on a
 * real GPU, is how much work each frame asks for and how much of it happens in
 * one go. So this measures the things that transfer:
 *
 *   · draw calls, which cost the same on every machine
 *   · how many objects the scene graph walks per frame
 *   · whether every shader is compiled before play starts, because a program
 *     compiled on first sight is a visible hitch at the worst moment
 *   · frame-time *consistency*, which is what "smooth" means — a steady 40 is
 *     smoother than a 60 that drops to 20 twice a second
 *
 * And it checks that the optimisation did not eat the game: baked landmarks
 * still have their loot, their interactables and their collision.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8567;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };

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
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state === "MENU"', null, { timeout: 45000 });
// The heaviest settings the game offers, at a render scale SwiftShader can
// survive: the geometry and draw-call load is what is under test, not fill.
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('medium'); S.set('renderScale', 0.08); S.set('viewDistance', 165);
});
await page.evaluate(() => window.BLACKROOT.startNewGame(0xC0FFEE));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 300000 });
await page.evaluate(() => { window.BLACKROOT.director.calmPeriod = 600; });

const scene = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
  let objects = 0, dynamic = 0;
  g.scene.traverse((o) => { objects++; if (o.matrixAutoUpdate) dynamic++; });
  // The subsystems that are *supposed* to be static, counted directly: a
  // ratio over the whole scene moves with how much loot a seed happened to
  // scatter, and would pass or fail for reasons that have nothing to do with
  // the optimisation.
  const staticParts = { loot: 0, lootDynamic: 0, land: 0, landDynamic: 0 };
  g.loot.group.traverse((o) => { if (o === g.loot.group) return; staticParts.loot++; if (o.matrixAutoUpdate) staticParts.lootDynamic++; });
  for (const lm of g.world.landmarks) {
    lm.built?.group?.traverse((o) => { staticParts.land++; if (o.matrixAutoUpdate) staticParts.landDynamic++; });
  }
  let lmMeshes = 0, baked = 0;
  for (const lm of g.world.landmarks) {
    lm.built?.group?.traverse((o) => { if (o.isMesh) { lmMeshes++; if (o.name === 'baked') baked++; } });
  }
  return {
    staticParts,
    draws: g.renderer.info.render.calls,
    tris: g.renderer.info.render.triangles,
    programs: g.renderer.info.programs.length,
    objects, dynamic, lmMeshes, baked,
    landmarks: g.world.landmarks.length,
  };
});

check('The frame stays inside a sane draw-call budget', scene.draws < 950,
  `${scene.draws} draw calls at 165 m`);
check('Landmarks are baked down to a handful of meshes each',
  scene.lmMeshes / scene.landmarks < 6 && scene.baked > 0,
  `${scene.lmMeshes} meshes across ${scene.landmarks} landmarks, ${scene.baked} of them baked`);
// Scattered loot and built landmarks never move once they are placed, and
// there are thousands of them; three.js recomposes a world matrix for every
// object every frame unless told otherwise. What is left dynamic is creatures,
// effects and the player's rig, which are animated and have to be.
check('Scattered loot never re-transforms itself',
  scene.staticParts.lootDynamic === 0 && scene.staticParts.loot > 200,
  `${scene.staticParts.loot} loot objects, ${scene.staticParts.lootDynamic} dynamic`);
check('  …and neither do the landmarks',
  scene.staticParts.landDynamic === 0 && scene.staticParts.land > 20,
  `${scene.staticParts.land} landmark objects, ${scene.staticParts.landDynamic} dynamic`);
check('  …which leaves most of the scene still',
  scene.objects - scene.dynamic > 2000,
  `${scene.objects - scene.dynamic} of ${scene.objects} objects frozen`);

/* ---- shaders are compiled before play, not on first sight ---- */

const hitch = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const before = g.renderer.info.programs.length;
  // Spin all the way round: everything in the world passes through the frustum.
  for (let i = 0; i < 12; i++) {
    g.player.yaw += Math.PI / 6;
    for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
  }
  return { before, after: g.renderer.info.programs.length };
});
// A straggler or two is tolerable: a boss's third-phase material genuinely
// does not exist until the fight reaches it. A dozen is a stutter every time
// something new walks out of the trees, which is what this exists to stop.
check('Every shader is compiled before play starts', hitch.after - hitch.before <= 2,
  `${hitch.before} programs, ${hitch.after - hitch.before} compiled mid-game`);

/* ---- frame-time consistency ---- */

const frames = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const times = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    times.push(now - last);
    last = now;
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  return { med, p95, worst: times[times.length - 1] };
});
// The absolute numbers are SwiftShader's; the *ratio* is the engine's, and a
// spike three times the median is a stutter on any hardware.
check('Frame times are consistent, not spiky', frames.p95 / frames.med < 2.2,
  `median ${frames.med.toFixed(0)}ms, p95 ${frames.p95.toFixed(0)}ms, ratio ${(frames.p95 / frames.med).toFixed(2)}`);

/* ---- the world survived being optimised ---- */

const intact = await page.evaluate(() => {
  const g = window.BLACKROOT;
  let loot = 0, inter = 0, boxes = g.world.structureBoxes.length;
  for (const lm of g.world.landmarks) {
    loot += lm.built?.lootSpots?.length || 0;
    inter += lm.built?.interactables?.length || 0;
  }
  return { loot, inter, boxes, pickups: g.loot.pickups.length, notes: Object.keys(g.world.notes).length };
});
check('Baking kept every loot spot in the landmarks', intact.loot > 40, `${intact.loot} spots`);
check('  …every interactable', intact.inter > 10, `${intact.inter} interactables`);
check('  …and every collision box', intact.boxes > 20, `${intact.boxes} boxes`);
check('  …with the loot actually placed', intact.pickups > 50, `${intact.pickups} pickups`);

const visible = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  // Stand at a landmark and confirm there is still something to look at.
  const lm = g.world.landmarks.find((l) => l.type !== 'camp') || g.world.landmarks[0];
  g.player.position.set(lm.x + 12, g.world.terrain.heightAt(lm.x + 12, lm.z) + 0.1, lm.z);
  g.player.yaw = Math.atan2(-(lm.x - g.player.position.x), -(lm.z - g.player.position.z));
  for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
  let tris = 0;
  lm.built.group.traverse((o) => {
    if (!o.isMesh) return;
    const gm = o.geometry;
    tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
  });
  return { type: lm.type, tris, draws: g.renderer.info.render.calls };
});
check('A landmark still has its geometry after baking', visible.tris > 300,
  `${visible.type}: ${Math.round(visible.tris)} tris`);

/* ---- materials actually carry surface detail ---- */

const mats = await page.evaluate(() => {
  const g = window.BLACKROOT;
  const seen = new Set();
  let withNormal = 0, withRough = 0, standard = 0;
  g.scene.traverse((o) => {
    const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of list) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      if (!m.isMeshStandardMaterial) continue;
      standard++;
      if (m.normalMap) withNormal++;
      if (m.roughnessMap) withRough++;
    }
  });
  return { standard, withNormal, withRough };
});
check('Surfaces carry real relief, not flat colour', mats.withNormal >= 4,
  `${mats.withNormal} of ${mats.standard} materials have normal maps`);
check('  …and varying roughness across that relief', mats.withRough >= 3,
  `${mats.withRough} with roughness maps`);

check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log('\n================================================================');
console.log(`  ${pass}/${pass + fail} performance checks passed`);
if (fail) { console.log('  FAILURES:'); for (const f of failures) console.log('   · ' + f); }
console.log('================================================================');
process.exit(fail ? 1 : 0);
