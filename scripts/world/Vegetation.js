/**
 * Vegetation — procedural instanced ground cover, driven by the biome.
 *
 * Everything is scattered from the run seed, bucketed into 128 m chunks and
 * uploaded as InstancedMeshes. Chunks are shown/hidden by distance, which is
 * the single biggest performance lever in the game.
 *
 * The species themselves come from Flora.js and are chosen by the biome
 * descriptor, so "a forest of black pine" and "a shelf of kelp and coral" are
 * the same scatterer with different geometry — which means the collision hash,
 * the wind shader, the chunk streaming and the AI cover queries all keep
 * working in a place they were never specifically written for.
 *
 * Trunks double as collision cylinders; they are registered in a flat spatial
 * hash that the player, mutants and bullets all query.
 */
import * as THREE from 'three';
import { makeRNG } from '../core/RNG.js';
import { PLAYABLE_RADIUS, WORLD_HALF, WORLD_SIZE } from './Terrain.js';
import { barkTexture, leafCardTexture, grassCardTexture, rockTexture, normalFor, roughnessFor } from './Textures.js';
import { buildSpecies, isTreeSpecies, mergeGeometries } from './Flora.js';
import { getBiome } from './Biomes.js';

export { mergeGeometries };

export const CHUNK = 128;
const CHUNKS_PER_SIDE = Math.ceil(WORLD_SIZE / CHUNK);

/* ---------------- shared wind uniforms ---------------- */
export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.35 },
};

/**
 * Wind, applied in the vertex shader so it costs nothing on the CPU.
 * `bend` scales with how flexible the species is; underwater biomes turn the
 * same code into a slow current by raising it and slowing uTime's effect.
 */
function applyWind(material, bend, key) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec3 iwp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
       #else
         vec3 iwp = vec3(0.0);
       #endif
       float phs = iwp.x * 0.21 + iwp.z * 0.17;
       float swayA = sin(uTime * 1.15 + phs) * 0.6 + sin(uTime * 0.43 + phs * 1.9) * 0.4;
       float swayB = cos(uTime * 0.94 + phs * 0.7) * 0.6 + cos(uTime * 1.71 + phs) * 0.4;
       float hh = max(transformed.y, 0.0);
       transformed.x += swayA * uWind * hh * ${bend.toFixed(4)};
       transformed.z += swayB * uWind * hh * ${(bend * 0.72).toFixed(4)};`
    );
  };
  material.customProgramCacheKey = () => 'wind_' + key;
  return material;
}

/* ---------------- main class ---------------- */

export class Vegetation {
  constructor(terrain, seed, settings, biomeId = 'hollow') {
    this.terrain = terrain;
    this.seed = seed;
    this.settings = settings;
    this.biome = getBiome(biomeId);
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.chunks = new Map();          // key -> group
    this.colliders = new Map();       // cellKey -> [{x,z,r,type}]
    this.harvestables = [];           // filled by LootSystem via addHarvestSpot
    this.exclusions = [];             // {x,z,r} landmark clearings
    this._treeCount = 0;
  }

  addExclusion(x, z, r) { this.exclusions.push({ x, z, r }); }

  _excluded(x, z) {
    for (let i = 0; i < this.exclusions.length; i++) {
      const e = this.exclusions[i];
      if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r) return true;
    }
    return false;
  }

  /* ---- collider hash ---- */
  _cellKey(x, z) { return ((Math.floor(x / 8) & 0xffff) << 16) | (Math.floor(z / 8) & 0xffff); }

  addCollider(x, z, r, type) {
    const k = this._cellKey(x, z);
    let a = this.colliders.get(k);
    if (!a) { a = []; this.colliders.set(k, a); }
    a.push({ x, z, r, type });
  }

  /** All colliders whose cell is within `pad` metres of (x,z). */
  queryColliders(x, z, pad = 2, out = []) {
    out.length = 0;
    const c = Math.ceil((pad + 1.6) / 8);
    const bx = Math.floor(x / 8), bz = Math.floor(z / 8);
    for (let i = -c; i <= c; i++) {
      for (let j = -c; j <= c; j++) {
        const arr = this.colliders.get((((bx + i) & 0xffff) << 16) | ((bz + j) & 0xffff));
        if (arr) for (let k = 0; k < arr.length; k++) out.push(arr[k]);
      }
    }
    return out;
  }

  /* ---- materials ---- */

  _buildMaterials(tq) {
    const F = this.biome.flora;
    const C = F.colors;
    const E = F.emissive || {};
    const submerged = this.biome.terrain.water === 'flood';

    const emissiveFor = (key, base) => {
      const e = E[key];
      if (!e) return {};
      return { emissive: new THREE.Color(base), emissiveIntensity: e };
    };

    const barkMat = new THREE.MeshStandardMaterial({
      map: barkTexture(tq), roughness: 0.94, metalness: 0.02, color: C.trunk,
      // Relief derived from the bark's own luminance. A trunk lit by a moving
      // torch is the most-looked-at surface in the game; flat shading on it is
      // what makes a forest read as cardboard.
      normalMap: normalFor('bark' + tq, 2.6),
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: roughnessFor('bark' + tq, 0.72, 1.0),
      ...emissiveFor('trunk', C.trunk),
    });
    for (const m of [barkMat.map, barkMat.normalMap, barkMat.roughnessMap]) {
      if (m) { m.repeat.set(1.6, 3.2); m.needsUpdate = true; }
    }

    // Canopy A and B get their own materials so a biome can pair, say, a dark
    // conifer with a glowing crown without a second scatter pass.
    const canopyAMat = applyWind(new THREE.MeshStandardMaterial({
      map: leafCardTexture(F.leafHue ?? 102, tq), alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 1.0, metalness: 0, color: C.canopyA, ...emissiveFor('canopyA', C.canopyA),
    }), submerged ? 0.030 : 0.012, 'canopyA_' + this.biome.id);

    const canopyBMat = applyWind(new THREE.MeshStandardMaterial({
      map: leafCardTexture((F.leafHue ?? 102) + 18, tq), alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 1.0, metalness: 0, color: C.canopyB, ...emissiveFor('canopyB', C.canopyB),
    }), submerged ? 0.034 : 0.010, 'canopyB_' + this.biome.id);

    const bushMat = applyWind(new THREE.MeshStandardMaterial({
      map: leafCardTexture((F.leafHue ?? 102) - 14, tq), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 1.0, color: C.under, depthWrite: true, ...emissiveFor('under', C.under),
    }), submerged ? 0.06 : 0.035, 'under_' + this.biome.id);

    const fernMat = applyWind(new THREE.MeshStandardMaterial({
      map: leafCardTexture((F.leafHue ?? 102) - 6, tq), alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 1.0, color: C.ground, ...emissiveFor('ground', C.ground),
    }), submerged ? 0.08 : 0.05, 'ground_' + this.biome.id);

    const grassMat = applyWind(new THREE.MeshStandardMaterial({
      map: grassCardTexture(tq), alphaTest: 0.35, side: THREE.DoubleSide,
      roughness: 1.0, color: C.carpet, ...emissiveFor('carpet', C.carpet),
    }), submerged ? 0.13 : 0.09, 'carpet_' + this.biome.id);

    const rockMat = new THREE.MeshStandardMaterial({
      map: rockTexture(tq), roughness: 0.92, metalness: 0.02, color: C.stone,
      ...emissiveFor('stone', C.stone),
    });

    // Solid (non-card) species — crystal, coral, mushroom caps — need an opaque
    // material or their flat faces read as cut-outs.
    const solidA = new THREE.MeshStandardMaterial({
      color: C.canopyA, roughness: 0.55, metalness: 0.06, flatShading: true,
      ...emissiveFor('canopyA', C.canopyA),
    });
    const solidUnder = new THREE.MeshStandardMaterial({
      color: C.under, roughness: 0.7, metalness: 0.04, flatShading: true,
      ...emissiveFor('under', C.under),
    });
    const solidGround = new THREE.MeshStandardMaterial({
      color: C.ground, roughness: 0.75, metalness: 0.02, flatShading: true,
      ...emissiveFor('ground', C.ground),
    });

    this.materials = { barkMat, canopyAMat, canopyBMat, bushMat, fernMat, grassMat, rockMat, solidA, solidUnder, solidGround };
    return this.materials;
  }

  /** Card species use the alpha-tested leaf material; solids use flat shading. */
  _matFor(species, slot) {
    const M = this.materials;
    const CARD = ['bush', 'emberbush', 'fern', 'ashfern', 'gillfern', 'frostfern', 'anemone',
      'grass', 'ashgrass', 'snowgrass', 'seagrass', 'mossgrass', 'kelp', 'kelpstalk'];
    const isCard = CARD.includes(species);
    if (slot === 'under') return isCard ? M.bushMat : M.solidUnder;
    if (slot === 'ground') return isCard ? M.fernMat : M.solidGround;
    if (slot === 'carpet') return M.grassMat;
    if (slot === 'canopyA') return isCard || species === 'conifer' || species === 'broadleaf' || species === 'frozenconifer' ? M.canopyAMat : M.solidA;
    if (slot === 'canopyB') return isCard || species === 'broadleaf' || species === 'conifer' ? M.canopyBMat : M.solidA;
    return M.barkMat;
  }

  /* ---- build ---- */

  build(onProgress) {
    const S = this.settings;
    const tq = S.get('textureQuality');
    const density = S.get('foliage');
    const B = this.biome;
    const F = B.flora;
    const rng = makeRNG(this.seed ^ 0x5eed1);
    const submerged = B.terrain.water === 'flood';

    this._buildMaterials(tq);

    // Species geometry. Trees come back as trunk + canopy; everything else is
    // a single mesh.
    const treeA = speciesPair(F.canopyA, this.seed + 11);
    const treeB = speciesPair(F.canopyB, this.seed + 29);
    const geo = {
      trunkA: treeA.trunk, canopyA: treeA.canopy,
      trunkB: treeB.trunk, canopyB: treeB.canopy,
      under: buildSpecies(F.under, this.seed + 41),
      ground: buildSpecies(F.ground, this.seed + 53),
      carpet: buildSpecies(F.carpet, this.seed + 67),
      stone: buildSpecies(F.stone, this.seed + 79),
      debris: buildSpecies(F.debris, this.seed + 83),
    };
    this.geo = geo;

    const mul = F.counts || {};
    const counts = {
      tree: Math.floor(7600 * density * (mul.tree ?? 1)),
      bush: Math.floor(4600 * density * (mul.bush ?? 1)),
      fern: Math.floor(6200 * density * (mul.fern ?? 1)),
      grass: Math.floor(21000 * density * (mul.grass ?? 1)),
      rock: Math.floor(1500 * density * (mul.rock ?? 1)),
      log: Math.floor(420 * density * (mul.log ?? 1)),
    };

    const buckets = new Map();
    const ensure = (cx, cz) => {
      const k = cx * 100 + cz;
      let b = buckets.get(k);
      if (!b) {
        b = { cx, cz, trunkA: [], canopyA: [], trunkB: [], canopyB: [], under: [], ground: [], carpet: [], stone: [], debris: [] };
        buckets.set(k, b);
      }
      return b;
    };
    const chunkOf = (x, z) => [
      Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((x + WORLD_HALF) / CHUNK))),
      Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((z + WORLD_HALF) / CHUNK))),
    ];

    const T = this.terrain;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();

    // Under a flood the "water" test would reject the entire map, so it is
    // skipped: everything down there grows submerged.
    const wet = (x, z) => (submerged ? false : T.isWater(x, z));

    /* ---- canopy species ---- */
    let placed = 0, attempts = 0;
    while (placed < counts.tree && attempts < counts.tree * 9) {
      attempts++;
      const x = rng.range(-WORLD_HALF + 6, WORLD_HALF - 6);
      const z = rng.range(-WORLD_HALF + 6, WORLD_HALF - 6);
      if (Math.hypot(x, z) > PLAYABLE_RADIUS + 46) continue;
      if (wet(x, z)) continue;
      if (T.slopeAt(x, z) > 0.50) continue;
      if (this._excluded(x, z)) continue;
      const m = T.moistureAt(x, z);
      if (rng() > 0.30 + m * 0.92) continue;

      const y = T.heightAt(x, z);
      const dead = rng.chance(0.075);
      const useA = m < 0.52 ? rng.chance(0.78) : rng.chance(0.34);
      const scale = rng.range(0.78, 1.5) * (dead ? 0.9 : 1);
      const trunkH = (useA ? rng.range(13, 21) : rng.range(9.5, 15.5)) * scale;
      const trunkR = (useA ? 0.52 : 0.62) * scale;
      const lean = rng.range(0, 0.055) + (dead ? rng.range(0, 0.16) : 0);
      const leanDir = rng() * Math.PI * 2;
      const rot = rng() * Math.PI * 2;

      const b = ensure(...chunkOf(x, z));
      e.set(Math.cos(leanDir) * lean, rot, Math.sin(leanDir) * lean);
      q.setFromEuler(e);
      v.set(x, y - 0.2, z);
      // Flora grows at unit height, so one uniform scale drives the whole tree
      // and the canopy can never drift off the trunk it belongs to.
      sc.set(trunkH * rng.range(0.92, 1.08), trunkH, trunkH * rng.range(0.92, 1.08));
      m4.compose(v, q, sc);
      const tint = rng.range(0.55, 1.0);
      b[useA ? 'trunkA' : 'trunkB'].push(m4.clone(), tint);
      if (!dead) b[useA ? 'canopyA' : 'canopyB'].push(m4.clone(), rng.range(0.6, 1.15));

      this.addCollider(x, z, trunkR * 1.15 + 0.18, 'tree');
      placed++;
      this._treeCount++;
    }
    onProgress?.(0.35);

    /* ---- everything shorter ---- */
    const scatter = (n, key, opts) => {
      let done = 0, tries = 0;
      while (done < n && tries < n * 7) {
        tries++;
        const x = rng.range(-WORLD_HALF + 4, WORLD_HALF - 4);
        const z = rng.range(-WORLD_HALF + 4, WORLD_HALF - 4);
        if (Math.hypot(x, z) > PLAYABLE_RADIUS + 30) continue;
        if (wet(x, z)) continue;
        if (T.slopeAt(x, z) > opts.maxSlope) continue;
        if (opts.avoidClearings && this._excluded(x, z)) continue;
        const m = T.moistureAt(x, z);
        if (rng() > opts.moistBias(m)) continue;
        const y = T.heightAt(x, z);
        const b = ensure(...chunkOf(x, z));
        const s = rng.range(opts.scale[0], opts.scale[1]);
        e.set(rng.range(-0.09, 0.09), rng() * Math.PI * 2, rng.range(-0.09, 0.09));
        q.setFromEuler(e);
        v.set(x, y - 0.12, z);
        sc.set(s * rng.range(0.85, 1.15), s * rng.range(0.85, 1.25), s * rng.range(0.85, 1.15));
        m4.compose(v, q, sc);
        b[key].push(m4.clone(), rng.range(0.55, 1.15));
        if (opts.collide) this.addCollider(x, z, opts.collide, key);
        if (opts.onPlace) opts.onPlace(x, y, z, rng);
        done++;
      }
    };

    scatter(counts.bush, 'under', { maxSlope: 0.52, scale: [0.8, 1.7], moistBias: (m) => 0.25 + m * 0.9 });
    onProgress?.(0.55);
    scatter(counts.fern, 'ground', { maxSlope: 0.55, scale: [0.7, 1.6], moistBias: (m) => 0.15 + m * 1.2 });
    onProgress?.(0.7);
    scatter(counts.grass, 'carpet', { maxSlope: 0.6, scale: [0.8, 1.9], moistBias: (m) => 0.35 + m * 0.8 });
    onProgress?.(0.82);
    scatter(counts.rock, 'stone', {
      maxSlope: 1.0, scale: [0.5, 3.4], avoidClearings: true,
      moistBias: (m) => 1.15 - m * 0.7, collide: 0.9,
    });
    scatter(counts.log, 'debris', {
      maxSlope: 0.35, scale: [0.7, 1.4], avoidClearings: true,
      moistBias: (m) => 0.4 + m * 0.7, collide: 0.55,
    });
    onProgress?.(0.9);

    /* ---- upload chunks ---- */
    const mkInst = (geoK, mat, list, castShadow, receiveShadow, tint) => {
      if (!list.length || !geo[geoK] || !geo[geoK].attributes.position) return null;
      const n = list.length / 2;
      const im = new THREE.InstancedMesh(geo[geoK], mat, n);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        im.setMatrixAt(i, list[i * 2]);
        const v2 = list[i * 2 + 1];
        c.copy(tint).multiplyScalar(0.6 + v2 * 0.55);
        im.setColorAt(i, c);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = castShadow;
      im.receiveShadow = receiveShadow;
      im.frustumCulled = true;
      return im;
    };

    const white = new THREE.Color(0xffffff);
    const tintTrunk = new THREE.Color(0xb0a08c);
    const tintFoliage = new THREE.Color(0xc8d0bc);
    const tintUnder = new THREE.Color(0xc8d0b8);
    const tintRock = new THREE.Color(0xc6c4bc);
    const M = this.materials;

    for (const b of buckets.values()) {
      const g = new THREE.Group();
      const cxw = -WORLD_HALF + (b.cx + 0.5) * CHUNK;
      const czw = -WORLD_HALF + (b.cz + 0.5) * CHUNK;
      const add = (m) => { if (m) g.add(m); };
      add(mkInst('trunkA', M.barkMat, b.trunkA, true, true, tintTrunk));
      add(mkInst('trunkB', M.barkMat, b.trunkB, true, true, tintTrunk));
      add(mkInst('canopyA', this._matFor(F.canopyA, 'canopyA'), b.canopyA, true, false, tintFoliage));
      add(mkInst('canopyB', this._matFor(F.canopyB, 'canopyB'), b.canopyB, true, false, tintFoliage));
      add(mkInst('under', this._matFor(F.under, 'under'), b.under, false, false, tintUnder));
      add(mkInst('ground', this._matFor(F.ground, 'ground'), b.ground, false, false, tintUnder));
      add(mkInst('stone', M.rockMat, b.stone, true, true, tintRock));
      add(mkInst('debris', M.barkMat, b.debris, true, true, tintTrunk));
      const grassMesh = mkInst('carpet', M.grassMat, b.carpet, false, false, tintUnder);
      if (grassMesh) { grassMesh.userData.grass = true; g.add(grassMesh); }
      g.userData = { cxw, czw, grassMesh };
      this.group.add(g);
      this.chunks.set(b.cx * 100 + b.cz, g);
    }
    onProgress?.(1);
    return this.group;
  }

  /** Distance-based chunk + grass visibility. Cheap and very effective. */
  updateVisibility(camPos, viewDistance) {
    const far = viewDistance + CHUNK * 0.75;
    const far2 = far * far;
    const grassFar2 = Math.min(72, viewDistance * 0.5) ** 2;
    for (const g of this.chunks.values()) {
      const dx = g.userData.cxw - camPos.x, dz = g.userData.czw - camPos.z;
      const d2 = dx * dx + dz * dz;
      g.visible = d2 < far2;
      const gm = g.userData.grassMesh;
      if (gm) gm.visible = d2 < grassFar2;
    }
  }

  dispose() {
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    for (const g of Object.values(this.geo || {})) g?.dispose?.();
    for (const m of Object.values(this.materials || {})) m.dispose();
    this.chunks.clear();
    this.colliders.clear();
  }
}

/** Normalise a species into `{ trunk, canopy }` whatever shape it comes back as. */
function speciesPair(name, seed) {
  const out = buildSpecies(name, seed);
  if (isTreeSpecies(name)) return { trunk: out.trunk, canopy: out.canopy };
  return { trunk: out, canopy: null };
}
