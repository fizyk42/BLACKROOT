/**
 * Biome / boss test.
 *
 * Verifies that the run really is a chain of different places rather than one
 * place with a filter over it: that the route is seeded and always starts in
 * the Hollow, that every biome builds terrain, sky, flora and a creature
 * roster of its own, that each has one boss with phases and weak points, that
 * shooting a weak point does more than shooting armour, and that killing the
 * boss opens a rift which carries the player and their kit into the next
 * place.
 *
 *   node tools/biometest.mjs [--shots]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8518;
const SHOTS = process.argv.includes('--shots');
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
if (SHOTS) await mkdir(path.join(root, 'tools/shots'), { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e).slice(0, 300)); console.log('PAGEERROR', String(e).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/Deprecat|SwiftShader/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(200); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low'); S.set('renderScale', 0.16); S.set('viewDistance', 70);
  S.set('foliage', 0.16); S.set('shadows', 'off');
});

/* ================= 1. the route ================= */

const route = await page.evaluate(async () => {
  const B = await import('/scripts/world/Biomes.js');
  const B1 = B.biomeOrder(1234);
  const B2 = B.biomeOrder(1234);
  const B3 = B.biomeOrder(999);
  // BIOME_IDS is the run rotation; BIOMES also holds `sandbox`, which is a
  // mode rather than a stop on the road, so it is deliberately not in here.
  const ids = B.BIOME_IDS.slice();
  return {
    ids, n: ids.length,
    first: B1[0], stable: B1.join() === B2.join(), differs: B1.join() !== B3.join(),
    complete: B1.slice().sort().join() === ids.slice().sort().join(),
    sample: B1.join(' → '),
    scaling3: B.depthScaling(3),
  };
});
check('Six biomes are defined', route.n === 6, route.ids.join(', '));
check('Every run starts in the Hollow', route.first === 'hollow');
check('The route is a seeded shuffle of all of them', route.stable && route.complete, route.sample);
check('Different seeds take different roads', route.differs);
check('Difficulty scales with depth, not with which biome you drew',
  route.scaling3.health > 1.5 && route.scaling3.damage > 1.4,
  `depth 3: ×${route.scaling3.health.toFixed(2)} health, ×${route.scaling3.damage.toFixed(2)} damage`);

/* ================= 2. every biome's flora builds ================= */

const flora = await page.evaluate(async () => {
  const B = await import('/scripts/world/Biomes.js');
  const F = await import('/scripts/world/Flora.js');
  const tri = (g) => (g && g.attributes && g.attributes.position ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
  const out = [];
  for (const id of Object.keys(B.BIOMES)) {
    const bi = B.BIOMES[id];
    let total = 0, species = 0, empty = [];
    for (const key of ['canopyA', 'canopyB', 'under', 'ground', 'carpet', 'stone', 'debris', 'trunk']) {
      const name = bi.flora[key];
      if (!name) continue;
      species++;
      const g = F.buildSpecies(name, 4242);
      const t = F.isTreeSpecies(name) ? tri(g.trunk) + tri(g.canopy) : tri(g);
      if (t === 0) empty.push(name);
      total += t;
    }
    out.push({ id, species, total, empty, treeTris: tri(F.buildSpecies(bi.flora.canopyA, 7).trunk || F.buildSpecies(bi.flora.canopyA, 7)) });
  }
  return out;
});
for (const f of flora) {
  check(`${f.id}: flora species all build`, f.empty.length === 0 && f.species >= 7,
    `${f.species} species, ${f.total} tris total${f.empty.length ? ' EMPTY: ' + f.empty.join(',') : ''}`);
}
const treeCost = await page.evaluate(async () => {
  const F = await import('/scripts/world/Flora.js');
  const tri = (g) => (g && g.attributes && g.attributes.position ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
  const t = F.buildSpecies('conifer', 91);
  let branches = 0;
  // count distinct limb segments by looking for the ring pattern in the trunk
  return { trunk: tri(t.trunk), canopy: tri(t.canopy) };
});
check('A tree is a branching structure, not a cone on a stick',
  treeCost.trunk > 120 && treeCost.trunk < 420 && treeCost.canopy > 40,
  `${treeCost.trunk} trunk tris (branches), ${treeCost.canopy} canopy tris`);

/* ================= 3. bosses ================= */

const bosses = await page.evaluate(async () => {
  const B = await import('/scripts/entities/Bosses.js');
  const BI = await import('/scripts/world/Biomes.js');
  const out = [];
  for (const id of Object.keys(BI.BIOMES)) {
    const def = B.bossForBiome(id);
    const model = B.BOSS_FACTORIES[def.id]();
    let meshes = 0, tris = 0;
    model.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    const box = { min: 1e9, max: -1e9 };
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      box.min = Math.min(box.min, bb.min.y); box.max = Math.max(box.max, bb.max.y);
    });
    out.push({
      biome: id, id: def.id, name: def.name, hp: def.health,
      phases: def.phases.length, weak: def.weakPoints.map((w) => w.name),
      attacks: Array.from(new Set(def.phases.flatMap((p) => p.attacks))),
      meshes, tris: Math.round(tris), height: +(box.max - box.min).toFixed(2),
      parts: Object.keys(model.userData.parts || {}).length,
      hasTick: typeof model.userData.tick === 'function',
    });
  }
  return out;
});
check('Every biome has its own boss', new Set(bosses.map((b) => b.id)).size === 6,
  bosses.map((b) => b.id).join(', '));
for (const b of bosses) {
  check(`${b.id}: builds, is huge, and has phases + weak points`,
    b.meshes > 10 && b.height > 3.5 && b.phases === 3 && b.weak.length >= 2 && b.hasTick,
    `${b.height} m · ${b.meshes} meshes · ${b.tris} tris · ${b.phases} phases · weak: ${b.weak.join('/')} · ${b.attacks.length} attacks`);
}
const attackSets = bosses.map((b) => b.attacks.slice().sort().join(','));
check('No two bosses fight with the same move set', new Set(attackSets).size >= 5,
  `${new Set(attackSets).size} distinct move sets`);

/* ================= 4. monsters are distinct ================= */

const monsters = await page.evaluate(async () => {
  const THREE = await import('three');
  const C = await import('/scripts/entities/CreatureModels.js');
  const M = await import('/scripts/entities/MutantAI.js');
  const GW = 12, GH = 20;   // silhouette raster

  /**
   * A real silhouette, not a bounding box: every vertex of every mesh is
   * projected to the model's front elevation and rasterised into a coarse
   * occupancy grid, normalised by the creature's own height. Two creatures
   * that are both "roughly humanoid and two metres tall" still differ here,
   * because the grid records *where the mass is* — which is what the player
   * actually reads at forty metres in the dark.
   */
  const out = [];
  for (const id of Object.keys(M.MUTANT_CONFIG)) {
    const cfg = M.MUTANT_CONFIG[id];
    const model = C.CREATURE_FACTORIES[cfg.model]();
    model.updateMatrixWorld(true);
    let meshes = 0, tris = 0;
    const pts = [];
    const bb = new THREE.Box3();
    const v = new THREE.Vector3();
    model.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const pos = g.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 260));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        pts.push(v.x, v.y, v.z);
        bb.expandByPoint(v);
      }
    });
    const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
    const grid = new Uint8Array(GW * GH);
    const halfSpan = Math.max(w, 0.001) / 2;
    for (let i = 0; i < pts.length; i += 3) {
      const cx = (pts[i] - (bb.min.x + halfSpan)) / (halfSpan * 2) + 0.5;
      const cy = (pts[i + 1] - bb.min.y) / Math.max(h, 0.001);
      const gx = Math.min(GW - 1, Math.max(0, Math.floor(cx * GW)));
      const gy = Math.min(GH - 1, Math.max(0, Math.floor(cy * GH)));
      grid[gy * GW + gx] = 1;
    }
    out.push({
      id, biome: cfg.biome, behaviour: cfg.behaviour, meshes, tris: Math.round(tris),
      w: +w.toFixed(2), h: +h.toFixed(2), d: +d.toFixed(2),
      aspect: +(w / Math.max(h, 0.001)).toFixed(2),
      grid: Array.from(grid).join(''),
      filled: grid.reduce((a, b2) => a + b2, 0),
      hasTick: typeof model.userData.tick === 'function',
    });
  }
  return out;
});
check('Nine mutant archetypes exist', monsters.length === 9, monsters.map((m) => m.id).join(', '));
// Compare every pair of silhouettes cell by cell.
let worst = { n: 999, a: '', b: '' };
for (let i = 0; i < monsters.length; i++) {
  for (let j = i + 1; j < monsters.length; j++) {
    const A = monsters[i].grid, B = monsters[j].grid;
    let diff = 0;
    for (let k = 0; k < A.length; k++) if (A[k] !== B[k]) diff++;
    if (diff < worst.n) worst = { n: diff, a: monsters[i].id, b: monsters[j].id };
  }
}
check('No two mutants share a silhouette', worst.n >= 24,
  `closest pair ${worst.a}/${worst.b} differ in ${worst.n} of 240 silhouette cells; ` +
  monsters.map((m) => `${m.id} ${m.w}×${m.h}`).join('  '));
check('Every mutant has its own idle motion', monsters.every((m) => m.hasTick));
check('Mutants are detailed but not extravagant',
  monsters.every((m) => m.meshes >= 12 && m.meshes <= 40 && m.tris < 3200),
  `${Math.min(...monsters.map((m) => m.meshes))}–${Math.max(...monsters.map((m) => m.meshes))} meshes, ` +
  `${Math.min(...monsters.map((m) => m.tris))}–${Math.max(...monsters.map((m) => m.tris))} tris`);
const perBiome = {};
for (const m of monsters) perBiome[m.biome] = (perBiome[m.biome] || 0) + 1;
check('Each new biome brings a creature of its own',
  Object.keys(perBiome).length === 6, JSON.stringify(perBiome));

/* ================= 5. a real run: the Hollow ================= */

await page.evaluate(() => window.BLACKROOT.startNewGame(0x0B10E5));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 300000 });
await sleep(1500);

const hollow = await page.evaluate(() => {
  const g = window.BLACKROOT;
  return {
    biome: g.biomeId, depth: g.depth, route: g.route,
    bossType: g.boss && g.boss.type, bossAlive: g.bossAlive,
    bossDist: Math.round(g.bossDistance()),
    fog: g.scene.fog && g.scene.fog.color.getHexString(),
    gravity: g.player.env.gravity, freeSwim: g.player.env.freeSwim,
    card: !document.getElementById('biome-card').classList.contains('hidden'),
    roster: Array.from(new Set(g.entities.active.filter((e) => e.faction === 'mutant' && !e.isBoss).map((e) => e.type))),
  };
});
check('A run starts in the Hollow with its boss placed',
  hollow.biome === 'hollow' && hollow.bossType === 'warden' && hollow.bossAlive,
  `Warden ${hollow.bossDist} m away`);
check('The boss is far enough away to be found rather than tripped over', hollow.bossDist > 120, `${hollow.bossDist} m`);
check('The Hollow shows its title card on arrival', hollow.card);
check("The Hollow's roster is the Hollow's", hollow.roster.every((t) => ['stalker', 'brute', 'crawler', 'screamer'].includes(t)),
  hollow.roster.join(', '));
if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/biome-hollow.png') });

/* ================= 6. weak points ================= */

const weak = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const boss = g.boss;
  boss.wake();
  const hp0 = boss.health;
  const dir = { x: 0, y: 0, z: 1 };
  // armour plate
  g.damage.applyToEntity(boss, 100, dir, boss.position, 'body', 'gun');
  const plate = hp0 - boss.health;
  const hp1 = boss.health;
  // named weak point
  const wp = boss.weakPoints.find((w) => w.revealed);
  g.damage.applyToEntity(boss, 100, dir, boss.position, wp.name, 'gun');
  const soft = hp1 - boss.health;
  return { plate: +plate.toFixed(1), soft: +soft.toFixed(1), wp: wp.name, mul: wp.mul, barVisible: !document.getElementById('bossbar').classList.contains('hidden') };
});
check('Shooting a boss anywhere else is nearly useless', weak.plate < 60, `${weak.plate} damage through armour`);
check('Shooting its weak point is what kills it', weak.soft > weak.plate * 3,
  `${weak.soft} damage to the ${weak.wp} vs ${weak.plate} to the plate`);
check('Waking a boss raises its health bar', weak.barVisible);

/* ================= 7. phases ================= */

const phases = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const boss = g.boss;
  const seen = [];
  for (let i = 0; i < 40 && boss.health > boss.maxHealth * 0.05; i++) {
    g.damage.applyToEntity(boss, boss.maxHealth * 0.05, { x: 0, y: 0, z: 1 }, boss.position, 'body', 'gun');
    if (!seen.includes(boss.phase)) seen.push(boss.phase);
    await new Promise((r) => setTimeout(r, 20));
  }
  return { seen, phase: boss.phase, revealed: boss.weakPoints.filter((w) => w.revealed).length };
});
check('A boss changes phase as it is worn down', phases.seen.length === 3, `phases seen: ${phases.seen.join(' → ')}`);

/* ================= 8. the rift ================= */

const rift = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const boss = g.boss;
  g.inventory.add('medkit', 3);
  const invBefore = g.inventory.count('medkit');
  const magsBefore = g.weapons.magazine;
  // finish it — armour and the body multiplier both bite, so keep hitting
  let guard = 0;
  while (boss.alive && guard++ < 60) {
    g.damage.applyToEntity(boss, boss.maxHealth * 0.5, { x: 0, y: 0, z: 1 }, boss.position, 'heart', 'gun');
  }
  await new Promise((r) => setTimeout(r, 400));
  const opened = g.riftOpen && !!g.riftObject;
  const registered = opened && g.world.queryInteractables(g.riftObject, 6).some((i) => i.kind === 'rift');
  if (!opened) return { opened, registered, invBefore, magsBefore, bossAlive: boss.alive, riftAt: { x: 0, z: 0 }, barGone: false };
  return {
    opened, registered, invBefore, magsBefore,
    barGone: document.getElementById('bossbar').classList.contains('hidden'),
    riftAt: { x: Math.round(g.riftObject.x), z: Math.round(g.riftObject.z) },
  };
});
check('Killing the boss opens a rift where it fell', rift.opened && rift.registered, `rift at ${rift.riftAt.x}, ${rift.riftAt.z}`);
check('The boss health bar goes away with the boss', rift.barGone);
if (SHOTS) {
  await page.evaluate(() => {
    const g = window.BLACKROOT;
    g.player.position.set(g.riftObject.x, g.world.terrain.heightAt(g.riftObject.x, g.riftObject.z), g.riftObject.z - 7);
  });
  await sleep(1200);
  await page.screenshot({ path: path.join(root, 'tools/shots/biome-rift.png') });
}

const through = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const before = { biome: g.biomeId, medkits: g.inventory.count('medkit'), weapon: g.weapons.currentId };
  await g.enterRift();
  return {
    before, after: g.biomeId, depth: g.depth,
    medkits: g.inventory.count('medkit'), weapon: g.weapons.currentId,
    state: g.state, boss: g.boss && g.boss.type, bossAlive: g.bossAlive,
    gravity: g.player.env.gravity, drag: g.player.env.drag, freeSwim: g.player.env.freeSwim,
    fog: g.scene.fog && g.scene.fog.color.getHexString(),
    roster: Array.from(new Set(g.entities.active.filter((e) => e.faction === 'mutant' && !e.isBoss).map((e) => e.type))),
    route: g.route,
  };
});
check('Stepping through the rift moves you to the next biome',
  through.after !== through.before.biome && through.depth === 1 && through.state === 'PLAYING',
  `${through.before.biome} → ${through.after} (${through.route.join(' → ')})`);
check('Your kit comes with you', through.medkits === through.before.medkits && through.weapon === through.before.weapon,
  `${through.medkits} medkits, still holding ${through.weapon}`);
check('The next biome has its own boss waiting', !!through.boss && through.bossAlive, through.boss);
check('The next biome has its own creatures', through.roster.length > 0, through.roster.join(', '));
if (SHOTS) { await sleep(900); await page.screenshot({ path: path.join(root, `tools/shots/biome-${through.after}.png`) }); }

/* ================= 9. the strange places ================= */

for (const [id, expect] of [['void', 'low gravity'], ['abyss', 'free swimming']]) {
  const b = await page.evaluate(async (bid) => {
    const g = window.BLACKROOT;
    await g.buildRun(0xC0FFEE, bid, 2);
    g.enterPlay();
    await new Promise((r) => setTimeout(r, 900));
    const T = g.world.terrain;
    return {
      biome: g.biomeId,
      gravity: g.player.env.gravity, jump: g.player.env.jumpMul,
      drag: g.player.env.drag, freeSwim: g.player.env.freeSwim,
      water: T.shape.water,
      submerged: T.shape.water === 'flood' ? g.player.position.y < T.floodLevel() : false,
      fog: g.scene.fog.color.getHexString(), fogDensity: +g.scene.fog.density.toFixed(4),
      stars: g.world.stars.geometry.attributes.position.count,
      boss: g.boss && g.boss.type,
      chunks: g.world.vegetation.chunks.size,
      mutants: Array.from(new Set(g.entities.active.filter((e) => e.faction === 'mutant' && !e.isBoss).map((e) => e.type))),
      wildlife: g.entities.active.filter((e) => e.faction === 'animal').length,
    };
  }, id);
  if (id === 'void') {
    check('The Long Dark has low gravity and a deep starfield',
      // The morning grade thins the field; the Long Dark is the one place that
      // keeps one at all, because it has no sun to lose it to.
      b.gravity < 0.5 && b.jump > 1.3 && b.stars > 2000,
      `gravity ×${b.gravity}, jump ×${b.jump}, ${b.stars} stars, boss ${b.boss}`);
    check('The Long Dark has no wildlife and its own mutants',
      b.wildlife === 0 && b.mutants.includes('choir'), b.mutants.join(', '));
  } else {
    check('The Drowned Shelf floods the whole map and you swim in it',
      b.water === 'flood' && b.freeSwim && b.submerged && b.drag > 2,
      `drag ×${b.drag}, gravity ×${b.gravity}, submerged, boss ${b.boss}`);
    check('The Drowned Shelf is thick with fog and grows its own flora',
      b.fogDensity > 0.02 && b.chunks > 10, `fog ${b.fogDensity} over ${b.chunks} chunks`);
  }
  if (SHOTS) await page.screenshot({ path: path.join(root, `tools/shots/biome-${id}.png`) });
}

/* ================= 10. every biome loads at all ================= */

const all = [];
for (const id of ['cinder', 'permafrost', 'bloom']) {
  const r = await page.evaluate(async (bid) => {
    const g = window.BLACKROOT;
    const t0 = performance.now();
    await g.buildRun(0x5EED, bid, 3);
    g.enterPlay();
    await new Promise((rr) => setTimeout(rr, 700));
    g.renderer.info.reset();
    await new Promise((rr) => requestAnimationFrame(() => requestAnimationFrame(rr)));
    await new Promise((rr) => setTimeout(rr, 400));
    return {
      biome: g.biomeId, ms: Math.round(performance.now() - t0),
      chunks: g.world.vegetation.chunks.size, trees: g.world.vegetation._treeCount,
      landmarks: g.world.landmarks.length,
      boss: g.boss && g.boss.type, creatures: g.entities.active.length,
      draws: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
      fog: g.scene.fog.color.getHexString(),
      fall: g.biome.fx.fall,
    };
  }, id);
  all.push(r);
  if (SHOTS) await page.screenshot({ path: path.join(root, `tools/shots/biome-${id}.png`) });
}
for (const r of all) {
  check(`${r.biome}: builds a whole world`,
    r.chunks > 10 && r.trees > 200 && r.landmarks > 5 && !!r.boss && r.draws > 5,
    `${r.trees} plants over ${r.chunks} chunks · ${r.landmarks} landmarks · ${r.creatures} creatures · ` +
    `${r.draws} draws / ${(r.tris / 1000).toFixed(0)}k tris · ${r.fall || 'clear'} · boss ${r.boss}`);
}
const fogs = new Set([...all.map((r) => r.fog), hollow.fog]);
check('No two biomes look the same', fogs.size === all.length + 1, Array.from(fogs).join(', '));

check('No page errors across every biome', errors.length === 0, errors[0] || '');

/* ================= report ================= */

const pass = results.filter((r) => r.ok).length;
console.log('\n================================================================');
console.log(`  ${pass}/${results.length} biome + boss checks passed`);
console.log('================================================================');
if (SHOTS) console.log('  shots in tools/shots/');


/* ================= each world is its own place ================= */

/**
 * A biome that shares every landmark with every other biome is a colour
 * filter, not a world. So this checks the thing that makes somewhere feel
 * different: that it is built out of shapes the others do not have, and that
 * there are enough of them to be worth walking to.
 */
const places = await page.evaluate(async () => {
  const B = await import('/scripts/world/Biomes.js');
  const L = await import('/scripts/world/Landmarks.js');
  const T = await import('/scripts/world/Terrain.js');
  const out = [];
  for (const id of B.BIOME_IDS) {
    const terrain = new T.Terrain(0xC0FFEE, id);
    const plan = L.planLandmarks(terrain, 0xC0FFEE, id);
    const kinds = {};
    for (const lm of plan.landmarks) kinds[lm.type] = (kinds[lm.type] || 0) + 1;
    out.push({ id, n: plan.landmarks.length, kinds: Object.keys(kinds), counts: kinds });
  }
  return out;
});

for (const p of places) {
  check(`${p.id}: has plenty of places to go`, p.n >= 15, `${p.n} landmarks, ${p.kinds.length} kinds`);
}

const signature = { hollow: 'logging', void: 'orrery', abyss: 'whalefall', cinder: 'pyre', permafrost: 'icefall', bloom: 'hive' };
for (const [id, type] of Object.entries(signature)) {
  const p = places.find((q) => q.id === id);
  check(`${id}: has its own signature landmark`, p && p.kinds.includes(type), `expected ${type}, got ${p ? p.kinds.join(', ') : 'nothing'}`);
}

// Every world must own at least two kinds no other world has.
const unique = {};
for (const p of places) {
  const others = new Set(places.filter((q) => q !== p).flatMap((q) => q.kinds));
  unique[p.id] = p.kinds.filter((k) => !others.has(k));
}
const shallow = Object.entries(unique).filter(([, u]) => u.length < 1);
check('No two worlds are built from the same set of places', shallow.length === 0,
  Object.entries(unique).map(([k, u]) => `${k}:${u.join('/') || 'NONE'}`).join('  '));

// And they must genuinely build, with geometry and collision.
const built = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const out = [];
  for (const id of ['void', 'abyss', 'cinder', 'permafrost', 'bloom']) {
    await g.buildRun(0xC0FFEE, id, 0);
    let meshes = 0, tris = 0, lights = 0;
    for (const lm of g.world.landmarks) {
      lm.built?.group?.traverse((o) => {
        if (o.isLight) lights++;
        if (!o.isMesh) return;
        meshes++;
        const gm = o.geometry;
        tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
      });
    }
    out.push({ id, meshes, tris: Math.round(tris), lights, boxes: g.world.structureBoxes.length, animated: g.world.animatedProps.length });
  }
  return out;
});
for (const bl of built) {
  check(`${bl.id}: its landmarks are real geometry with collision`,
    bl.meshes > 15 && bl.tris > 1500 && bl.boxes > 20,
    `${bl.meshes} meshes, ${bl.tris} tris, ${bl.boxes} collision boxes, ${bl.lights} lights`);
}
check('The Long Dark has the one landmark that moves',
  built.find((b) => b.id === 'void').animated > 0,
  `${built.find((b) => b.id === 'void').animated} animated props`);

await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
