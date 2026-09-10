// Headless checks that can actually run without a GPU:
//   1. every import in the client resolves to a real file and a real export
//   2. the road graph, pathfinder and city layout behave
//   3. the economy cannot be made to pay the same reward twice
//
// Run with: npm run test:logic

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'client', 'src');

let passed = 0, failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function section(t) { console.log(`\n${t}`); }

// ------------------------------------------------------------------ 1. imports

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Very small ES module surface scanner — enough to catch typos in export names. */
function exportedNames(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  const re = /export\s+(?:async\s+)?(?:default\s+)?(class|function|const|let|var)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(src))) names.add(m[2]);
  const re2 = /export\s*\{([^}]*)\}/g;
  while ((m = re2.exec(src))) {
    for (const part of m[1].split(',')) {
      const bit = part.trim().split(/\s+as\s+/);
      const name = (bit[1] || bit[0] || '').trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  if (/export\s+\*/.test(src)) names.add('*');
  return names;
}

section('Import graph');

const files = walk(SRC);
const exportCache = new Map();
const importRe = /import\s+([^'"]*?)\s+from\s+['"]([^'"]+)['"]/g;

let importsChecked = 0;
const missingFiles = [];
const missingExports = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = importRe.exec(src))) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith('.')) continue;   // 'three' / 'three/addons/...' come from the import map
    const target = path.resolve(path.dirname(file), spec);
    importsChecked++;
    if (!fs.existsSync(target)) {
      missingFiles.push(`${path.relative(ROOT, file)} -> ${spec}`);
      continue;
    }
    if (!exportCache.has(target)) exportCache.set(target, exportedNames(target));
    const avail = exportCache.get(target);
    if (avail.has('*')) continue;
    const braced = clause.match(/\{([^}]*)\}/);
    if (!braced) continue;
    for (const raw of braced[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!avail.has(name)) {
        missingExports.push(`${path.relative(ROOT, file)} imports "${name}" from ${spec}`);
      }
    }
  }
}

check(`all ${importsChecked} relative imports resolve to a file`, () => {
  if (missingFiles.length) throw new Error('\n        ' + missingFiles.join('\n        '));
});
check('all named imports exist in their source module', () => {
  if (missingExports.length) throw new Error('\n        ' + missingExports.join('\n        '));
});
check('vendored three.js and addons are present', () => {
  for (const p of [
    'client/vendor/three/three.module.js',
    'client/vendor/three/addons/loaders/GLTFLoader.js',
    'client/vendor/three/addons/utils/SkeletonUtils.js',
    'client/vendor/three/addons/utils/BufferGeometryUtils.js',
  ]) ok(fs.existsSync(path.join(ROOT, p)), 'missing ' + p);
});
check('character asset and its licence are present', () => {
  ok(fs.existsSync(path.join(ROOT, 'client/assets/characters/citizen.gltf')), 'gltf missing');
  ok(fs.existsSync(path.join(ROOT, 'client/assets/characters/citizen.bin')), 'bin missing');
  ok(fs.existsSync(path.join(ROOT, 'client/assets/characters/LICENSE-quaternius-CC0.txt')), 'licence missing');
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/characters/citizen.gltf'), 'utf8'));
  eq(g.buffers[0].uri, 'citizen.bin', 'buffer uri rewritten');
  ok(g.animations.length > 30, 'expected the full animation library');
});

// ------------------------------------------------------------------ 2. city

section('City layout and road graph');

const { CITY, RoadGraph, districtAt, isOnRoad, isOnPavement, POIS, collectibleSpots, streetNameAt } =
  await import('../client/src/world/citymap.js');

const graph = new RoadGraph();

check('grid has the expected number of intersections', () => {
  eq(graph.nodes.length, CITY.CELLS * CITY.CELLS);
});
check('every intersection has 2 to 4 exits', () => {
  for (const n of graph.nodes) {
    ok(n.out.length >= 2 && n.out.length <= 4, `node ${n.i},${n.j} has ${n.out.length}`);
  }
});
check('edges are reciprocal (every road can be driven both ways)', () => {
  for (const e of graph.edges) {
    const back = graph.edges.find((x) => x.a === e.b && x.b === e.a);
    ok(back, `no return edge for ${e.a}->${e.b}`);
  }
});
check('lane points sit on the correct side of the centreline', () => {
  const e = graph.edges.find((x) => x.axis === 'x' && x.dx === 1);
  const p = graph.lanePoint(e, 0.5, 0, {});
  const centreZ = graph.nodes[e.a].z;
  // Driving east (+x), the right-hand lane is at greater z... check the sign is consistent
  // with the opposite direction being mirrored.
  const back = graph.edges.find((x) => x.a === e.b && x.b === e.a);
  const q = graph.lanePoint(back, 0.5, 0, {});
  ok(Math.sign(p.z - centreZ) === -Math.sign(q.z - centreZ), 'opposing lanes must be on opposite sides');
  ok(Math.abs(p.z - centreZ) < CITY.ROAD_HALF, 'lane must be inside the carriageway');
});
check('A* finds a route across the whole map', () => {
  const a = graph.node(0, 0), b = graph.node(CITY.CELLS - 1, CITY.CELLS - 1);
  const path = graph.findPath(a.id, b.id);
  ok(path, 'no path found');
  eq(path[0], a.id);
  eq(path[path.length - 1], b.id);
  // Manhattan distance on a full grid: the shortest route is (cells-1)*2 + 1 nodes.
  eq(path.length, (CITY.CELLS - 1) * 2 + 1, 'path should be a shortest Manhattan route');
});
check('A* between every district pair succeeds', () => {
  const corners = [[0, 0], [11, 0], [0, 11], [11, 11], [5, 5], [8, 2]];
  for (const [i0, j0] of corners) {
    for (const [i1, j1] of corners) {
      const p = graph.findPath(graph.node(i0, j0).id, graph.node(i1, j1).id);
      ok(p, `no path ${i0},${j0} -> ${i1},${j1}`);
    }
  }
});
check('pathToWaypoints returns usable world coordinates', () => {
  const p = graph.findPath(graph.node(1, 1).id, graph.node(4, 3).id);
  const wps = graph.pathToWaypoints(p, 0);
  ok(wps.length >= p.length, 'expected at least one waypoint per hop');
  for (const w of wps) ok(Number.isFinite(w.x) && Number.isFinite(w.z), 'non-finite waypoint');
});
check('traffic lights never show green on both axes at once', () => {
  for (let t = 0; t < CITY.LIGHT_CYCLE * 3; t += 0.25) {
    for (const n of [graph.node(0, 0), graph.node(1, 0), graph.node(5, 7)]) {
      const l = graph.lightFor(n, t);
      ok(!(l.x === 'green' && l.z === 'green'), `both green at t=${t}`);
    }
  }
});
check('adjacent intersections run on opposite phases', () => {
  const a = graph.lightFor(graph.node(3, 3), 0);
  const b = graph.lightFor(graph.node(4, 3), 0);
  ok(a.z !== b.z, 'neighbouring lights should differ');
});
check('road and pavement tests are mutually exclusive', () => {
  for (let k = 0; k < 400; k++) {
    const x = Math.random() * CITY.PITCH * 6;
    const z = Math.random() * CITY.PITCH * 6;
    ok(!(isOnRoad(x, z) && isOnPavement(x, z)), `overlap at ${x},${z}`);
  }
});
check('every point of interest is off the carriageway', () => {
  for (const p of POIS) {
    if (p.id === 'pier') continue;   // the pier deliberately sits over the water
    ok(!isOnRoad(p.x, p.z), `${p.id} is in the road`);
  }
});
check('points of interest have unique ids and names', () => {
  eq(new Set(POIS.map((p) => p.id)).size, POIS.length, 'duplicate id');
  eq(new Set(POIS.map((p) => p.name)).size, POIS.length, 'duplicate name');
});
check('20 collectibles are placed on pavements, well spread', () => {
  const spots = collectibleSpots(20);
  eq(spots.length, 20);
  for (const s of spots) ok(isOnPavement(s.x, s.z), `${s.id} not on a pavement`);
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) > 80, 'collectibles too close');
    }
  }
});
check('collectible placement is deterministic', () => {
  eq(JSON.stringify(collectibleSpots(20)), JSON.stringify(collectibleSpots(20)));
});
check('street naming returns a name anywhere in the grid', () => {
  for (let k = 0; k < 50; k++) {
    const n = streetNameAt(Math.random() * 900, Math.random() * 900);
    ok(typeof n === 'string' && n.length > 0);
  }
});
check('districts cover the whole grid', () => {
  const seen = new Set();
  for (let i = 0; i < CITY.CELLS; i++) for (let j = 0; j < CITY.CELLS; j++) seen.add(districtAt(i, j));
  ok(seen.size >= 5, 'expected at least five districts, got ' + seen.size);
});

// ------------------------------------------------------------------ 3. economy

section('Economy and anti-duplication');

const { Economy, BUSINESSES, PROPERTIES } = await import('../client/src/game/economy.js');

check('a reward can be banked exactly once', () => {
  const e = new Economy({ money: 0 });
  const a = e.claim('job_1', 500);
  eq(a.ok, true);
  eq(e.money, 500);
  const b = e.claim('job_1', 500);
  eq(b.ok, false, 'second claim must be refused');
  eq(b.reason, 'already-claimed');
  eq(e.money, 500, 'money must not change on a refused claim');
});

check('reloading a save cannot re-bank a reward that save already banked', () => {
  const e = new Economy({ money: 0 });
  e.claim('mission_homecoming', 500);
  const snapshot = JSON.parse(JSON.stringify(e.serialise()));
  // ... player carries on and spends it ...
  e.spend(500, 'car');
  eq(e.money, 0);
  // ... then reloads the save from before the spend and tries the mission again.
  const reloaded = Economy.deserialise(snapshot);
  eq(reloaded.money, 500, 'the save restores the money that existed at save time');
  const retry = reloaded.claim('mission_homecoming', 500);
  eq(retry.ok, false, 'the mission reward must not pay out twice');
  eq(reloaded.money, 500);
});

check('the ledger survives a full serialise/deserialise round trip', () => {
  const e = new Economy({ money: 100 });
  for (let i = 0; i < 25; i++) e.claim('job_' + i, 10);
  const round = Economy.deserialise(JSON.parse(JSON.stringify(e.serialise())));
  eq(round.money, e.money);
  for (let i = 0; i < 25; i++) eq(round.hasClaimed('job_' + i), true, 'lost ledger entry ' + i);
  eq(round.claim('job_7', 10).ok, false);
});

check('a vehicle cannot be granted to the same garage twice', () => {
  const e = new Economy();
  eq(e.addVehicle({ id: 'v1', spec: 'sedan', health: 100 }).ok, true);
  eq(e.addVehicle({ id: 'v1', spec: 'sedan', health: 100 }).ok, false);
  eq(e.vehicleList.length, 1);
});

check('vehicles survive a save round trip without multiplying', () => {
  const e = new Economy();
  e.addVehicle({ id: 'v1', spec: 'sedan', health: 90 });
  e.addVehicle({ id: 'v2', spec: 'sports', health: 100 });
  const round = Economy.deserialise(JSON.parse(JSON.stringify(e.serialise())));
  eq(round.vehicleList.length, 2);
  eq(round.addVehicle({ id: 'v1', spec: 'sedan', health: 90 }).ok, false);
  eq(round.vehicleList.length, 2);
});

check('spending more than you have is refused', () => {
  const e = new Economy({ money: 100 });
  eq(e.spend(101, 'x').ok, false);
  eq(e.money, 100);
  eq(e.spend(100, 'x').ok, true);
  eq(e.money, 0);
});

check('fines never push the wallet negative', () => {
  const e = new Economy({ money: 120 });
  const taken = e.fine(5000, 'busted');
  eq(taken, 120);
  eq(e.money, 0);
});

check('revision increases on every state change', () => {
  const e = new Economy({ money: 1000 });
  const r0 = e.revision;
  e.claim('a', 10); e.spend(5, 'x'); e.addVehicle({ id: 'z', spec: 'sedan' });
  ok(e.revision >= r0 + 3, 'revision should track mutations');
});

check('business income accrues but must be collected', () => {
  const e = new Economy({ money: 1000000 });
  eq(e.buyBusiness('diner').ok, true);
  const before = e.money;
  e.tickBusinesses(2);            // two in-game hours
  eq(e.money, before, 'income must not appear in the wallet on its own');
  const c = e.collectBusiness('diner');
  eq(c.ok, true);
  const def = BUSINESSES.find((b) => b.id === 'diner');
  eq(c.amount, Math.floor((def.incomePerHour - def.upkeepPerHour) * 2));
  eq(e.money, before + c.amount);
  eq(e.collectBusiness('diner').ok, false, 'nothing left to collect');
});

check('garage capacity grows with property', () => {
  const e = new Economy({ money: 1000000 });
  const base = e.garageCapacity();
  eq(e.buyProperty('apartment_2').ok, true);
  const def = PROPERTIES.find((p) => p.id === 'apartment_2');
  eq(e.garageCapacity(), base + def.garageSlots);
  eq(e.buyProperty('apartment_2').ok, false, 'cannot buy the same property twice');
});

check('an authoritative server snapshot overwrites the local wallet', () => {
  const e = new Economy({ money: 999999 });
  e.applyAuthoritative({ money: 250, revision: 7, ledger: ['job_x'] });
  eq(e.money, 250);
  eq(e.hasClaimed('job_x'), true);
  eq(e.claim('job_x', 500).ok, false);
});

// ------------------------------------------------------------------ 4. missions

section('Mission data');

const { MISSIONS, missionById } = await import('../client/src/game/missions.js');

check('there are 20 missions with unique ids and sequential numbers', () => {
  eq(MISSIONS.length, 20);
  eq(new Set(MISSIONS.map((m) => m.id)).size, 20, 'duplicate mission id');
  MISSIONS.forEach((m, i) => eq(m.number, i + 1, 'mission numbering'));
});
check('exactly three missions are marked implemented, and they have steps', () => {
  const impl = MISSIONS.filter((m) => m.implemented);
  eq(impl.length, 3);
  for (const m of impl) ok(m.steps.length > 0, `${m.id} has no steps`);
});
check('unimplemented missions honestly declare themselves', () => {
  for (const m of MISSIONS.filter((x) => !x.implemented)) {
    eq(m.steps.length, 0, `${m.id} claims steps but is not implemented`);
  }
});
check('mission prerequisites form a valid chain', () => {
  const ids = new Set(MISSIONS.map((m) => m.id));
  const done = new Set();
  for (const m of MISSIONS) {
    for (const r of m.requires) {
      ok(ids.has(r), `${m.id} requires unknown mission ${r}`);
      ok(done.has(r), `${m.id} requires ${r} which comes later`);
    }
    done.add(m.id);
  }
});
check('every implemented mission step uses a known step type', () => {
  const known = new Set(['dialogue', 'goto', 'driveTo', 'timedDriveTo', 'grantVehicle', 'enterVehicle', 'race', 'wait']);
  for (const m of MISSIONS.filter((x) => x.implemented)) {
    for (const s of m.steps) ok(known.has(s.type), `${m.id}: unknown step "${s.type}"`);
  }
});
check('mission goto/driveTo targets are finite coordinates', () => {
  for (const m of MISSIONS.filter((x) => x.implemented)) {
    for (const s of m.steps) {
      if (s.pos) ok(Number.isFinite(s.pos.x) && Number.isFinite(s.pos.z), `${m.id}: bad position`);
    }
  }
});
check('missionById finds every mission', () => {
  for (const m of MISSIONS) ok(missionById(m.id) === m);
});

// ------------------------------------------------------------------ summary

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(` - ${f.name}: ${f.error.message}`);
  process.exit(1);
}
