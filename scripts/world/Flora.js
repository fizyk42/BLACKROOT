/**
 * Flora — the geometry library every biome's ground cover is built from.
 *
 * The headline piece is `branchTree`: instead of a cone stack on a cylinder,
 * a tree is grown recursively — a trunk with a root flare that tapers and
 * curves, primary limbs that split, twigs off those, and leaf cards clustered
 * where the twigs actually end. That gives a real branching silhouette against
 * the sky, which is the thing the eye reads as "tree" long before it can make
 * out a leaf.
 *
 * All of it is baked once into two merged geometries per species — trunk and
 * canopy — and drawn with InstancedMesh, so ten thousand of them still cost
 * two draw calls per chunk. Build time is paid during the loading screen; the
 * frame budget is untouched.
 */
import * as THREE from 'three';
import { makeRNG } from '../core/RNG.js';

/* ------------------------------------------------------------------ */
/* merge                                                               */
/* ------------------------------------------------------------------ */

/** Minimal geometry merge (avoids pulling in the addons build). */
export function mergeGeometries(geoms) {
  geoms = geoms.filter((g) => g && g.attributes.position && g.attributes.position.count);
  if (!geoms.length) return new THREE.BufferGeometry();
  let vCount = 0, iCount = 0;
  const hasUV = geoms.every((g) => g.attributes.uv);
  const hasNormal = geoms.every((g) => g.attributes.normal);
  for (const g of geoms) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = hasNormal ? new Float32Array(vCount * 3) : null;
  const uv = hasUV ? new Float32Array(vCount * 2) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const gp = g.attributes.position;
    pos.set(gp.array, vo * 3);
    if (nrm && g.attributes.normal) nrm.set(g.attributes.normal.array, vo * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    } else {
      for (let i = 0; i < gp.count; i++) idx[io++] = i + vo;
    }
    vo += gp.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nrm) out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  for (const g of geoms) g.dispose();
  return out;
}

/* ------------------------------------------------------------------ */
/* transform helpers                                                   */
/* ------------------------------------------------------------------ */

const _o = new THREE.Object3D();

/** Place a geometry with a position/quaternion/scale and bake the transform. */
function place(geo, pos, quat, scale) {
  _o.position.copy(pos);
  _o.quaternion.copy(quat);
  _o.scale.copy(scale || _one);
  _o.updateMatrix();
  geo.applyMatrix4(_o.matrix);
  return geo;
}
const _one = new THREE.Vector3(1, 1, 1);

/**
 * A tapered limb whose base sits at the origin and grows up +Y.
 *
 * Open-ended: the caps are never visible once limbs are joined end to end,
 * and leaving them off halves the triangle count of every branch in the
 * forest — which, at ten thousand instanced trees, is the difference between
 * a hundred thousand triangles on screen and two hundred thousand.
 */
function limbGeo(rBase, rTip, len, seg = 6) {
  const g = new THREE.CylinderGeometry(rTip, rBase, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  return g;
}

/** Two crossed cards hanging from the origin — a clump of foliage. */
function leafClump(w, h, tilt, rng) {
  const parts = [];
  for (let i = 0; i < 2; i++) {
    const p = new THREE.PlaneGeometry(w, h, 1, 1);
    p.translate(0, -h * 0.18, 0);
    p.rotateY(i * Math.PI * 0.5 + rng() * 0.6);
    p.rotateX((rng() - 0.5) * tilt);
    parts.push(p);
  }
  return mergeGeometries(parts);
}

/* ------------------------------------------------------------------ */
/* the tree grower                                                     */
/* ------------------------------------------------------------------ */

/**
 * Grow one tree. Returns `{ trunk, canopy }` — two geometries, because bark
 * and foliage need different materials (opaque vs alpha-tested) and different
 * shadow settings.
 *
 * The tree is grown at unit height (1.0) so the scatterer can scale it.
 */
export function branchTree(opt) {
  const rng = makeRNG(opt.seed >>> 0);
  const wood = [];
  const leaves = [];

  const H = 1.0;
  const trunkR = opt.trunkR ?? 0.030;
  const conical = !!opt.conical;                 // conifer: branches all the way down
  const leafW = opt.leafW ?? 0.22;
  const leafH = opt.leafH ?? 0.20;
  const leafTilt = opt.leafTilt ?? 1.2;

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  /** Root flare: a short, much wider skirt so the tree meets the ground. */
  if (opt.flare !== false) {
    const flare = limbGeo(trunkR * 2.0, trunkR * 1.05, H * 0.055, 6);
    wood.push(flare);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng() * 0.7;
      const root = limbGeo(trunkR * 0.55, trunkR * 0.12, H * 0.085, 4);
      quat.setFromEuler(new THREE.Euler(1.15, -a, 0, 'YXZ'));
      place(root, pos.set(Math.cos(a) * trunkR * 1.3, H * 0.012, Math.sin(a) * trunkR * 1.3), quat);
      wood.push(root);
    }
  }

  /**
   * Recursive limb. `dir` is a quaternion from +Y; each call emits one segment
   * and then either splits or terminates in foliage.
   */
  function grow(base, dir, len, r, depth, energy) {
    // Radial detail falls off hard with depth. These geometries are drawn
    // ten thousand times, so a triangle here is ten thousand triangles.
    const seg = limbGeo(r, r * 0.66, len, depth === 0 ? 6 : depth === 1 ? 4 : 3);
    place(seg, base, dir);
    wood.push(seg);

    // where this segment ends
    const tip = new THREE.Vector3(0, len, 0).applyQuaternion(dir).add(base);

    if (depth >= (opt.levels ?? 3) || energy < 0.12) {
      // terminate in a clump of leaves
      const n = opt.clumps ?? 3;
      for (let i = 0; i < n; i++) {
        const c = leafClump(leafW * (0.7 + rng() * 0.6), leafH * (0.7 + rng() * 0.6), leafTilt, rng);
        const off = new THREE.Vector3(
          (rng() - 0.5) * leafW * 0.9,
          (rng() - 0.4) * leafH * 0.7,
          (rng() - 0.5) * leafW * 0.9
        );
        c.translate(tip.x + off.x, tip.y + off.y, tip.z + off.z);
        leaves.push(c);
      }
      return;
    }

    // continue the leader, slightly bent
    const bend = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(),
      (opt.curve ?? 0.16) * (0.4 + rng())
    );
    const leaderDir = dir.clone().multiply(bend);
    grow(tip, leaderDir, len * (opt.taperLen ?? 0.76), r * (opt.taperR ?? 0.66), depth + 1, energy * 0.78);

    // and throw side limbs
    const splits = depth === 0 ? (opt.primaries ?? 4) : (opt.splits ?? 1);
    for (let i = 0; i < splits; i++) {
      const t = depth === 0 ? (conical ? 0.18 + (i / splits) * 0.74 : 0.42 + (i / splits) * 0.55) : 0.5 + rng() * 0.4;
      const from = new THREE.Vector3(0, len * t, 0).applyQuaternion(dir).add(base);
      const az = rng() * Math.PI * 2 + i * (Math.PI * 2 / splits);
      // conifers hold their branches down and out; broadleaves reach up
      const pitchBase = conical ? 1.15 + (1 - t) * 0.35 : 0.62 + rng() * 0.45;
      const e = new THREE.Euler(pitchBase, az, 0, 'YXZ');
      const sideDir = dir.clone().multiply(new THREE.Quaternion().setFromEuler(e));
      const sideLen = len * (conical ? (0.75 - t * 0.5) : (0.62 + rng() * 0.28)) * (opt.branchLen ?? 1);
      grow(from, sideDir, Math.max(0.02, sideLen), r * (opt.branchR ?? 0.5), depth + 1, energy * 0.62);
    }
  }

  quat.setFromAxisAngle(up, 0);
  const lean = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((rng() - 0.5) * (opt.lean ?? 0.10), rng() * 6.28, (rng() - 0.5) * (opt.lean ?? 0.10))
  );
  grow(pos.set(0, 0, 0), lean, H * (opt.trunkLen ?? 0.44), trunkR, 0, 1);

  const trunk = mergeGeometries(wood);
  trunk.computeVertexNormals();
  const canopy = leaves.length ? mergeGeometries(leaves) : null;
  if (canopy) canopy.computeVertexNormals();
  return { trunk, canopy };
}

/* ------------------------------------------------------------------ */
/* dead / burnt / frozen variants                                      */
/* ------------------------------------------------------------------ */

/** A tree with the leaves left off — used for snags, burnt spars and shards. */
export function bareTree(opt) {
  const { trunk } = branchTree({ ...opt, clumps: 0, levels: opt.levels ?? 4 });
  return trunk;
}

/* ------------------------------------------------------------------ */
/* non-tree species                                                    */
/* ------------------------------------------------------------------ */

/** A cluster of crystal shards, used for the Void's "trees" and undergrowth. */
export function shardCluster(opt) {
  const rng = makeRNG(opt.seed >>> 0);
  const parts = [];
  const n = opt.count ?? 7;
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const h = (opt.height ?? 1) * (0.35 + rng() * 0.8) * (1 - t * 0.35);
    const r = (opt.radius ?? 0.06) * (0.5 + rng() * 0.9);
    const g = new THREE.CylinderGeometry(0, r, h, 5, 1);
    g.translate(0, h / 2, 0);
    const a = rng() * Math.PI * 2;
    const spread = (opt.spread ?? 0.22) * Math.sqrt(rng());
    quat.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, a, (rng() - 0.5) * 0.5));
    place(g, pos.set(Math.cos(a) * spread, 0, Math.sin(a) * spread), quat);
    parts.push(g);
  }
  const out = mergeGeometries(parts);
  out.computeVertexNormals();
  return out;
}

/** Kelp / stalk: a swaying ribbon that grows from the sea floor. */
export function kelpStalk(opt) {
  const rng = makeRNG(opt.seed >>> 0);
  const parts = [];
  const blades = opt.blades ?? 4;
  for (let bI = 0; bI < blades; bI++) {
    const h = (opt.height ?? 1) * (0.6 + rng() * 0.6);
    const segs = 7;
    const a0 = rng() * Math.PI * 2;
    const lean = 0.10 + rng() * 0.22;
    let x = Math.cos(a0) * 0.05, z = Math.sin(a0) * 0.05, y = 0;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const sh = h / segs;
      const w = (opt.width ?? 0.10) * (1 - t * 0.55) * (0.7 + rng() * 0.5);
      const p = new THREE.PlaneGeometry(w, sh * 1.15, 1, 1);
      p.translate(0, sh * 0.5, 0);
      p.rotateY(a0 + t * 1.4);
      p.rotateX(Math.sin(t * 3 + bI) * 0.25);
      p.translate(x, y, z);
      parts.push(p);
      const dx = Math.cos(a0 + t * 2.2) * lean * sh;
      const dz = Math.sin(a0 + t * 2.2) * lean * sh;
      x += dx; z += dz; y += sh * 0.94;
    }
  }
  const out = mergeGeometries(parts);
  out.computeVertexNormals();
  return out;
}

/** Branching coral / fungal mass. */
export function coralMass(opt) {
  const rng = makeRNG(opt.seed >>> 0);
  const parts = [];
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  function arm(base, dir, len, r, depth) {
    const g = limbGeo(r, r * 0.55, len, 5);
    place(g, base, dir);
    parts.push(g);
    if (depth >= (opt.levels ?? 3)) {
      if (opt.tip) {
        const t = new THREE.SphereGeometry(r * (opt.tipScale ?? 2.2), 6, 4);
        const tip = new THREE.Vector3(0, len, 0).applyQuaternion(dir).add(base);
        t.translate(tip.x, tip.y, tip.z);
        parts.push(t);
      }
      return;
    }
    const tip = new THREE.Vector3(0, len, 0).applyQuaternion(dir).add(base);
    const n = 2 + (rng() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const e = new THREE.Euler(0.45 + rng() * 0.55, rng() * 6.28, 0, 'YXZ');
      const d2 = dir.clone().multiply(quat.setFromEuler(e).clone());
      arm(tip, d2, len * (0.68 + rng() * 0.16), r * 0.62, depth + 1);
    }
  }
  arm(pos.set(0, 0, 0), new THREE.Quaternion(), (opt.height ?? 1) * 0.34, (opt.radius ?? 0.05), 0);
  const out = mergeGeometries(parts);
  out.computeVertexNormals();
  return out;
}

/** A mushroom: stalk plus a cap, with gills underneath. */
export function mushroom(opt) {
  const rng = makeRNG(opt.seed >>> 0);
  const parts = [];
  const h = opt.height ?? 1;
  const r = opt.radius ?? 0.3;
  const stalkR = r * (0.16 + rng() * 0.08);
  const stalk = limbGeo(stalkR * 1.4, stalkR * 0.85, h * 0.72, 7);
  parts.push(stalk);
  const capGeo = new THREE.SphereGeometry(r, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
  capGeo.scale(1, 0.58 + rng() * 0.3, 1);
  capGeo.translate(0, h * 0.70, 0);
  parts.push(capGeo);
  const gills = new THREE.ConeGeometry(r * 0.94, h * 0.09, 12, 1, true);
  gills.rotateX(Math.PI);
  gills.translate(0, h * 0.685, 0);
  parts.push(gills);
  const out = mergeGeometries(parts);
  out.computeVertexNormals();
  return out;
}

/** Cross-planes used for bushes, ferns and grass tufts. */
export function crossCards(count, w, h, tiltJitter = 0.3, seed = 1) {
  const rng = makeRNG(seed >>> 0);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const p = new THREE.PlaneGeometry(w, h, 1, 1);
    p.translate(0, h * 0.5, 0);
    p.rotateY((i / count) * Math.PI + rng() * 0.4);
    p.rotateX((rng() - 0.5) * tiltJitter);
    p.translate((rng() - 0.5) * w * 0.25, 0, (rng() - 0.5) * w * 0.25);
    parts.push(p);
  }
  return mergeGeometries(parts);
}

/** A ring of upward blades — anemones, ice fans, gill fans. */
export function fanCluster(opt) {
  const rng = makeRNG(opt.seed >>> 0);
  const parts = [];
  const n = opt.count ?? 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3;
    const h = (opt.height ?? 0.6) * (0.6 + rng() * 0.7);
    const w = (opt.width ?? 0.10) * (0.7 + rng() * 0.6);
    const p = new THREE.PlaneGeometry(w, h, 1, 2);
    // curl the blade outward
    const pa = p.attributes.position;
    for (let v = 0; v < pa.count; v++) {
      const t = (pa.getY(v) + h / 2) / h;
      pa.setZ(v, pa.getZ(v) + t * t * (opt.curl ?? 0.16));
    }
    p.translate(0, h * 0.5, 0);
    p.rotateX(-(opt.lean ?? 0.5) * (0.6 + rng() * 0.8));
    p.rotateY(a);
    p.translate(Math.cos(a) * (opt.spread ?? 0.05), 0, Math.sin(a) * (opt.spread ?? 0.05));
    parts.push(p);
  }
  const out = mergeGeometries(parts);
  out.computeVertexNormals();
  return out;
}

export function boulderGeometry(seed = 7, squash = 0.78) {
  const rng = makeRNG(seed >>> 0);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.62 + rng() * 0.6;
    p.setXYZ(i, p.getX(i) * s * 1.25, p.getY(i) * s * squash, p.getZ(i) * s * 1.1);
  }
  g.computeVertexNormals();
  return g;
}

/** An angular slab — obsidian monoliths, ice blocks, floating stone. */
export function shardRock(seed = 11) {
  const rng = makeRNG(seed >>> 0);
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) * (0.55 + rng() * 0.5),
      p.getY(i) * (0.9 + rng() * 1.3),
      p.getZ(i) * (0.55 + rng() * 0.5));
  }
  g.computeVertexNormals();
  return g;
}

export function logGeometry() {
  const g = new THREE.CylinderGeometry(0.42, 0.5, 6.5, 8, 1);
  g.rotateZ(Math.PI / 2);
  return g;
}

/* ------------------------------------------------------------------ */
/* species table                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the geometry for one named species. Species names come from the biome
 * descriptors; the shapes are shared wherever two biomes want the same idea
 * with a different colour.
 */
export function buildSpecies(name, seed) {
  switch (name) {
    /* ---- canopies (returned as { trunk, canopy }) ---- */
    case 'conifer':
      return branchTree({ seed, conical: true, levels: 2, primaries: 6, splits: 1, trunkLen: 0.42, trunkR: 0.026, taperLen: 0.80, taperR: 0.72, branchLen: 1.15, branchR: 0.34, leafW: 0.26, leafH: 0.40, clumps: 2, curve: 0.06, lean: 0.05 });
    case 'broadleaf':
      return branchTree({ seed, levels: 2, primaries: 5, splits: 1, trunkLen: 0.38, trunkR: 0.034, taperLen: 0.74, taperR: 0.62, branchLen: 0.95, branchR: 0.55, leafW: 0.52, leafH: 0.44, clumps: 2, curve: 0.22, lean: 0.12 });
    case 'burnt':
      return { trunk: bareTree({ seed, levels: 2, primaries: 5, splits: 2, trunkLen: 0.40, trunkR: 0.028, branchR: 0.42, curve: 0.28, lean: 0.20 }), canopy: null };
    case 'frozenconifer':
      return branchTree({ seed, conical: true, levels: 2, primaries: 6, splits: 1, trunkLen: 0.44, trunkR: 0.028, branchLen: 1.0, branchR: 0.32, leafW: 0.30, leafH: 0.36, clumps: 2, curve: 0.05, lean: 0.04 });
    case 'icecrown':
      return { trunk: bareTree({ seed, levels: 2, primaries: 5, splits: 2, trunkLen: 0.34, trunkR: 0.030, branchR: 0.5, curve: 0.30, lean: 0.16 }), canopy: shardCluster({ seed: seed + 3, count: 7, height: 0.55, radius: 0.05, spread: 0.34 }) };
    case 'shard':
      return { trunk: shardCluster({ seed, count: 5, height: 0.9, radius: 0.075, spread: 0.10 }), canopy: shardCluster({ seed: seed + 17, count: 9, height: 0.42, radius: 0.05, spread: 0.30 }) };
    case 'kelp':
      return { trunk: null, canopy: kelpStalk({ seed, blades: 4, height: 1.0, width: 0.13 }) };
    case 'coral':
      return { trunk: coralMass({ seed, levels: 2, radius: 0.055, height: 1.1, tip: true, tipScale: 2.2 }), canopy: null };
    case 'sporecap':
      return { trunk: mushroom({ seed, height: 1.0, radius: 0.34 }), canopy: null };

    /* ---- trunks used on their own ---- */
    case 'obsidian': return shardCluster({ seed, count: 4, height: 1.0, radius: 0.09, spread: 0.06 });
    case 'kelpstalk': return kelpStalk({ seed, blades: 3, height: 1.0, width: 0.09 });
    case 'myceliumstalk': return mushroom({ seed, height: 1.0, radius: 0.24 });

    /* ---- undergrowth ---- */
    case 'bush': return crossCards(3, 2.4, 1.7, 0.5, seed);
    case 'emberbush': return crossCards(3, 2.0, 1.3, 0.6, seed);
    case 'icebush': return shardCluster({ seed, count: 6, height: 1.1, radius: 0.10, spread: 0.35 });
    case 'crystal': return shardCluster({ seed, count: 5, height: 1.2, radius: 0.09, spread: 0.28 });
    case 'coralfan': return coralMass({ seed, levels: 2, radius: 0.06, height: 1.4, tip: true, tipScale: 2.6 });
    case 'puffball': return mushroom({ seed, height: 1.3, radius: 0.5 });

    /* ---- ground cover ---- */
    case 'fern': return crossCards(3, 1.7, 1.0, 0.7, seed);
    case 'ashfern': return crossCards(3, 1.4, 0.8, 0.8, seed);
    case 'frostfern': return fanCluster({ seed, count: 7, height: 0.9, width: 0.16, lean: 0.7, curl: 0.10 });
    case 'gillfern': return fanCluster({ seed, count: 9, height: 1.0, width: 0.20, lean: 0.6, curl: 0.24 });
    case 'anemone': return fanCluster({ seed, count: 12, height: 0.8, width: 0.12, lean: 0.85, curl: 0.30 });

    /* ---- carpet ---- */
    case 'grass': return crossCards(2, 1.1, 0.62, 0.25, seed);
    case 'ashgrass': return crossCards(2, 0.9, 0.42, 0.35, seed);
    case 'snowgrass': return crossCards(2, 0.8, 0.34, 0.30, seed);
    case 'seagrass': return crossCards(2, 1.0, 0.9, 0.45, seed);
    case 'mossgrass': return crossCards(2, 1.2, 0.5, 0.30, seed);

    /* ---- stone and debris ---- */
    case 'boulder': return boulderGeometry(seed, 0.78);
    case 'icerock': return shardRock(seed);
    case 'floatstone': return shardRock(seed + 5);
    case 'monolith': return shardRock(seed + 9);
    case 'log': return logGeometry();
    case 'driftwood': return logGeometry();

    default: return crossCards(2, 1.0, 0.8, 0.3, seed);
  }
}

/** Species that come back as `{ trunk, canopy }` rather than one geometry. */
export function isTreeSpecies(name) {
  return ['conifer', 'broadleaf', 'burnt', 'frozenconifer', 'icecrown', 'shard', 'kelp', 'coral', 'sporecap'].includes(name);
}
