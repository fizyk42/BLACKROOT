/**
 * Landmarks — hand-authored set pieces, procedurally placed.
 *
 * Every landmark has a gameplay purpose: a loot theme, a threat level and a
 * navigation role. Placement is seeded but constrained (minimum separation,
 * walkable ground, inside the playable radius) so each run reads differently
 * while staying fair.
 */
import * as THREE from 'three';
import { makeRNG } from '../core/RNG.js';
import { PLAYABLE_RADIUS } from './Terrain.js';
import { plankTexture, metalTexture, rockTexture } from './Textures.js';
import { mergeGeometries } from './Vegetation.js';

/* ---------------- landmark catalogue ---------------- */

export const LANDMARK_TYPES = {
  camp:       { label: 'Abandoned Campsite',  clear: 14, threat: 0.0, lootTheme: 'camp',    max: 3 },
  ranger:     { label: 'Ranger Station',      clear: 20, threat: 0.35, lootTheme: 'ranger',  max: 2 },
  cabin:      { label: 'Hunting Cabin',       clear: 18, threat: 0.4, lootTheme: 'cabin',   max: 3 },
  wreck:      { label: 'Crashed Van',         clear: 13, threat: 0.3, lootTheme: 'wreck',   max: 3 },
  checkpoint: { label: 'Military Checkpoint', clear: 24, threat: 0.9, lootTheme: 'military',max: 2 },
  cave:       { label: 'Cave Mouth',          clear: 16, threat: 0.85, lootTheme: 'cave',    max: 2 },
  tower:      { label: 'Radio Tower',         clear: 20, threat: 0.5, lootTheme: 'tower',   max: 1 },
  ruin:       { label: 'Ruined Cabin',        clear: 15, threat: 0.45, lootTheme: 'ruin',    max: 3 },
  graves:     { label: 'Grave Site',          clear: 12, threat: 0.35, lootTheme: 'graves',  max: 2 },
  nest:       { label: 'Mutant Nest',         clear: 17, threat: 1.0, lootTheme: 'nest',    max: 2 },
  dock:       { label: 'Lakeside Dock',       clear: 12, threat: 0.25, lootTheme: 'dock',    max: 1 },
  bridge:     { label: 'Collapsed Bridge',    clear: 16, threat: 0.4, lootTheme: 'wreck',    max: 1 },

  /* --- places that only exist in one world --- */
  monolith:   { label: 'The Standing Slabs',  clear: 26, threat: 0.55, lootTheme: 'tower',   max: 4 },
  orrery:     { label: 'The Orrery',          clear: 24, threat: 0.7, lootTheme: 'military', max: 1 },
  hulk:       { label: 'Trawler Hulk',        clear: 26, threat: 0.6, lootTheme: 'wreck',    max: 3 },
  whalefall:  { label: 'The Ribs',            clear: 24, threat: 0.5, lootTheme: 'graves',   max: 1 },
  pyre:       { label: 'The Burning Tower',   clear: 22, threat: 0.75, lootTheme: 'tower',   max: 1 },
  slagfield:  { label: 'Slag Field',          clear: 26, threat: 0.6, lootTheme: 'cave',     max: 4 },
  icefall:    { label: 'The Frozen Fall',     clear: 24, threat: 0.5, lootTheme: 'cave',     max: 1 },
  sledge:     { label: 'Expedition Camp',     clear: 18, threat: 0.4, lootTheme: 'ranger',   max: 3 },
  capgrove:   { label: 'The Cap Grove',       clear: 26, threat: 0.5, lootTheme: 'camp',     max: 4 },
  hive:       { label: 'Spore Hive',          clear: 20, threat: 1.0, lootTheme: 'nest',     max: 1 },
  logging:    { label: 'Logging Deck',        clear: 22, threat: 0.4, lootTheme: 'cabin',    max: 3 },
};

/**
 * What each world is built out of.
 *
 * A biome that is only a recolour of the Hollow is not a place, it is a
 * filter. So each one gets its own set pieces — things that could not stand
 * anywhere else — and only keeps the generic ruins that would plausibly have
 * been dragged there. A timber hunting cabin has no business on a sea floor.
 *
 * `always` is placed once each; `scatter` is drawn from repeatedly to fill the
 * map out, so a world's character comes from what it is *full* of as much as
 * from its landmarks.
 */
export const BIOME_LANDMARKS = {
  hollow: {
    always: ['ranger', 'logging', 'cabin', 'wreck', 'checkpoint', 'dock'],
    scatter: ['camp', 'logging', 'cabin', 'ruin', 'wreck', 'graves', 'cave', 'nest'],
  },
  void: {
    always: ['orrery', 'monolith', 'checkpoint'],
    scatter: ['monolith', 'graves', 'camp', 'nest', 'ruin'],
  },
  abyss: {
    always: ['hulk', 'whalefall', 'dock'],
    scatter: ['hulk', 'wreck', 'cave', 'graves', 'nest', 'camp'],
  },
  cinder: {
    always: ['pyre', 'slagfield', 'checkpoint'],
    scatter: ['slagfield', 'ruin', 'wreck', 'graves', 'nest', 'camp'],
  },
  permafrost: {
    always: ['icefall', 'sledge', 'ranger'],
    scatter: ['sledge', 'cave', 'camp', 'graves', 'nest', 'ruin'],
  },
  bloom: {
    always: ['capgrove', 'hive', 'cabin'],
    scatter: ['capgrove', 'camp', 'ruin', 'graves', 'nest', 'cave'],
  },
  sandbox: { always: [], scatter: [] },
};

/* ---------------- environmental storytelling ---------------- */

export const NOTES = [
  { id: 'n_camp1', title: 'WATER-DAMAGED PAGE', text:
`Day 3.

The road out is gone. Not blocked — gone. The whole cut through Halloway Ridge
has slumped into the creek and there is no way to get the truck past it.

Ellis says we sit tight. The ranger station has a repeater; if we can get up
there we can raise someone on the emergency channel. Anyone.

I keep telling myself the smell is the slide. Turned earth. Broken roots.

It is not turned earth.` , sig: '— journal, unsigned' },

  { id: 'n_ranger1', title: 'RANGER STATION LOG', text:
`14:20 — Third herd movement of the week, all pushing SOUTH, all at speed.
Deer do not run at midday for nothing.

16:05 — Found a doe below the switchback. No predator sign. No blood loss.
The animal had been opened and closed again. I do not know how else to write it.

21:40 — Repeater still transmitting, nobody answering. Emergency band is
carrier only. No voice. Just carrier, all night, from every station I can reach.

If you are reading this and the tower light is still turning: the medical
cabinet key is in the tin. Take what you need. Take the shells too.` , sig: '— R. Vance, Hollow District' },

  { id: 'n_check1', title: 'FIELD ORDER — PARTIAL', text:
`...CORDON IS HOLDING AT PHASE LINE AMBER. DO NOT ADVANCE BEYOND THE CREEK.

SPECIMENS RECOVERED FROM THE HOLLOW FLOOR CONTINUE TO REGISTER ELEVATED
METABOLIC ACTIVITY UP TO NINE HOURS POST-MORTEM. HANDLE AS LIVE.

CIVILIANS ENCOUNTERED INSIDE THE LINE ARE TO BE ESCORTED OUT AND SCREENED.
IF SCREENING IS REFUSED —

(the rest of the page has been torn away)` , sig: '' },

  { id: 'n_cave1', title: 'SCRAWLED ON A RATION BOX', text:
`it isnt an infection

infection spreads outward. this came UP. the roots are wrong first,
then the animals that eat off the roots, then whatever eats the animals

we drank from the creek for eleven days

dont drink from the creek` , sig: '' },

  { id: 'n_cabin1', title: 'NOTE PINNED TO A DOOR', text:
`Marla —

If you got down here and I'm not back, don't wait past dark. Take the shotgun
and the shells from under the bunk and go up the ridge road, NOT the creek path.

They don't like the light. That's the only true thing I've worked out.
Keep the lamp on even when it feels like wasting it.

I'll find you at the tower.` , sig: '— D.' },

  { id: 'n_nest1', title: 'TORN FIELD NOTEBOOK', text:
`Sample 41 — tissue is not human, but it is not NOT human either.

The mounds are warm. Twelve degrees above ambient, consistently, in a
structure with no metabolism I can identify and no obvious energy input.

They are not nests. Nothing lives in them.
I think they are something closer to lungs.

I am going to stop writing now because it has been quiet for a very long
time and quiet has stopped meaning what it used to mean.` , sig: '— Dr. A. Kessel' },

  { id: 'n_grave1', title: 'MARKER, HAND-CARVED', text:
`SEVEN OF US CAME DOWN THE OLD LOGGING ROAD ON THE 9TH

FOUR ARE HERE

IF YOU ARE COUNTING AND YOU GET TO THREE, STOP COUNTING AND RUN` , sig: '' },

  { id: 'n_tower1', title: 'TAPED TO THE TRANSMITTER', text:
`Broadcast is automated now. I set it to loop the evacuation notice on a
90 second cycle and I am leaving it running because a voice in the dark is
worth something even if it is only a recording of a voice.

The generator has maybe a week.

Whoever gets here after: the light on top still turns. If you can see it,
you can find your way out of the Hollow. That is all I have left to give you.` , sig: '— B. Okoye, relay tech' },

  { id: 'n_ruin1', title: 'CHARRED PAGE', text:
`we burned the first one and the smoke made three people sick for two days

do not burn them

bury them deep or leave them where they fall but do not burn them` , sig: '' },

  { id: 'n_wreck1', title: 'DISPATCH PRINTOUT', text:
`UNIT 12 — ADVISE STATUS. UNIT 12 — ADVISE STATUS.

BE ADVISED ALL HOLLOW ROAD TRAFFIC SUSPENDED PENDING GEOLOGIC SURVEY.

BE ADVISED REPORTS OF LARGE ANIMALS ON THE ROADWAY ARE NOT, REPEAT NOT,
TO BE INVESTIGATED BY SINGLE UNITS.

UNIT 12 — ADVISE STATUS.` , sig: '' },
];

/* ---------------- placement ---------------- */

export function planLandmarks(terrain, seed, biomeId = 'hollow') {
  const rng = makeRNG(seed ^ 0xB1A5E);
  const out = [];

  const spots = [];
  const good = (x, z, clear) => {
    if (Math.hypot(x, z) > PLAYABLE_RADIUS - clear - 14) return false;
    if (terrain.isWater(x, z)) return false;
    if (terrain.slopeAt(x, z) > 0.28) return false;
    for (const s of spots) if (Math.hypot(x - s.x, z - s.z) < s.clear + clear + 30) return false;
    return true;
  };

  const place = (type, opt = {}) => {
    const def = LANDMARK_TYPES[type];
    for (let i = 0; i < 320; i++) {
      let x, z;
      if (opt.near) {
        const a = rng() * Math.PI * 2, r = opt.nearMin + rng() * (opt.nearMax - opt.nearMin);
        x = opt.near.x + Math.cos(a) * r; z = opt.near.z + Math.sin(a) * r;
      } else if (opt.ring) {
        const a = rng() * Math.PI * 2, r = opt.ring[0] + rng() * (opt.ring[1] - opt.ring[0]);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      } else {
        x = rng.range(-PLAYABLE_RADIUS + 40, PLAYABLE_RADIUS - 40);
        z = rng.range(-PLAYABLE_RADIUS + 40, PLAYABLE_RADIUS - 40);
      }
      if (opt.highGround && terrain.rawHeight(x, z) < opt.highGround) continue;
      if (!good(x, z, def.clear)) continue;
      const d = {
        type, x, z, y: terrain.heightAt(x, z), clear: def.clear,
        rot: rng() * Math.PI * 2, label: def.label,
        threat: def.threat, lootTheme: def.lootTheme,
        id: type + '_' + out.length,
        discovered: false,
      };
      spots.push({ x, z, clear: def.clear });
      out.push(d);
      return d;
    }
    return null;
  };

  // The starting camp sits in the middle-ish, on gentle ground.
  let start = null;
  for (let i = 0; i < 500 && !start; i++) {
    const x = rng.range(-140, 140), z = rng.range(-140, 140);
    if (!good(x, z, 16)) continue;
    start = { x, z };
  }
  if (!start) start = { x: 0, z: 0 };
  const camp = place('camp', { near: start, nearMin: 0, nearMax: 6 });
  const spawn = camp || { x: start.x, z: start.z, y: terrain.heightAt(start.x, start.z) };

  // Radio tower on the highest ground we can find — the run's compass.
  let best = null;
  for (let i = 0; i < 900; i++) {
    const x = rng.range(-PLAYABLE_RADIUS + 60, PLAYABLE_RADIUS - 60);
    const z = rng.range(-PLAYABLE_RADIUS + 60, PLAYABLE_RADIUS - 60);
    if (!good(x, z, 20)) continue;
    const h = terrain.heightAt(x, z);
    if (!best || h > best.h) best = { x, z, h };
  }
  if (best) {
    spots.push({ x: best.x, z: best.z, clear: 20 });
    out.push({
      type: 'tower', x: best.x, z: best.z, y: best.h, clear: 20,
      rot: rng() * Math.PI * 2, label: LANDMARK_TYPES.tower.label,
      threat: 0.5, lootTheme: 'tower', id: 'tower_0', discovered: false,
    });
  }

  // What this world is made of. The first landmark of the set goes somewhere
  // you will reach early; the rest are spread out to the horizon so there is
  // always another shape worth walking towards.
  const set = BIOME_LANDMARKS[biomeId] || BIOME_LANDMARKS.hollow;
  const used = {};
  const room = (type) => (used[type] || 0) < (LANDMARK_TYPES[type].max || 2);

  let first = true;
  for (const type of set.always) {
    if (!LANDMARK_TYPES[type] || !room(type)) continue;
    if (type === 'dock') continue;                     // placed on the shore below
    if (place(type, first ? { near: spawn, nearMin: 90, nearMax: 175 } : {})) {
      used[type] = (used[type] || 0) + 1;
      first = false;
    }
  }

  // Then fill the map out. Always take the type that has been used *least* so
  // far rather than picking uniformly: uniform picking with a shared cap means
  // the cheap, common thing (a campsite) fills the world before the things
  // that make it that world get a chance, and the map ends up looking the same
  // everywhere again.
  const bands = [[70, 165], [130, 250], [190, PLAYABLE_RADIUS - 55], [100, 215], [165, PLAYABLE_RADIUS - 50]];
  for (let i = 0; i < 20; i++) {
    const pool = set.scatter.filter((t) => (used[t] || 0) < (LANDMARK_TYPES[t].max || 2));
    if (!pool.length) break;
    let least = Infinity;
    for (const t of pool) least = Math.min(least, used[t] || 0);
    const tier = pool.filter((t) => (used[t] || 0) === least);
    const type = tier[Math.floor(rng() * tier.length)];
    // Only count it as used if it actually found somewhere to stand.
    if (place(type, { ring: bands[i % bands.length] })) used[type] = (used[type] || 0) + 1;
  }

  // Lakeside dock, if the lake shore is usable.
  if (set.always.includes('dock')) for (let i = 0; i < 200; i++) {
    const a = rng() * Math.PI * 2;
    const x = terrain.lake.x + Math.cos(a) * (terrain.lake.r + 4);
    const z = terrain.lake.z + Math.sin(a) * (terrain.lake.r + 4);
    if (!good(x, z, 12)) continue;
    spots.push({ x, z, clear: 12 });
    out.push({
      type: 'dock', x, z, y: terrain.heightAt(x, z), clear: 12,
      rot: Math.atan2(terrain.lake.z - z, terrain.lake.x - x),
      label: LANDMARK_TYPES.dock.label, threat: 0.25, lootTheme: 'dock',
      id: 'dock_0', discovered: false,
    });
    break;
  }

  return { landmarks: out, spawn };
}

/* ---------------- construction ---------------- */

class Builder {
  constructor(mats) {
    this.group = new THREE.Group();
    this.obb = [];          // oriented boxes for collision
    this.lootSpots = [];    // {x,y,z,weightTier}
    this.interactables = []; // {kind,...}
    this.lights = [];
    // Things that move under their own steam: the bake pass must not merge
    // them into the static geometry around them.
    this.animated = [];
    this.mats = mats;
    this.baseY = 0;
  }

  box(w, h, d, mat, x, y, z, rot = 0, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.castShadow = opts.castShadow !== false;
    m.receiveShadow = true;
    m.userData.surface = opts.surface || 'wood';
    this.group.add(m);
    if (opts.collide !== false) {
      this.obb.push({ x, z, hw: w / 2, hd: d / 2, rot, yBot: y - h / 2, yTop: y + h / 2, type: opts.surface || 'wood' });
    }
    return m;
  }

  cyl(rt, rb, h, seg, mat, x, y, z, opts = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.surface = opts.surface || 'wood';
    if (opts.rot) m.rotation.set(opts.rot[0] || 0, opts.rot[1] || 0, opts.rot[2] || 0);
    this.group.add(m);
    if (opts.collide) {
      this.obb.push({ x, z, hw: Math.max(rt, rb), hd: Math.max(rt, rb), rot: 0, yBot: y - h / 2, yTop: y + h / 2, type: opts.surface || 'wood', round: true });
    }
    return m;
  }

  loot(x, y, z, tier = 1) { this.lootSpots.push({ x, y, z, tier }); }
  interact(obj) { this.interactables.push(obj); }
}

function rot2(x, z, r) { const c = Math.cos(r), s = Math.sin(r); return [x * c - z * s, x * s + z * c]; }

/**
 * Build the meshes, colliders and gameplay hooks for one landmark.
 * Returns { group, obb, lootSpots, interactables, lights, enemyHint }
 */
export function buildLandmark(def, terrain, mats, rng) {
  const b = new Builder(mats);
  const H = (dx, dz) => {
    const [x, z] = rot2(dx, dz, def.rot);
    return terrain.heightAt(def.x + x, def.z + z);
  };
  const P = (dx, dz) => {
    const [x, z] = rot2(dx, dz, def.rot);
    return [def.x + x, def.z + z];
  };
  const base = def.y;

  switch (def.type) {
    case 'camp': buildCamp(b, def, terrain, mats, rng, base, P); break;
    case 'ranger': buildRanger(b, def, terrain, mats, rng, base, P); break;
    case 'cabin': buildCabin(b, def, terrain, mats, rng, base, P, false); break;
    case 'ruin': buildCabin(b, def, terrain, mats, rng, base, P, true); break;
    case 'wreck': buildWreck(b, def, terrain, mats, rng, base, P); break;
    case 'checkpoint': buildCheckpoint(b, def, terrain, mats, rng, base, P); break;
    case 'cave': buildCave(b, def, terrain, mats, rng, base, P); break;
    case 'tower': buildTower(b, def, terrain, mats, rng, base, P); break;
    case 'graves': buildGraves(b, def, terrain, mats, rng, base, P); break;
    case 'nest': buildNest(b, def, terrain, mats, rng, base, P); break;
    case 'dock': buildDock(b, def, terrain, mats, rng, base, P); break;
    case 'bridge': buildWreck(b, def, terrain, mats, rng, base, P); break;
    case 'monolith': buildMonolith(b, def, terrain, mats, rng, base, P); break;
    case 'orrery': buildOrrery(b, def, terrain, mats, rng, base, P); break;
    case 'hulk': buildHulk(b, def, terrain, mats, rng, base, P); break;
    case 'whalefall': buildWhalefall(b, def, terrain, mats, rng, base, P); break;
    case 'pyre': buildPyre(b, def, terrain, mats, rng, base, P); break;
    case 'slagfield': buildSlagfield(b, def, terrain, mats, rng, base, P); break;
    case 'icefall': buildIcefall(b, def, terrain, mats, rng, base, P); break;
    case 'sledge': buildSledge(b, def, terrain, mats, rng, base, P); break;
    case 'capgrove': buildCapgrove(b, def, terrain, mats, rng, base, P); break;
    case 'hive': buildHive(b, def, terrain, mats, rng, base, P); break;
    case 'logging': buildLogging(b, def, terrain, mats, rng, base, P); break;
    default: break;
  }

  b.group.position.set(0, 0, 0);
  return {
    group: b.group, obb: b.obb, lootSpots: b.lootSpots,
    interactables: b.interactables, lights: b.lights, animated: b.animated,
  };
}

/* --------- individual set pieces --------- */

function buildCamp(b, def, terrain, mats, rng, base, P) {
  // Dome tent (half-cylinder), dead fire ring, a couple of crates and a bedroll.
  const [tx, tz] = P(2.6, 1.2);
  const tent = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 3.2, 12, 1, false, 0, Math.PI),
    mats.canvas
  );
  tent.rotation.set(Math.PI / 2, 0, def.rot + Math.PI / 2);
  tent.position.set(tx, terrain.heightAt(tx, tz) + 0.02, tz);
  tent.castShadow = true; tent.receiveShadow = true;
  b.group.add(tent);
  b.obb.push({ x: tx, z: tz, hw: 1.7, hd: 1.7, rot: 0, yBot: base - 1, yTop: base + 1.5, type: 'cloth' });

  // fire ring
  const [fx, fz] = P(0, 0);
  const fy = terrain.heightAt(fx, fz);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rx = fx + Math.cos(a) * 1.05, rz = fz + Math.sin(a) * 1.05;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + rng() * 0.12, 0), mats.rock);
    s.position.set(rx, terrain.heightAt(rx, rz) + 0.08, rz);
    s.castShadow = true; s.receiveShadow = true;
    b.group.add(s);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.85, 12), mats.ash);
  ash.rotation.x = -Math.PI / 2;
  ash.position.set(fx, fy + 0.03, fz);
  b.group.add(ash);
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 5), mats.charred);
    l.position.set(fx + Math.cos(a) * 0.3, fy + 0.12, fz + Math.sin(a) * 0.3);
    l.rotation.set(Math.PI / 2 - 0.5, a, 0);
    b.group.add(l);
  }
  b.interact({ kind: 'campfire', x: fx, y: fy + 0.3, z: fz, label: 'Search Cold Ashes', radius: 1.9 });

  // crates
  for (let i = 0; i < 2 + (rng() < 0.5 ? 1 : 0); i++) {
    const [cx, cz] = P(-2.2 - i * 1.1, -1.6 + i * 0.9);
    const cy = terrain.heightAt(cx, cz);
    b.box(0.85, 0.7, 0.85, mats.plank, cx, cy + 0.35, cz, rng() * 0.6, { surface: 'wood' });
    b.loot(cx, cy + 0.8, cz, 1);
  }
  // bedroll + backpack
  const [bx, bz] = P(-0.4, 2.6);
  const by = terrain.heightAt(bx, bz);
  b.box(0.75, 0.2, 2.0, mats.canvas, bx, by + 0.1, bz, def.rot, { collide: false, surface: 'cloth' });
  b.loot(bx, by + 0.3, bz, 1);
  b.loot(fx + 1.4, fy + 0.2, fz - 1.2, 1);
  if (rng.chance(0.7)) b.interact({ kind: 'note', x: bx + 0.6, y: by + 0.35, z: bz, noteId: 'n_camp1', label: 'Read Water-Damaged Page', radius: 1.6 });
}

function buildCabin(b, def, terrain, mats, rng, base, P, ruined) {
  const W = 7.5, D = 6.0, Hh = 3.0;
  const wallT = 0.22;
  const yb = base + Hh / 2;
  const mat = ruined ? mats.charred : mats.plank;

  // floor
  const [cx, cz] = P(0, 0);
  b.box(W, 0.22, D, mat, cx, base + 0.11, cz, def.rot, { collide: false, surface: 'wood' });

  const seg = (dx, dz, w, d) => {
    const [x, z] = P(dx, dz);
    b.box(w, Hh, d, mat, x, yb, z, def.rot, { surface: 'wood' });
  };
  // back wall
  if (!ruined || rng.chance(0.8)) seg(0, -D / 2, W, wallT);
  // side walls
  if (!ruined || rng.chance(0.85)) seg(-W / 2, 0, wallT, D);
  if (!ruined || rng.chance(0.85)) seg(W / 2, 0, wallT, D);
  // front wall with a doorway gap
  const doorW = 1.5;
  seg(-(W - doorW) / 4 - doorW / 4, D / 2, (W - doorW) / 2, wallT);
  seg((W - doorW) / 4 + doorW / 4, D / 2, (W - doorW) / 2, wallT);

  // roof
  if (!ruined) {
    const [rx, rz] = P(0, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(W * 0.82, 2.0, 4), mats.shingle);
    roof.rotation.y = def.rot + Math.PI / 4;
    roof.position.set(rx, base + Hh + 0.9, rz);
    roof.castShadow = true; roof.receiveShadow = true;
    b.group.add(roof);
  } else {
    // collapsed beams
    for (let i = 0; i < 6; i++) {
      const [px, pz] = P(rng.range(-W / 2, W / 2), rng.range(-D / 2, D / 2));
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, rng.range(2.5, 5)), mats.charred);
      beam.position.set(px, base + rng.range(0.2, 1.4), pz);
      beam.rotation.set(rng.range(-0.5, 0.5), rng() * 3.14, rng.range(-0.9, 0.9));
      beam.castShadow = true;
      b.group.add(beam);
    }
  }

  // porch step
  const [sx, sz] = P(0, D / 2 + 0.8);
  b.box(2.4, 0.2, 1.4, mat, sx, base + 0.1, sz, def.rot, { collide: false, surface: 'wood' });

  // interior furniture + loot
  const [bunkX, bunkZ] = P(-W / 2 + 1.2, -D / 2 + 1.3);
  b.box(1.0, 0.5, 2.0, mat, bunkX, base + 0.35, bunkZ, def.rot, { surface: 'wood' });
  b.loot(bunkX, base + 0.75, bunkZ, ruined ? 1 : 2);

  const [tblX, tblZ] = P(W / 2 - 1.6, 0.4);
  b.box(1.4, 0.12, 0.9, mat, tblX, base + 0.85, tblZ, def.rot, { surface: 'wood' });
  b.box(0.1, 0.8, 0.1, mat, tblX, base + 0.4, tblZ, 0, { collide: false });
  b.loot(tblX, base + 1.1, tblZ, ruined ? 1 : 2);
  b.loot(cx + rng.range(-2, 2), base + 0.3, cz + rng.range(-2, 2), 1);

  // shelf / cabinet
  const [shX, shZ] = P(-W / 2 + 0.6, D / 2 - 1.6);
  b.box(0.5, 1.6, 1.4, mat, shX, base + 0.8, shZ, def.rot, { surface: 'wood' });
  b.loot(shX, base + 1.7, shZ, 2);

  if (rng.chance(0.8)) {
    const [nx, nz] = P(0, D / 2 - 0.35);
    b.interact({ kind: 'note', x: nx, y: base + 1.5, z: nz, noteId: ruined ? 'n_ruin1' : 'n_cabin1', label: 'Read Note', radius: 1.8 });
  }
  if (!ruined) {
    const [lx, lz] = P(0, 0);
    b.lights.push({ x: lx, y: base + 2.5, z: lz, color: 0x2b3140, intensity: 0.5, distance: 9 });
  }
}

function buildRanger(b, def, terrain, mats, rng, base, P) {
  const W = 9.5, D = 7.5, Hh = 3.4;
  // stilts + deck
  for (const [dx, dz] of [[-W / 2 + .5, -D / 2 + .5], [W / 2 - .5, -D / 2 + .5], [-W / 2 + .5, D / 2 - .5], [W / 2 - .5, D / 2 - .5]]) {
    const [x, z] = P(dx, dz);
    const gy = terrain.heightAt(x, z);
    b.cyl(0.16, 0.18, base - gy + 0.9, 6, mats.plank, x, gy + (base - gy + 0.9) / 2, z, { collide: true });
  }
  const [fx, fz] = P(0, 0);
  b.box(W, 0.24, D, mats.plank, fx, base + 0.5, fz, def.rot, { collide: false, surface: 'wood' });

  const yb = base + 0.62 + Hh / 2;
  const seg = (dx, dz, w, d) => { const [x, z] = P(dx, dz); b.box(w, Hh, d, mats.plank, x, yb, z, def.rot, { surface: 'wood' }); };
  seg(0, -D / 2, W, 0.22);
  seg(-W / 2, 0, 0.22, D);
  seg(W / 2, 0, 0.22, D);
  const doorW = 1.6;
  seg(-(W - doorW) / 4 - doorW / 4, D / 2, (W - doorW) / 2, 0.22);
  seg((W - doorW) / 4 + doorW / 4, D / 2, (W - doorW) / 2, 0.22);

  // flat roof + antenna
  const [rx, rz] = P(0, 0);
  b.box(W + 0.6, 0.2, D + 0.6, mats.metal, rx, base + 0.62 + Hh + 0.1, rz, def.rot, { collide: false, surface: 'metal' });
  const [ax, az] = P(W / 2 - 1, -D / 2 + 1);
  b.cyl(0.05, 0.07, 4.5, 5, mats.metal, ax, base + 0.62 + Hh + 2.3, az, { surface: 'metal' });

  // steps
  for (let i = 0; i < 3; i++) {
    const [sx, sz] = P(0, D / 2 + 0.5 + i * 0.5);
    b.box(2.0, 0.16, 0.5, mats.plank, sx, base + 0.45 - i * 0.18, sz, def.rot, { collide: false, surface: 'wood' });
  }

  // interior: desk, medical cabinet, radio, map board
  const [dx1, dz1] = P(-W / 2 + 1.6, -D / 2 + 1.4);
  b.box(2.0, 0.14, 1.0, mats.plank, dx1, base + 1.4, dz1, def.rot, { surface: 'wood' });
  b.loot(dx1, base + 1.65, dz1, 2);

  const [mx, mz] = P(W / 2 - 0.8, -1.2);
  b.box(0.4, 1.2, 1.1, mats.metal, mx, base + 1.5, mz, def.rot, { surface: 'metal' });
  b.interact({ kind: 'container', x: mx, y: base + 1.6, z: mz, label: 'Open Medical Cabinet', radius: 2.0, table: 'medical', tier: 3 });

  const [radX, radZ] = P(-1.0, D / 2 - 1.4);
  b.box(0.9, 0.5, 0.6, mats.metal, radX, base + 1.6, radZ, def.rot, { surface: 'metal' });
  b.interact({ kind: 'radio', x: radX, y: base + 1.9, z: radZ, label: 'Use Field Radio', radius: 2.0 });
  b.lights.push({ x: radX, y: base + 1.95, z: radZ, color: 0x35d17a, intensity: 0.35, distance: 4 });

  const [nx, nz] = P(0.4, -D / 2 + 0.4);
  b.interact({ kind: 'note', x: nx, y: base + 2.1, z: nz, noteId: 'n_ranger1', label: 'Read Station Log', radius: 1.8 });
  const [mapX, mapZ] = P(W / 2 - 0.5, 1.6);
  b.interact({ kind: 'map', x: mapX, y: base + 2.0, z: mapZ, label: 'Study District Map', radius: 2.0 });
  b.box(0.08, 1.2, 1.6, mats.paper, mapX, base + 2.0, mapZ, def.rot, { collide: false });

  b.loot(fx + 1.2, base + 0.8, fz + 1.0, 2);
  b.loot(fx - 1.8, base + 0.8, fz + 2.0, 2);
  b.lights.push({ x: fx, y: base + 3.2, z: fz, color: 0x36404f, intensity: 0.7, distance: 12 });
}

function buildWreck(b, def, terrain, mats, rng, base, P) {
  // A van on its side, doors sprung, cargo scattered.
  const [vx, vz] = P(0, 0);
  const roll = rng.chance(0.5) ? 1.35 : -0.35;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.1, 5.2), mats.paint);
  body.position.set(vx, base + 1.0, vz);
  body.rotation.set(0, def.rot, roll);
  body.castShadow = true; body.receiveShadow = true;
  body.userData.surface = 'metal';
  b.group.add(body);
  b.obb.push({ x: vx, z: vz, hw: 2.2, hd: 2.6, rot: def.rot, yBot: base - 1, yTop: base + 2.0, type: 'metal' });

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.4, 1.8), mats.paint);
  const [cbx, cbz] = P(0, 3.2);
  cab.position.set(cbx, base + 0.8, cbz);
  cab.rotation.set(0, def.rot, roll * 0.8);
  cab.castShadow = true;
  b.group.add(cab);

  // wheels
  for (const [dx, dz] of [[-1.1, 1.8], [1.1, 1.8], [-1.1, -1.7], [1.1, -1.7]]) {
    const [wx, wz] = P(dx, dz);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10), mats.rubber);
    w.rotation.set(0, 0, Math.PI / 2 + roll);
    w.position.set(wx, base + 0.5 + Math.abs(roll) * 0.4, wz);
    w.castShadow = true;
    b.group.add(w);
  }

  // spilled crates & a body bag
  for (let i = 0; i < 3; i++) {
    const [px, pz] = P(rng.range(-4, 4), rng.range(-5, 5));
    const py = terrain.heightAt(px, pz);
    b.box(0.7, 0.55, 0.7, mats.plank, px, py + 0.3, pz, rng() * 3, { surface: 'wood' });
    b.loot(px, py + 0.7, pz, 2);
  }
  b.interact({ kind: 'container', x: vx, y: base + 1.2, z: vz, label: 'Search Cargo Bay', radius: 2.6, table: 'wreck', tier: 2 });
  if (rng.chance(0.6)) {
    const [nx, nz] = P(1.6, 2.4);
    b.interact({ kind: 'note', x: nx, y: terrain.heightAt(nx, nz) + 0.4, z: nz, noteId: 'n_wreck1', label: 'Read Dispatch Printout', radius: 1.6 });
  }
  // road stub
  const roadGeo = new THREE.PlaneGeometry(7, 46);
  roadGeo.rotateX(-Math.PI / 2);
  const rp = roadGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const lx = rp.getX(i), lz = rp.getZ(i);
    const [wx, wz] = P(lx, lz);
    rp.setY(i, terrain.heightAt(wx, wz) - base + 0.06);
  }
  roadGeo.computeVertexNormals();
  const road = new THREE.Mesh(roadGeo, mats.asphalt);
  road.position.set(vx, base, vz);
  road.rotation.y = def.rot;
  road.receiveShadow = true;
  road.userData.surface = 'rock';
  b.group.add(road);
}

function buildCheckpoint(b, def, terrain, mats, rng, base, P) {
  // Sandbag line, jersey barriers, a shipping container, floodlight mast.
  for (let i = -4; i <= 4; i++) {
    const [sx, sz] = P(i * 1.25, -4.5);
    const sy = terrain.heightAt(sx, sz);
    for (let r = 0; r < 3 - Math.abs(i) * 0.3; r++) {
      b.box(1.2, 0.42, 0.7, mats.sandbag, sx, sy + 0.21 + r * 0.4, sz + (r % 2) * 0.1, def.rot + rng.range(-0.1, 0.1),
        { collide: r === 0, surface: 'cloth' });
    }
  }
  for (const dx of [-6, -2.2, 2.2, 6]) {
    const [bx, bz] = P(dx, 2.5);
    const by = terrain.heightAt(bx, bz);
    b.box(2.6, 1.0, 0.7, mats.concrete, bx, by + 0.5, bz, def.rot + rng.range(-0.2, 0.2), { surface: 'rock' });
  }
  // container
  const [ctX, ctZ] = P(-5.5, -1.0);
  const cty = terrain.heightAt(ctX, ctZ);
  b.box(6.0, 2.6, 2.5, mats.container, ctX, cty + 1.3, ctZ, def.rot + 0.2, { surface: 'metal' });
  b.interact({ kind: 'container', x: ctX + 3.0, y: cty + 1.2, z: ctZ, label: 'Force Open Supply Container', radius: 2.6, table: 'military', tier: 3, locked: false });

  // floodlight mast (dead)
  const [mx, mz] = P(5.0, -2.0);
  const my = terrain.heightAt(mx, mz);
  b.cyl(0.1, 0.14, 6.0, 6, mats.metal, mx, my + 3.0, mz, { collide: true, surface: 'metal' });
  b.box(0.8, 0.5, 0.4, mats.metal, mx, my + 6.1, mz, def.rot, { collide: false, surface: 'metal' });

  // tent + tables
  const [tx, tz] = P(0.5, 5.0);
  const ty = terrain.heightAt(tx, tz);
  b.box(4.2, 0.12, 3.2, mats.canvas, tx, ty + 2.4, tz, def.rot, { collide: false, surface: 'cloth' });
  for (const [dx, dz] of [[-2, -1.5], [2, -1.5], [-2, 1.5], [2, 1.5]]) {
    b.cyl(0.05, 0.05, 2.4, 4, mats.metal, tx + dx, ty + 1.2, tz + dz, { collide: false });
  }
  b.box(1.6, 0.1, 0.8, mats.metal, tx, ty + 0.9, tz, def.rot, { surface: 'metal' });
  b.loot(tx, ty + 1.2, tz, 3);
  b.loot(ctX + 1.2, cty + 0.4, ctZ + 1.8, 3);
  b.loot(tx - 2.4, ty + 0.3, tz + 1.2, 2);

  const [nx, nz] = P(1.6, 4.2);
  b.interact({ kind: 'note', x: nx, y: terrain.heightAt(nx, nz) + 0.5, z: nz, noteId: 'n_check1', label: 'Read Field Order', radius: 1.7 });
  b.lights.push({ x: tx, y: ty + 2.2, z: tz, color: 0x3a4a5a, intensity: 0.4, distance: 8 });
}

function buildCave(b, def, terrain, mats, rng, base, P) {
  // A rocky mouth with a short, very dark tunnel and a loot chamber.
  const [ex, ez] = P(0, 0);
  const arch = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 13) * Math.PI;
    const rx = Math.cos(a) * 4.6, ry = Math.sin(a) * 4.2;
    const s = new THREE.IcosahedronGeometry(1.4 + rng() * 1.1, 0);
    s.translate(rx, ry, 0);
    arch.push(s);
  }
  const archGeo = mergeGeometries(arch);
  const archMesh = new THREE.Mesh(archGeo, mats.rock);
  archMesh.position.set(ex, base, ez);
  archMesh.rotation.y = def.rot;
  archMesh.castShadow = true; archMesh.receiveShadow = true;
  archMesh.userData.surface = 'rock';
  b.group.add(archMesh);
  // arch colliders
  for (let i = 0; i < 14; i++) {
    const a = (i / 13) * Math.PI;
    const lx = Math.cos(a) * 4.6, ly = Math.sin(a) * 4.2;
    if (ly < 2.2 && Math.abs(lx) > 2.4) {
      const [wx, wz] = P(lx, 0);
      b.obb.push({ x: wx, z: wz, hw: 1.6, hd: 1.6, rot: 0, yBot: base - 2, yTop: base + 4, type: 'rock' });
    }
  }

  // tunnel: a dark box interior behind the mouth
  const L = 16;
  const [tcx, tcz] = P(0, -L / 2 - 2);
  b.box(9.0, 0.4, L, mats.rock, tcx, base - 1.6, tcz, def.rot, { collide: false, surface: 'rock' }); // floor
  // side walls
  const [w1x, w1z] = P(-4.2, -L / 2 - 2);
  const [w2x, w2z] = P(4.2, -L / 2 - 2);
  b.box(1.0, 6, L, mats.rock, w1x, base + 1.4, w1z, def.rot, { surface: 'rock' });
  b.box(1.0, 6, L, mats.rock, w2x, base + 1.4, w2z, def.rot, { surface: 'rock' });
  const [bkx, bkz] = P(0, -L - 2);
  b.box(9.5, 6, 1.0, mats.rock, bkx, base + 1.4, bkz, def.rot, { surface: 'rock' });
  const [ceX, ceZ] = P(0, -L / 2 - 2);
  b.box(9.5, 0.8, L, mats.rock, ceX, base + 4.3, ceZ, def.rot, { collide: false, surface: 'rock' });

  // loot chamber contents
  for (let i = 0; i < 4; i++) {
    const [px, pz] = P(rng.range(-3, 3), -rng.range(5, L));
    b.loot(px, base - 1.2, pz, 3);
  }
  const [cnx, cnz] = P(0, -L + 1);
  b.interact({ kind: 'container', x: cnx, y: base - 1.0, z: cnz, label: 'Search Supply Cache', radius: 2.4, table: 'cave', tier: 4 });
  b.interact({ kind: 'note', x: cnx + 1.6, y: base - 1.0, z: cnz, noteId: 'n_cave1', label: 'Read Ration Box', radius: 1.8 });
  // faint bioluminescence so the mouth is findable
  b.lights.push({ x: ex, y: base + 1.2, z: ez, color: 0x2f5a4a, intensity: 0.5, distance: 10 });
}

function buildTower(b, def, terrain, mats, rng, base, P) {
  const H = 38, legR = 3.2;
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x0 = Math.cos(a) * legR, z0 = Math.sin(a) * legR;
    const x1 = Math.cos(a) * 0.7, z1 = Math.sin(a) * 0.7;
    const len = Math.hypot(x1 - x0, H, z1 - z0);
    const g = new THREE.CylinderGeometry(0.12, 0.16, len, 5);
    const dir = new THREE.Vector3(x1 - x0, H, z1 - z0).normalize();
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((x0 + x1) / 2, H / 2, (z0 + z1) / 2), qq, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    legs.push(g);
    const [wx, wz] = P(x0, z0);
    b.obb.push({ x: wx, z: wz, hw: 0.5, hd: 0.5, rot: 0, yBot: base, yTop: base + 6, type: 'metal' });
  }
  // cross bracing
  for (let lvl = 1; lvl < 9; lvl++) {
    const t = lvl / 9;
    const y = t * H;
    const r = legR * (1 - t) + 0.7 * t;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      const p0 = new THREE.Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r);
      const p1 = new THREE.Vector3(Math.cos(a1) * r, y, Math.sin(a1) * r);
      const len = p0.distanceTo(p1);
      const g = new THREE.CylinderGeometry(0.06, 0.06, len, 4);
      const dir = p1.clone().sub(p0).normalize();
      const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.applyMatrix4(new THREE.Matrix4().compose(p0.clone().lerp(p1, 0.5), qq, new THREE.Vector3(1, 1, 1)));
      legs.push(g);
    }
  }
  const towerGeo = mergeGeometries(legs);
  const tower = new THREE.Mesh(towerGeo, mats.metal);
  const [tx, tz] = P(0, 0);
  tower.position.set(tx, base, tz);
  tower.castShadow = true; tower.receiveShadow = true;
  tower.userData.surface = 'metal';
  b.group.add(tower);

  // beacon
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mats.beacon);
  beacon.position.set(tx, base + H + 0.9, tz);
  b.group.add(beacon);
  b.lights.push({ x: tx, y: base + H + 1.0, z: tz, color: 0xff3322, intensity: 26, distance: 220, beacon: true, mesh: beacon });

  // equipment shed at the base
  const [sx, sz] = P(5.5, 1.5);
  const sy = terrain.heightAt(sx, sz);
  b.box(3.2, 2.4, 2.6, mats.metal, sx, sy + 1.2, sz, def.rot, { surface: 'metal' });
  b.interact({ kind: 'container', x: sx + 1.9, y: sy + 1.2, z: sz, label: 'Open Equipment Locker', radius: 2.4, table: 'tower', tier: 3 });
  b.interact({ kind: 'note', x: sx, y: sy + 1.9, z: sz + 1.6, noteId: 'n_tower1', label: 'Read Taped Note', radius: 1.8 });
  b.loot(sx - 2.4, sy + 0.3, sz + 1.4, 2);
  b.loot(tx + 1.2, base + 0.3, tz - 2.0, 2);
}

function buildGraves(b, def, terrain, mats, rng, base, P) {
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const [gx, gz] = P((i - n / 2) * 1.7 + rng.range(-.3, .3), rng.range(-1.5, 1.5));
    const gy = terrain.heightAt(gx, gz);
    const lean = rng.range(-0.22, 0.22);
    const post = b.box(0.12, 1.3, 0.12, mats.plank, gx, gy + 0.65, gz, def.rot, { collide: false });
    post.rotation.z = lean;
    const cross = b.box(0.7, 0.12, 0.1, mats.plank, gx, gy + 1.05, gz, def.rot, { collide: false });
    cross.rotation.z = lean;
    // mound
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mats.dirt);
    mound.position.set(gx, gy - 0.1, gz);
    mound.scale.set(1, 0.28, 1.5);
    mound.receiveShadow = true;
    b.group.add(mound);
  }
  const [nx, nz] = P(0, 3.0);
  b.interact({ kind: 'note', x: nx, y: terrain.heightAt(nx, nz) + 0.8, z: nz, noteId: 'n_grave1', label: 'Read Carved Marker', radius: 1.8 });
  const [lx, lz] = P(2.5, 2.5);
  b.loot(lx, terrain.heightAt(lx, lz) + 0.3, lz, 2);
}

function buildNest(b, def, terrain, mats, rng, base, P) {
  // Organic mounds and sinew columns — the mutants' territory.
  const n = 7 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 8;
    const [mx, mz] = P(Math.cos(a) * r, Math.sin(a) * r);
    const my = terrain.heightAt(mx, mz);
    const s = rng.range(0.9, 2.6);
    const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mats.flesh);
    const p = mound.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const f = 0.75 + Math.random() * 0.5;
      p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.8, p.getZ(k) * f);
    }
    mound.geometry.computeVertexNormals();
    mound.position.set(mx, my + s * 0.35, mz);
    mound.castShadow = true; mound.receiveShadow = true;
    mound.userData.surface = 'flesh';
    b.group.add(mound);
    b.obb.push({ x: mx, z: mz, hw: s * 0.8, hd: s * 0.8, rot: 0, yBot: my - 1, yTop: my + s, type: 'flesh', round: true });
  }
  // sinew columns rising into the canopy
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2, r = 3 + rng() * 7;
    const [cx, cz] = P(Math.cos(a) * r, Math.sin(a) * r);
    const cy = terrain.heightAt(cx, cz);
    const h = rng.range(5, 11);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.42, h, 6), mats.flesh);
    col.position.set(cx, cy + h / 2, cz);
    col.rotation.set(rng.range(-.2, .2), rng() * 3, rng.range(-.2, .2));
    col.castShadow = true;
    b.group.add(col);
  }
  b.lights.push({ x: def.x, y: base + 1.4, z: def.z, color: 0x7a1c22, intensity: 1.2, distance: 16, pulse: true });
  const [nx, nz] = P(0, 6);
  b.interact({ kind: 'note', x: nx, y: terrain.heightAt(nx, nz) + 0.4, z: nz, noteId: 'n_nest1', label: 'Read Field Notebook', radius: 1.8 });
  for (let i = 0; i < 3; i++) {
    const [px, pz] = P(rng.range(-7, 7), rng.range(-7, 7));
    b.loot(px, terrain.heightAt(px, pz) + 0.3, pz, 3);
  }
}

function buildDock(b, def, terrain, mats, rng, base, P) {
  const len = 9;
  for (let i = 0; i < len; i++) {
    const [px, pz] = P(i * 1.2 - 1, 0);
    const py = terrain.heightAt(px, pz);
    b.box(1.6, 0.12, 1.3, mats.plank, px, Math.max(py, terrain.lakeLevel) + 0.45, pz, def.rot, { collide: false, surface: 'wood' });
    if (i % 2 === 0) b.cyl(0.12, 0.14, 2.2, 5, mats.plank, px, Math.max(py, terrain.lakeLevel) - 0.6, pz, {});
  }
  const [bx, bz] = P(-2.5, 1.6);
  const by = terrain.heightAt(bx, bz);
  b.box(0.8, 0.6, 0.8, mats.plank, bx, by + 0.3, bz, rng() * 3, { surface: 'wood' });
  b.loot(bx, by + 0.7, bz, 2);
  const [wx, wz] = P(len * 1.2, 0);
  b.interact({ kind: 'water', x: wx, y: terrain.lakeLevel + 0.4, z: wz, label: 'Drink from the Lake', radius: 2.6 });
}


/* ======================================================================
 * Places that only exist in one world.
 *
 * Each of these is built out of shapes the other biomes never use, so that
 * arriving somewhere new means seeing forms you have not seen rather than the
 * same cabin under a different sky. They are also all *climbable or walkable
 * in some way* — a landmark you can only look at is scenery; a landmark you
 * can get on top of is a place.
 * ====================================================================== */

/** THE LONG DARK — slabs of black stone standing in a broken ring, some of
 *  them hanging a metre off the ground because gravity here is a suggestion. */
function buildMonolith(b, def, terrain, mats, rng, base, P) {
  const n = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = 7 + rng() * 5;
    const [x, z] = P(Math.cos(a) * r, Math.sin(a) * r);
    const h = 6 + rng() * 7;
    // Some stand, some float: the tell that this place has no proper down.
    const lift = rng() < 0.4 ? rng.range(0.8, 2.6) : 0;
    const slab = b.box(rng.range(1.2, 2.4), h, rng.range(0.5, 1.0), mats.charred,
      x, terrain.heightAt(x, z) + h / 2 + lift, z, a + rng.range(-0.3, 0.3),
      { surface: 'stone' });
    slab.rotation.z = rng.range(-0.09, 0.09);
    if (lift) {
      // A thin seam of light where it should be touching the ground.
      const seam = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x8f6fd8, transparent: true, opacity: 0.6, toneMapped: false }),
      );
      seam.position.set(x, terrain.heightAt(x, z) + 0.04, z);
      seam.rotation.x = -Math.PI / 2;
      b.group.add(seam);
    }
  }
  // A low plinth in the middle you can stand on, with something left on it.
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);
  b.cyl(3.4, 3.8, 0.7, 8, mats.charred, cx, cy + 0.35, cz, { surface: 'stone', collide: true });
  b.loot(cx, cy + 0.8, cz, 3);
  const glow = new THREE.PointLight(0x8f6fd8, 8, 26, 1.4);
  glow.position.set(cx, cy + 2.2, cz);
  b.group.add(glow); b.lights.push(glow);
}

/** THE LONG DARK — concentric stone rings on a tilted plinth, one of them
 *  still turning. The only moving landmark in the game. */
function buildOrrery(b, def, terrain, mats, rng, base, P) {
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);
  b.cyl(5.5, 6.5, 1.2, 10, mats.charred, cx, cy + 0.6, cz, { surface: 'stone', collide: true });
  b.cyl(1.1, 1.4, 3.0, 8, mats.charred, cx, cy + 2.6, cz, { surface: 'stone', collide: true });

  const hub = new THREE.Group();
  hub.position.set(cx, cy + 4.6, cz);
  b.group.add(hub);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x2b2733, roughness: 0.6, metalness: 0.5,
    emissive: 0x4a2f7a, emissiveIntensity: 0.7,
  });
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4 + i * 1.5, 0.13, 8, 40), ringMat);
    ring.rotation.x = Math.PI / 2 + rng.range(-0.5, 0.5);
    ring.rotation.z = rng.range(0, Math.PI);
    ring.castShadow = true;
    hub.add(ring);
    rings.push({ ring, speed: rng.range(0.05, 0.22) * (rng() < 0.5 ? -1 : 1) });
  }
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.75, 1),
    new THREE.MeshBasicMaterial({ color: 0xc9a6ff, toneMapped: false }),
  );
  hub.add(core);
  const l = new THREE.PointLight(0xa678ff, 14, 34, 1.5);
  hub.add(l); b.lights.push(l);

  // Declared animated, so the bake pass leaves it alone.
  hub.userData.tick = (t) => {
    for (const r of rings) r.ring.rotation.z += r.speed * 0.016;
    core.rotation.y = t * 0.4;
    core.scale.setScalar(1 + Math.sin(t * 1.7) * 0.06);
  };
  b.animated.push(hub);
  b.loot(cx + 3, cy + 1.4, cz, 3);
  b.loot(cx - 2.5, cy + 1.4, cz + 2, 2);
}

/** THE DROWNED SHELF — a steel trawler on its side, hull open, deck reachable. */
function buildHulk(b, def, terrain, mats, rng, base, P) {
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);
  const hullMat = mats.container;

  // Hull: a long tapered box, rolled onto its side and half sunk.
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.1, 22, 7, 1), hullMat);
  hull.rotation.set(Math.PI / 2, 0, def.rot);
  hull.position.set(cx, cy + 1.6, cz);
  hull.rotation.x += 0.12;
  hull.castShadow = hull.receiveShadow = true;
  b.group.add(hull);
  b.obb.push({ x: cx, z: cz, hw: 3.2, hd: 11, rot: def.rot, yBot: cy - 1, yTop: cy + 4, type: 'metal' });

  // Wheelhouse, tipped with the hull, and a ladder up onto it.
  const [wx, wz] = P(0, -6.5);
  b.box(4.2, 3.0, 3.6, hullMat, wx, cy + 4.1, wz, def.rot + 0.12, { surface: 'metal' });
  for (let i = 0; i < 5; i++) {
    const [lx, lz] = P(2.6, -6.5 + i * 0.1);
    b.box(1.1, 0.12, 0.12, mats.metal, lx, cy + 1.2 + i * 0.62, lz, def.rot, { surface: 'metal', collide: false });
  }
  // Mast and rigging, snapped off halfway.
  const [mx, mz] = P(-1.2, -4.0);
  b.cyl(0.13, 0.17, 7, 6, mats.metal, mx, cy + 5, mz, { surface: 'metal', rot: [0.5, 0, 0.22] });

  // Net and floats spilling out of the hold.
  for (let i = 0; i < 14; i++) {
    const [fx, fz] = P(rng.range(-5, 6), rng.range(2, 9));
    const fy = terrain.heightAt(fx, fz);
    b.cyl(0.28, 0.28, 0.22, 7, mats.paint, fx, fy + 0.12, fz, { collide: false });
  }
  for (let i = 0; i < 4; i++) {
    const [bx, bz] = P(rng.range(-4, 4), rng.range(-2, 8));
    b.loot(bx, terrain.heightAt(bx, bz) + 0.3, bz, rng() < 0.4 ? 3 : 2);
  }
}

/** THE DROWNED SHELF — the ribcage of something far too large, arching over
 *  you like a nave. You walk down the middle of it. */
function buildWhalefall(b, def, terrain, mats, rng, base, P) {
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xbdb49c, roughness: 0.82, flatShading: true });
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const along = -13 + t * 26;
    const span = 5.6 * Math.sin(0.25 + t * 2.6) + 1.6;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(span, 0.30 + (1 - t) * 0.12, 6, 22, Math.PI), boneMat);
    const [ax, az] = P(0, along);
    arc.position.set(ax, terrain.heightAt(ax, az) - 0.4, az);
    arc.rotation.set(0, def.rot + Math.PI / 2, rng.range(-0.07, 0.07));
    arc.castShadow = arc.receiveShadow = true;
    b.group.add(arc);
    // The ribs are what you shelter behind, so they collide.
    for (const side of [-1, 1]) {
      const [px, pz] = P(side * span * 0.92, along);
      b.obb.push({ x: px, z: pz, hw: 0.4, hd: 0.4, rot: 0, yBot: terrain.heightAt(px, pz), yTop: terrain.heightAt(px, pz) + 2.2, type: 'bone' });
    }
  }
  // Skull at the head of it, jaw open, something inside.
  const [sx, sz] = P(0, -16.5);
  const sy = terrain.heightAt(sx, sz);
  const skull = b.cyl(1.5, 2.6, 6.5, 8, boneMat, sx, sy + 1.4, sz, { surface: 'bone', rot: [Math.PI / 2 - 0.2, def.rot, 0], collide: true });
  skull.scale.set(1, 1, 0.62);
  b.loot(sx, sy + 0.5, sz, 3);
  b.loot(sx + 2, sy + 0.3, sz + 3, 2);
  const g = new THREE.PointLight(0x6fd8c8, 5, 18, 1.4);
  g.position.set(sx, sy + 1.2, sz);
  b.group.add(g); b.lights.push(g);
}

/** CINDER REACH — a fire lookout that burned and is still burning, thirty
 *  years on. The one landmark that lights the horizon. */
function buildPyre(b, def, terrain, mats, rng, base, P) {
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);
  // Four charred legs, one buckled, leaning the whole thing over.
  const lean = 0.14;
  for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
    const [lx, lz] = P(dx, dz);
    const leg = b.cyl(0.22, 0.30, 11, 6, mats.charred, lx + dx * lean, cy + 5.5, lz + dz * lean,
      { surface: 'wood', collide: true });
    leg.rotation.set(dz * lean * 0.1, 0, -dx * lean * 0.1);
  }
  b.box(6.4, 0.35, 6.4, mats.charred, cx, cy + 10.8, cz, def.rot, { surface: 'wood' });
  b.box(5.0, 2.4, 5.0, mats.charred, cx, cy + 12.2, cz, def.rot, { surface: 'wood' });

  // The fire that never went out, at the base and in the cabin.
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff6a1e, toneMapped: false });
  for (let i = 0; i < 26; i++) {
    const [ex, ez] = P(rng.range(-6, 6), rng.range(-6, 6));
    const ey = terrain.heightAt(ex, ez);
    const e = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.1, 0.34), 0), emberMat);
    e.position.set(ex, ey + 0.1, ez);
    b.group.add(e);
  }
  const fire = new THREE.PointLight(0xff7a2a, 26, 46, 1.5);
  fire.position.set(cx, cy + 2.0, cz);
  b.group.add(fire); b.lights.push(fire);
  const top = new THREE.PointLight(0xff9a4a, 16, 34, 1.6);
  top.position.set(cx, cy + 12.4, cz);
  b.group.add(top); b.lights.push(top);

  b.loot(cx + 2, cy + 0.4, cz - 3, 2);
  b.loot(cx, cy + 11.2, cz, 3);
}

/** CINDER REACH — a fissure with basalt columns pushed up around it, glowing
 *  from below. Cover you have to pick your way through. */
function buildSlagfield(b, def, terrain, mats, rng, base, P) {
  const basalt = new THREE.MeshStandardMaterial({ color: 0x241f1d, roughness: 0.9, flatShading: true });
  const n = 16 + Math.floor(rng() * 10);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = 3 + rng() * 13;
    const [x, z] = P(Math.cos(a) * r, Math.sin(a) * r);
    const y = terrain.heightAt(x, z);
    const h = rng.range(1.4, 6.5);
    // Hexagonal columns: the shape basalt actually makes when it cools.
    const col = b.cyl(rng.range(0.5, 1.1), rng.range(0.6, 1.3), h, 6, basalt, x, y + h / 2 - 0.3, z,
      { surface: 'stone', collide: true });
    col.rotation.y = rng() * Math.PI;
    col.rotation.z = rng.range(-0.06, 0.06);
  }
  // The fissure itself: a glowing seam through the middle.
  const seamMat = new THREE.MeshBasicMaterial({ color: 0xff5a12, toneMapped: false });
  for (let i = 0; i < 9; i++) {
    const [x, z] = P(rng.range(-2.5, 2.5), -11 + i * 2.6);
    const y = terrain.heightAt(x, z);
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(rng.range(1.2, 3.4), rng.range(0.8, 2.2)), seamMat);
    seam.position.set(x, y + 0.05, z);
    seam.rotation.set(-Math.PI / 2, 0, rng() * Math.PI);
    b.group.add(seam);
    if (i % 3 === 0) {
      const l = new THREE.PointLight(0xff5a12, 12, 22, 1.6);
      l.position.set(x, y + 1.0, z);
      b.group.add(l); b.lights.push(l);
    }
  }
  const [lx, lz] = P(6, 4);
  b.loot(lx, terrain.heightAt(lx, lz) + 0.3, lz, 2);
}

/** THE STILL WHITE — a waterfall caught mid-fall, and the ice cave behind it. */
function buildIcefall(b, def, terrain, mats, rng, base, P) {
  const ice = new THREE.MeshStandardMaterial({
    color: 0xbcd8e6, roughness: 0.22, metalness: 0.05, transparent: true, opacity: 0.86,
    flatShading: true, emissive: 0x2a4a5c, emissiveIntensity: 0.35,
  });
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);

  // The fall: tapered columns of ice, tallest in the middle.
  for (let i = 0; i < 11; i++) {
    const off = (i - 5) * 1.5;
    const [x, z] = P(off, 0);
    const h = 13 - Math.abs(off) * 0.85 + rng.range(-1, 1);
    const c = b.cyl(rng.range(0.35, 0.8), rng.range(0.7, 1.5), h, 6, ice,
      x, terrain.heightAt(x, z) + h / 2, z, { surface: 'ice', collide: true });
    c.rotation.z = rng.range(-0.04, 0.04);
  }
  // Shattered plates at the foot, which you can climb.
  for (let i = 0; i < 10; i++) {
    const [x, z] = P(rng.range(-8, 8), rng.range(2.5, 8));
    const y = terrain.heightAt(x, z);
    const plate = b.box(rng.range(1.4, 3.6), rng.range(0.3, 0.7), rng.range(1.4, 3.0), ice,
      x, y + 0.3, z, rng() * Math.PI, { surface: 'ice' });
    plate.rotation.z = rng.range(-0.25, 0.25);
  }
  // The hollow behind it — the reason to come here.
  const [hx, hz] = P(0, -3.4);
  const hy = terrain.heightAt(hx, hz);
  b.loot(hx, hy + 0.35, hz, 3);
  b.loot(hx + 1.6, hy + 0.35, hz - 0.6, 2);
  const glow = new THREE.PointLight(0x9fd0e8, 9, 26, 1.4);
  glow.position.set(hx, hy + 2.0, hz);
  b.group.add(glow); b.lights.push(glow);
}

/** THE STILL WHITE — a survey camp that did not make it out: two tents flat
 *  under the snow, a sledge, and a line of marker poles going nowhere. */
function buildSledge(b, def, terrain, mats, rng, base, P) {
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);
  const snow = new THREE.MeshStandardMaterial({ color: 0xd6e2ea, roughness: 0.95 });

  // Collapsed tents: humps of snow with a strut poking out.
  for (const [dx, dz] of [[-3.2, 1.0], [2.6, -1.4]]) {
    const [x, z] = P(dx, dz);
    const y = terrain.heightAt(x, z);
    const hump = new THREE.Mesh(new THREE.SphereGeometry(1.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), snow);
    hump.position.set(x, y - 0.35, z);
    hump.scale.set(1.3, 0.55, 1);
    hump.castShadow = hump.receiveShadow = true;
    b.group.add(hump);
    b.cyl(0.05, 0.05, 2.2, 5, mats.metal, x + 1.1, y + 0.6, z + 0.4, { rot: [0.5, 0, 0.7] });
    b.loot(x, y + 0.2, z, 2);
  }
  // The sledge itself, half buried, still loaded.
  const [sx, sz] = P(0, 3.2);
  const sy = terrain.heightAt(sx, sz);
  b.box(1.3, 0.22, 3.4, mats.plank, sx, sy + 0.18, sz, def.rot, { surface: 'wood' });
  b.box(1.0, 0.7, 1.2, mats.container, sx, sy + 0.66, sz - 0.6, def.rot, { surface: 'metal' });
  b.loot(sx, sy + 1.1, sz - 0.6, 3);

  // Marker poles heading off into the white, spaced further and further apart
  // until whoever was planting them stopped.
  let step = 4;
  for (let i = 0; i < 7; i++) {
    const [x, z] = P(rng.range(-1, 1), 6 + i * step);
    const y = terrain.heightAt(x, z);
    b.cyl(0.05, 0.05, 2.4, 5, mats.plank, x, y + 1.2, z, { collide: false });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xd0512e, roughness: 1, side: THREE.DoubleSide }));
    flag.position.set(x + 0.26, y + 2.15, z);
    b.group.add(flag);
    step *= 1.25;
  }
}

/** THE BLOOM — mushrooms the size of trees, with one cap low enough to climb
 *  onto and a canopy of spore-light underneath. */
function buildCapgrove(b, def, terrain, mats, rng, base, P) {
  const stalk = new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.92 });
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x8f4d6a, roughness: 0.78, flatShading: true,
    emissive: 0x3a1030, emissiveIntensity: 0.5,
  });
  const gillMat = new THREE.MeshBasicMaterial({ color: 0xffb9e0, toneMapped: false, side: THREE.DoubleSide });

  const n = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const r = i === 0 ? 0 : 5 + rng() * 9;
    const [x, z] = P(Math.cos(a) * r, Math.sin(a) * r);
    const y = terrain.heightAt(x, z);
    // One short one, so there is a way up.
    const h = i === 1 ? rng.range(2.2, 2.8) : rng.range(5, 11);
    const capR = h * rng.range(0.42, 0.62);
    b.cyl(h * 0.10, h * 0.16, h, 9, stalk, x, y + h / 2, z, { surface: 'flesh', collide: true });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    cap.position.set(x, y + h, z);
    cap.scale.y = rng.range(0.42, 0.66);
    cap.castShadow = cap.receiveShadow = true;
    b.group.add(cap);
    // Gills: the light source of the whole biome, seen from underneath.
    const gills = new THREE.Mesh(new THREE.CircleGeometry(capR * 0.94, 16), gillMat);
    gills.position.set(x, y + h - 0.02, z);
    gills.rotation.x = Math.PI / 2;
    b.group.add(gills);
    const l = new THREE.PointLight(0xff8ac8, 7, capR * 4.5, 1.5);
    l.position.set(x, y + h - 0.6, z);
    b.group.add(l); b.lights.push(l);
    // A cap you can stand on gets something on it worth the climb.
    if (i === 1) b.loot(x, y + h + 0.4, z, 3);
    else if (rng() < 0.6) b.loot(x + capR * 0.6, y + 0.3, z, 2);
  }
}

/** THE BLOOM — the thing the spores are coming from. Not a building. */
function buildHive(b, def, terrain, mats, rng, base, P) {
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);
  const fleshMat = new THREE.MeshStandardMaterial({
    color: 0x6b3348, roughness: 0.72, flatShading: true,
    emissive: 0x2c0a22, emissiveIntensity: 0.6,
  });
  // A bulbous mass, and vents growing out of it at angles.
  const mass = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), fleshMat);
  mass.position.set(cx, cy + 2.4, cz);
  mass.scale.set(1, 0.75, 1.1);
  mass.castShadow = mass.receiveShadow = true;
  b.group.add(mass);
  b.obb.push({ x: cx, z: cz, hw: 4, hd: 4, rot: 0, yBot: cy, yTop: cy + 5, type: 'flesh', round: true });

  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const r = 3.2 + rng() * 2;
    const [x, z] = P(Math.cos(a) * r, Math.sin(a) * r);
    const y = terrain.heightAt(x, z);
    const h = rng.range(2.5, 5.5);
    const vent = b.cyl(0.45, 0.9, h, 7, fleshMat, x, y + h / 2, z, { surface: 'flesh', collide: true });
    vent.rotation.set(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3));
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.42, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd2f0, toneMapped: false }));
    mouth.position.set(x, y + h, z);
    mouth.rotation.x = -Math.PI / 2;
    b.group.add(mouth);
  }
  const l = new THREE.PointLight(0xff6ab0, 16, 32, 1.4);
  l.position.set(cx, cy + 3.2, cz);
  b.group.add(l); b.lights.push(l);
  b.loot(cx + 4.5, cy + 0.3, cz, 3);
  b.loot(cx - 3.8, cy + 0.3, cz + 2.5, 3);
}


/** THE HOLLOW — where they were cutting when it started. A deck of stacked
 *  logs you can climb, a skidder with its door open, and a field of stumps
 *  that stops abruptly halfway through a row. */
function buildLogging(b, def, terrain, mats, rng, base, P) {
  const [cx, cz] = P(0, 0);
  const cy = terrain.heightAt(cx, cz);

  // The deck: three courses of logs, each shorter than the one below, so it
  // reads as a stack and can be walked up.
  for (let row = 0; row < 3; row++) {
    const count = 6 - row;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * 0.92;
      const [x, z] = P(off, 0);
      const log = b.cyl(0.44, 0.48, rng.range(5.5, 7.5), 8, mats.plank,
        x, cy + 0.45 + row * 0.86, z, { surface: 'wood', collide: true });
      log.rotation.set(Math.PI / 2, def.rot + rng.range(-0.03, 0.03), 0);
    }
  }
  b.loot(cx, cy + 2.9, cz, 2);

  // The skidder: a boxy machine on fat tyres, one door hanging open.
  const [sx, sz] = P(8.5, 3.0);
  const sy = terrain.heightAt(sx, sz);
  b.box(2.4, 1.5, 4.0, mats.paint, sx, sy + 1.5, sz, def.rot, { surface: 'metal' });
  b.box(1.9, 1.3, 1.7, mats.metal, sx, sy + 2.9, sz - 0.7, def.rot, { surface: 'metal' });
  for (const [dx, dz] of [[-1.3, 1.3], [1.3, 1.3], [-1.3, -1.3], [1.3, -1.3]]) {
    const [wx, wz] = P(8.5 + dx, 3.0 + dz);
    const w = b.cyl(0.78, 0.78, 0.62, 12, mats.rubber, wx, sy + 0.78, wz, { collide: false });
    w.rotation.z = Math.PI / 2;
    w.rotation.y = def.rot;
  }
  const [dx2, dz2] = P(7.1, 3.4);
  const door = b.box(0.08, 1.2, 1.4, mats.paint, dx2, sy + 1.6, dz2, def.rot + 0.9, { surface: 'metal', collide: false });
  b.loot(sx, sy + 1.2, sz + 2.4, 2);

  // Stumps, in rows, stopping mid-row.
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    const cut = r === rows - 1 ? 2 + Math.floor(rng() * 2) : 5;
    for (let i = 0; i < cut; i++) {
      const [x, z] = P(-11 + i * 2.6 + r * 0.4, -6 - r * 2.8);
      const y = terrain.heightAt(x, z);
      b.cyl(0.42, 0.52, 0.5, 9, mats.plank, x, y + 0.2, z, { surface: 'wood', collide: true });
    }
  }
  // A saw left in the last stump.
  const [gx, gz] = P(-11 + 2 * 2.6 + (rows - 1) * 0.4, -6 - (rows - 1) * 2.8);
  b.loot(gx, terrain.heightAt(gx, gz) + 0.5, gz, 3);
}
