/**
 * Terrain — seeded procedural heightfield for the Hollow.
 *
 * The heightfield is authoritative: the render mesh, collision, foliage
 * scattering, water bodies and AI navigation all sample the same array, so
 * nothing can ever disagree about where the ground is.
 */
import * as THREE from 'three';
import { fbm, ridge } from '../core/RNG.js';
import { groundTexture, groundNormal } from './Textures.js';
import { getBiome } from './Biomes.js';

export const WORLD_SIZE = 1024;          // metres, square, centred on origin
export const WORLD_HALF = WORLD_SIZE / 2;
export const HF_RES = 513;               // heightfield samples per side (2 m spacing)
export const PLAYABLE_RADIUS = 430;      // beyond this the rim cliffs rise

const MESH_SEGS = { low: 192, medium: 288, high: 384, ultra: 448 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

export class Terrain {
  constructor(seed, biomeId = 'hollow') {
    this.seed = seed >>> 0;
    this.biome = getBiome(biomeId);
    this.shape = this.biome.terrain;
    this.spacing = WORLD_SIZE / (HF_RES - 1);
    this.heights = null;
    this.mesh = null;
    this.waterMeshes = [];
    this.flattenZones = [];

    // Creek path parameters (also used to carve and to place the water ribbon).
    this.creek = {
      ax: -140 + ((this.seed % 97) - 48) * 1.4,
      k1: 0.0071, a1: 74,
      k2: 0.0193, a2: 17,
      width: 15,
      depth: 6.5,
    };
    // Lake basin.
    const lr = ((this.seed >>> 7) % 211) / 211;
    this.lake = {
      x: 150 + lr * 120,
      z: -210 + (((this.seed >>> 13) % 173) / 173) * 90,
      r: 86,
    };
    this.lakeLevel = this.rawHeight(this.lake.x, this.lake.z) - 2.4;
  }

  creekX(z) {
    const c = this.creek;
    return c.ax + Math.sin(z * c.k1) * c.a1 + Math.sin(z * c.k2 + 1.7) * c.a2;
  }

  /**
   * Height before carving/flattening — used to plan landmark placement.
   * The biome only scales the three terms; the shape of the land is the same
   * function everywhere, which is what lets landmark planning, navigation and
   * foliage scattering carry across biomes unchanged.
   */
  rawHeight(x, z) {
    const s = this.seed;
    const S = this.shape;
    let h = fbm(x * 0.0017, z * 0.0017, s, 5, 2.1, 0.5) * 31 * S.relief;
    h += fbm(x * 0.0061, z * 0.0061, s + 9173, 4) * 7.6 * S.detail;
    h += fbm(x * 0.0223, z * 0.0223, s + 4471, 3) * 1.7 * S.detail;
    const r = ridge(x * 0.0043, z * 0.0043, s + 3119, 3);
    h += (r - 0.35) * 17 * S.ridge * smoothstep(-2, 16, h);
    return h;
  }

  /** Full height including water carving, rim cliffs and flattened build pads. */
  sampleHeight(x, z) {
    let h = this.rawHeight(x, z);
    const hasCreek = this.shape.water === 'creek';

    // creek channel
    const cx = this.creekX(z);
    const d = Math.abs(x - cx);
    const c = this.creek;
    if (hasCreek && d < c.width * 3.4) {
      const f = Math.exp(-((d / c.width) ** 2));
      h -= c.depth * f;
      // slight banks
      h += Math.exp(-(((d - c.width * 1.7) / (c.width * 0.9)) ** 2)) * 1.1;
    }

    // lake basin
    const lr = Math.hypot(x - this.lake.x, z - this.lake.z);
    if (hasCreek && lr < this.lake.r * 1.25) {
      const t = clamp(lr / this.lake.r, 0, 1.25);
      const bowl = this.lakeLevel - 6.0 + Math.pow(t, 2.1) * 10.5;
      h = Math.min(h, bowl);
    }

    // rim cliffs keep the player inside the Hollow
    const rc = Math.hypot(x, z);
    if (rc > PLAYABLE_RADIUS) {
      h += Math.pow(rc - PLAYABLE_RADIUS, 1.62) * 0.062;
    }

    // flattened pads for structures
    for (let i = 0; i < this.flattenZones.length; i++) {
      const zn = this.flattenZones[i];
      const dd = Math.hypot(x - zn.x, z - zn.z);
      if (dd < zn.r * 2.0) {
        const t = smoothstep(zn.r * 2.0, zn.r * 0.7, dd);
        h = h * (1 - t) + zn.y * t;
      }
    }
    return h;
  }

  addFlattenZone(x, z, r, y) { this.flattenZones.push({ x, z, r, y }); }

  /** Build the heightfield array. Call after all flatten zones are registered. */
  generate(onProgress) {
    const n = HF_RES;
    this.heights = new Float32Array(n * n);
    const sp = this.spacing;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * sp;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * sp;
        this.heights[j * n + i] = this.sampleHeight(x, z);
      }
      if (onProgress && (j & 63) === 0) onProgress(j / n);
    }
    this._buildMoisture();
  }

  _buildMoisture() {
    // Low-resolution moisture / rockiness maps drive foliage and surface type.
    const n = 129;
    this.moist = new Float32Array(n * n);
    this.moistRes = n;
    const sp = WORLD_SIZE / (n - 1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * sp, z = -WORLD_HALF + j * sp;
        this.moist[j * n + i] = fbm(x * 0.0039, z * 0.0039, this.seed + 777, 3) * 0.5 + 0.5;
      }
    }
  }

  moistureAt(x, z) {
    const n = this.moistRes, sp = WORLD_SIZE / (n - 1);
    let fx = (x + WORLD_HALF) / sp, fz = (z + WORLD_HALF) / sp;
    fx = clamp(fx, 0, n - 1.001); fz = clamp(fz, 0, n - 1.001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const a = this.moist[j * n + i], b = this.moist[j * n + i + 1];
    const c = this.moist[(j + 1) * n + i], d = this.moist[(j + 1) * n + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  /** Bilinear height lookup — the hot path for physics and AI. */
  heightAt(x, z) {
    if (!this.heights) return this.sampleHeight(x, z);
    const n = HF_RES, sp = this.spacing;
    let fx = (x + WORLD_HALF) / sp, fz = (z + WORLD_HALF) / sp;
    if (fx < 0) fx = 0; else if (fx > n - 1.001) fx = n - 1.001;
    if (fz < 0) fz = 0; else if (fz > n - 1.001) fz = n - 1.001;
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const h = this.heights;
    const a = h[j * n + i], b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.4;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x, z) {
    const n = this.normalAt(x, z, _tmpN);
    return 1 - clamp(n.y, 0, 1);
  }

  waterLevelAt(x, z) {
    // A flooded biome has one surface over the whole map; a dry one has none.
    if (this.shape.water === 'flood') return this.floodLevel();
    if (this.shape.water === 'none') return -Infinity;
    const lr = Math.hypot(x - this.lake.x, z - this.lake.z);
    if (lr < this.lake.r * 1.02) return this.lakeLevel;
    const d = Math.abs(x - this.creekX(z));
    if (d < this.creek.width * 1.25) return this.creekWaterAt(z);
    return -Infinity;
  }

  creekWaterAt(z) {
    const cx = this.creekX(z);
    // Base of the channel plus a shallow film of water.
    return this.rawHeight(cx, z) - this.creek.depth + 1.35;
  }

  /** Surface height of a flooded biome: the highest ground plus headroom. */
  floodLevel() {
    if (this._flood === undefined) {
      let peak = -1e9;
      if (this.heights) {
        for (let i = 0; i < this.heights.length; i += 7) peak = Math.max(peak, this.heights[i]);
      } else peak = 40;
      this._flood = peak + (this.shape.floor || 20);
    }
    return this._flood;
  }

  isWater(x, z) {
    // Under a flood everything is wet, which would make every "is this dry
    // land" test fail — so the flood is deliberately not counted here. The
    // player's swim state comes from the water level directly.
    if (this.shape.water === 'flood') return false;
    const wl = this.waterLevelAt(x, z);
    return wl > -1e8 && this.heightAt(x, z) < wl - 0.05;
  }

  /** True when the given point is beneath the water surface. */
  submerged(x, y, z) {
    const wl = this.waterLevelAt(x, z);
    return wl > -1e8 && y < wl;
  }

  /** Material under foot — drives footstep audio and impact FX. */
  surfaceAt(x, z) {
    if (this.isWater(x, z)) return 'water';
    const s = this.slopeAt(x, z);
    if (s > 0.58) return 'rock';
    const m = this.moistureAt(x, z);
    const h = this.heightAt(x, z);
    if (h > 40 && s > 0.34) return 'rock';
    if (m > 0.62) return 'leaves';
    if (m < 0.36) return 'dirt';
    return 'grass';
  }

  /* --------------------------------------------------------------- */

  buildMesh(quality, textureQuality) {
    const segs = MESH_SEGS[quality] || MESH_SEGS.high;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const P = this.shape.palette;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      const slope = this.slopeAt(x, z);
      const m = this.moistureAt(x, z);
      const wl = this.waterLevelAt(x, z);
      const nearWater = wl > -1e8 ? clamp(1 - (y - wl) / 3.0, 0, 1) : 0;

      // Base palette comes from the biome; the *structure* of the shading —
      // litter in the damp, moss on the flat, rock on the steep, mud at the
      // waterline — is the same everywhere, so every biome reads as a real
      // place rather than a recolour.
      let r = P.base[0], g = P.base[1], b = P.base[2];
      const litter = smoothstep(0.42, 0.78, m);
      r += litter * P.litter[0]; g += litter * P.litter[1]; b += litter * P.litter[2];
      const mossy = smoothstep(0.30, 0.72, m) * (1 - slope);
      r += mossy * P.moss[0]; g += mossy * P.moss[1]; b += mossy * P.moss[2];
      const rocky = smoothstep(0.42, 0.72, slope);
      r = r * (1 - rocky) + P.rock[0] * rocky;
      g = g * (1 - rocky) + P.rock[1] * rocky;
      b = b * (1 - rocky) + P.rock[2] * rocky;
      const mud = nearWater;
      r = r * (1 - mud) + P.mud[0] * mud;
      g = g * (1 - mud) + P.mud[1] * mud;
      b = b * (1 - mud) + P.mud[2] * mud;

      // Per-vertex break-up so large flats do not read as a single tone.
      const v = fbm(x * 0.06, z * 0.06, this.seed + 55, 2) * 0.045;
      col.setRGB(clamp(r + v, 0, 1), clamp(g + v, 0, 1), clamp(b + v, 0, 1));
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.attributes.uv.array.forEach; // (uv is generated by PlaneGeometry)

    const map = groundTexture(textureQuality);
    map.repeat.set(WORLD_SIZE / 6, WORLD_SIZE / 6);
    const nrm = groundNormal(textureQuality);
    nrm.repeat.set(WORLD_SIZE / 6, WORLD_SIZE / 6);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.97,
      metalness: 0.0,
      dithering: true,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
    this.mesh.userData.surface = 'ground';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    return this.mesh;
  }

  buildWater() {
    const meshes = [];
    if (this.shape.water === 'none') { this.waterMeshes = meshes; return meshes; }

    const waterMat = new THREE.MeshStandardMaterial({
      color: this.shape.water === 'flood' ? 0x0a2e38 : 0x121b1e,
      roughness: 0.09,
      metalness: 0.35,
      transparent: true,
      opacity: this.shape.water === 'flood' ? 0.55 : 0.86,
      side: THREE.DoubleSide,
      envMapIntensity: 0.6,
    });

    if (this.shape.water === 'flood') {
      // One surface over the whole shelf, seen from underneath.
      const g = new THREE.PlaneGeometry(WORLD_SIZE * 1.4, WORLD_SIZE * 1.4, 1, 1);
      g.rotateX(-Math.PI / 2);
      const surf = new THREE.Mesh(g, waterMat);
      surf.position.y = this.floodLevel();
      surf.userData.water = true;
      meshes.push(surf);
      this.waterMeshes = meshes;
      this.waterMaterial = waterMat;
      return meshes;
    }

    // Lake disc
    const lakeGeo = new THREE.CircleGeometry(this.lake.r * 1.02, 56);
    lakeGeo.rotateX(-Math.PI / 2);
    const lake = new THREE.Mesh(lakeGeo, waterMat);
    lake.position.set(this.lake.x, this.lakeLevel, this.lake.z);
    lake.userData.water = true;
    meshes.push(lake);

    // Creek ribbon following the carved channel
    const steps = 120, w = this.creek.width * 1.05;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const z = -WORLD_HALF + (i / steps) * WORLD_SIZE;
      pts.push({ z, x: this.creekX(z), y: this.creekWaterAt(z) });
    }
    const vtx = [], idx = [], uvs = [];
    for (let i = 0; i <= steps; i++) {
      const p = pts[i];
      vtx.push(p.x - w, p.y, p.z, p.x + w, p.y, p.z);
      uvs.push(0, i / steps * 24, 1, i / steps * 24);
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(vtx, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    cg.setIndex(idx);
    cg.computeVertexNormals();
    const creek = new THREE.Mesh(cg, waterMat.clone());
    creek.material.opacity = 0.78;
    creek.userData.water = true;
    meshes.push(creek);

    this.waterMeshes = meshes;
    this.waterMaterial = waterMat;
    return meshes;
  }

  /** Gentle ripple animation on the water materials. */
  updateWater(t) {
    if (this.waterMaterial) {
      this.waterMaterial.roughness = 0.07 + Math.sin(t * 0.6) * 0.02;
    }
    for (const m of this.waterMeshes) m.position.y += Math.sin(t * 0.8 + m.position.x) * 0.0006;
  }

  /** Find a walkable spot near (x,z): not water, not too steep. */
  findWalkable(x, z, rng, maxTries = 24, radius = 26) {
    for (let i = 0; i < maxTries; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (Math.hypot(px, pz) > PLAYABLE_RADIUS - 12) continue;
      if (this.isWater(px, pz)) continue;
      if (this.slopeAt(px, pz) > 0.45) continue;
      return { x: px, z: pz, y: this.heightAt(px, pz) };
    }
    return { x, z, y: this.heightAt(x, z) };
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
    for (const m of this.waterMeshes) { m.geometry.dispose(); m.material.dispose(); }
    this.waterMeshes = [];
    this.mesh = null;
  }
}

const _tmpN = new THREE.Vector3();
