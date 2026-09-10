// Builds San Aurelio. Work is chunked (2x2 city cells per chunk) so geometry can be
// merged into a handful of draw calls and streamed in and out around the player.

import * as THREE from 'three';
import { CITY, WORLD, RoadGraph, districtAt, POIS, isOnPavement } from './citymap.js';
import * as T from './textures.js';
import * as G from './geo.js';
import { makeRng, clamp, SpatialGrid } from '../core/util.js';
import { preset } from '../core/settings.js';

const CHUNK_CELLS = 2;
const CHUNK_SIZE = CITY.PITCH * CHUNK_CELLS;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.graph = new RoadGraph();
    this.colliders = new SpatialGrid(24);
    this.chunks = new Map();
    this.root = new THREE.Group();
    this.root.name = 'city';
    scene.add(this.root);
    this.mats = {};
    this.lightPool = [];
    this.streetLamps = [];      // {x,z} of every lamp head, for the light pool
    this.signalLenses = null;
    this.emissiveMats = [];
    this.interiors = new Map();
    this.doors = [];            // {x,z,r,interior,spawn,label,poi}
    this.pois = POIS;
    this.stats = { chunks: 0, buildings: 0, props: 0, colliders: 0, drawGroups: 0 };
  }

  // ------------------------------------------------------------------ materials
  buildMaterials() {
    const p = preset();
    T.setTextureAnisotropy(p.anisotropy);
    const asp = T.asphalt();
    const M = this.mats;

    const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };

    M.asphalt = new THREE.MeshStandardMaterial({
      map: rep(asp.map, 6, 6), roughnessMap: rep(asp.rough, 6, 6),
      roughness: 0.94, metalness: 0.0, color: 0xffffff,
    });
    M.markingWhite = new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.markingYellow = new THREE.MeshStandardMaterial({ color: 0xd8b23c, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.pavement = new THREE.MeshStandardMaterial({ map: rep(T.concrete(0.8), 2, 2), roughness: 0.92 });
    M.kerb = new THREE.MeshStandardMaterial({ color: 0xb9bcbb, roughness: 0.85 });
    M.roof = new THREE.MeshStandardMaterial({ map: T.roofTex(), roughness: 0.95 });
    M.concrete = new THREE.MeshStandardMaterial({ map: rep(T.concrete(0.68), 1, 1), roughness: 0.9 });
    M.metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.45, metalness: 0.75 });
    M.darkMetal = new THREE.MeshStandardMaterial({ color: 0x33383c, roughness: 0.55, metalness: 0.6 });
    M.paintedRed = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.6 });
    M.glass = new THREE.MeshStandardMaterial({
      color: 0x1c2c36, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.62,
      side: THREE.DoubleSide,
    });
    M.trunk = new THREE.MeshStandardMaterial({ color: 0x6b5844, roughness: 0.95 });
    M.foliage = new THREE.MeshStandardMaterial({ map: T.foliageTex(), roughness: 0.92, side: THREE.DoubleSide });
    M.grass = new THREE.MeshStandardMaterial({ map: rep(T.grass(), 8, 8), roughness: 0.96 });
    M.sand = new THREE.MeshStandardMaterial({ map: rep(T.sand(), 40, 40), roughness: 0.96 });
    M.dirt = new THREE.MeshStandardMaterial({ map: rep(T.dirt(), 30, 30), roughness: 0.97 });
    M.lampOn = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffbb66, emissiveIntensity: 0 });
    this.emissiveMats.push(M.lampOn);

    // Facade material variants — one material per style keeps merged chunks cheap.
    this.facades = {};
    const styles = ['tower', 'office', 'stucco', 'brick', 'warehouse', 'shop'];
    styles.forEach((style, si) => {
      this.facades[style] = [];
      const variants = style === 'stucco' || style === 'shop' ? 3 : 2;
      for (let v = 0; v < variants; v++) {
        const floors = style === 'tower' ? 6 : 4;
        const bays = style === 'tower' ? 6 : 4;
        const f = T.facade(style, 1000 + si * 31 + v * 7, floors, bays);
        const tileW = style === 'tower' ? 4.0 * bays : 4.4 * bays;
        const tileH = (style === 'warehouse' ? 5.0 : 3.6) * floors;
        const mat = new THREE.MeshStandardMaterial({
          map: f.map, roughnessMap: f.rough, emissiveMap: f.emissive,
          emissive: 0xffffff, emissiveIntensity: 0, roughness: 1.0, metalness: style === 'tower' ? 0.25 : 0.02,
        });
        this.emissiveMats.push(mat);
        this.facades[style].push({ mat, tileW, tileH, key: `fac_${style}_${v}` });
      }
    });

    M.oceanFoam = new THREE.MeshStandardMaterial({ color: 0xdfeef0, roughness: 0.8, transparent: true, opacity: 0.75 });
    M.ocean = new THREE.MeshStandardMaterial({
      color: 0x18313d, roughness: 0.12, metalness: 0.55, transparent: true, opacity: 0.94,
    });
  }

  // ------------------------------------------------------------------ build
  async build(onProgress = () => {}) {
    this.buildMaterials();
    onProgress(0.05, 'Pouring concrete');
    this.buildTerrain();
    onProgress(0.15, 'Laying out the grid');

    const chunksPerSide = Math.ceil((CITY.CELLS - 1) / CHUNK_CELLS);
    const total = chunksPerSide * chunksPerSide;
    let done = 0;
    for (let ci = 0; ci < chunksPerSide; ci++) {
      for (let cj = 0; cj < chunksPerSide; cj++) {
        this.buildChunk(ci, cj);
        done++;
        if (done % 3 === 0) {
          onProgress(0.15 + 0.6 * (done / total), `Building ${DISTRICT_LABEL(ci, cj)}`);
          await frame();
        }
      }
    }
    onProgress(0.78, 'Hanging the traffic signals');
    this.buildSignals();
    await frame();
    onProgress(0.86, 'Opening the shops');
    this.buildLandmarks();
    this.buildInteriors();
    await frame();
    onProgress(0.93, 'Wiring the street lights');
    this.buildLightPool();
    this.stats.colliders = this.colliders.size;
    onProgress(1.0, 'Ready');
  }

  buildTerrain() {
    const S = 3400;
    // Outskirts ground plane far below the city grid level.
    const outer = new THREE.Mesh(G.ground(S, S, -0.02, 60, 60), this.mats.dirt);
    outer.position.set(CITY.PITCH * (CITY.CELLS - 1) / 2, 0, CITY.PITCH * (CITY.CELLS - 1) / 2);
    outer.receiveShadow = true;
    this.root.add(outer);

    // Beach + ocean to the west.
    const beach = new THREE.Mesh(G.ground(180, 1600, 0.03, 12, 90), this.mats.sand);
    beach.position.set(WORLD.shoreX - 30, 0, CITY.PITCH * 5.5);
    beach.receiveShadow = true;
    this.root.add(beach);

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1800, 2400, 40, 40), this.mats.ocean);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(WORLD.oceanX - 880, -0.35, CITY.PITCH * 5.5);
    this.ocean = ocean;
    this.oceanBase = ocean.geometry.attributes.position.array.slice();
    this.root.add(ocean);

    // Eastern hills — displaced plane, closes the horizon and gives the Heights a backdrop.
    const hills = new THREE.PlaneGeometry(1500, 2200, 44, 60);
    const pos = hills.attributes.position;
    const rng = makeRng(5150);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const n = Math.sin(x * 0.006) * Math.cos(y * 0.0045) + Math.sin(x * 0.017 + 1.3) * 0.45 + Math.cos(y * 0.013) * 0.4;
      const edge = clamp((x + 750) / 700, 0, 1);
      pos.setZ(i, (n * 46 + 22) * edge * edge + rng.range(-1.5, 1.5));
    }
    hills.computeVertexNormals();
    const hillMesh = new THREE.Mesh(hills, this.mats.grass);
    hillMesh.rotation.x = -Math.PI / 2;
    hillMesh.position.set(WORLD.hillsX + 640, -6, CITY.PITCH * 5.5);
    hillMesh.receiveShadow = true;
    this.root.add(hillMesh);

    const hillsN = hillMesh.clone();
    hillsN.rotation.z = Math.PI / 2;
    hillsN.position.set(CITY.PITCH * 5.5, -8, -900);
    this.root.add(hillsN);
  }

  // ------------------------------------------------------------------ one chunk
  buildChunk(ci, cj) {
    const key = `${ci}_${cj}`;
    const group = new THREE.Group();
    group.name = 'chunk_' + key;
    const buckets = new Map(); // materialKey -> {mat, geos[]}
    const push = (matKey, mat, geo) => {
      if (!geo) return;
      let b = buckets.get(matKey);
      if (!b) buckets.set(matKey, (b = { mat, geos: [] }));
      b.geos.push(geo);
    };

    const i0 = ci * CHUNK_CELLS, j0 = cj * CHUNK_CELLS;
    const rng = makeRng(7717 + ci * 977 + cj * 131);

    for (let di = 0; di < CHUNK_CELLS; di++) {
      for (let dj = 0; dj < CHUNK_CELLS; dj++) {
        const i = i0 + di, j = j0 + dj;
        if (i >= CITY.CELLS || j >= CITY.CELLS) continue;
        this.buildIntersection(i, j, push);
        if (i < CITY.CELLS - 1) this.buildRoadSegment(i, j, 'x', push);
        if (j < CITY.CELLS - 1) this.buildRoadSegment(i, j, 'z', push);
        if (i < CITY.CELLS - 1 && j < CITY.CELLS - 1) this.buildBlock(i, j, push, rng);
      }
    }

    let groups = 0;
    for (const [k, b] of buckets) {
      if (!b.geos.length) continue;
      let merged;
      try {
        merged = G.mergeGeometries(b.geos, false);
      } catch (e) { console.warn('merge failed for', k, e); continue; }
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = k !== 'asphalt' && k !== 'pavement' && !k.startsWith('mark');
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      groups++;
      b.geos.forEach((g) => g.dispose && g.dispose());
    }
    this.stats.drawGroups += groups;
    const cx = (i0 + 0.5) * CITY.PITCH, cz = (j0 + 0.5) * CITY.PITCH;
    group.userData.centre = new THREE.Vector3(cx, 0, cz);
    this.root.add(group);
    this.chunks.set(key, group);
    this.stats.chunks++;
  }

  buildIntersection(i, j, push) {
    const x = i * CITY.PITCH, z = j * CITY.PITCH;
    const R = CITY.ROAD_HALF;
    push('asphalt', this.mats.asphalt, G.place(G.ground(R * 2, R * 2, 0.0, R * 2 / 8, R * 2 / 8), x, 0, z));

    // Zebra crossings on each approach.
    const stripe = (cx, cz, w, d, ry) => {
      const n = 6;
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * (w / n);
        const g = G.ground(w / n * 0.55, d, 0.012);
        G.place(g, 0, 0, 0);
        const m = new THREE.Matrix4().makeRotationY(ry);
        g.applyMatrix4(m);
        const dx = Math.cos(ry) * off, dz = -Math.sin(ry) * off;
        g.translate(cx + dx, 0, cz + dz);
        push('markW', this.mats.markingWhite, g);
      }
    };
    stripe(x, z + R - 1.6, R * 1.8, 2.6, 0);
    stripe(x, z - R + 1.6, R * 1.8, 2.6, 0);
    stripe(x + R - 1.6, z, R * 1.8, 2.6, Math.PI / 2);
    stripe(x - R + 1.6, z, R * 1.8, 2.6, Math.PI / 2);

    // Corner pavements.
    const K = CITY.KERB_HALF;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = K - R;
        push('pavement', this.mats.pavement, G.place(G.ground(w, w, 0.16, w / 4, w / 4), x + sx * (R + w / 2), 0, z + sz * (R + w / 2)));
        push('kerb', this.mats.kerb, G.place(G.box(w, 0.16, 0.35), x + sx * (R + w / 2), 0.08, z + sz * (R + 0.17)));
        push('kerb', this.mats.kerb, G.place(G.box(0.35, 0.16, w), x + sx * (R + 0.17), 0.08, z + sz * (R + w / 2)));
      }
    }
  }

  buildRoadSegment(i, j, axis, push) {
    const R = CITY.ROAD_HALF, K = CITY.KERB_HALF, P = CITY.PITCH;
    const x = i * P, z = j * P;
    const len = P - R * 2;
    const cx = axis === 'x' ? x + P / 2 : x;
    const cz = axis === 'z' ? z + P / 2 : z;
    const w = axis === 'x' ? len : R * 2;
    const d = axis === 'x' ? R * 2 : len;

    push('asphalt', this.mats.asphalt, G.place(G.ground(w, d, 0, w / 8, d / 8), cx, 0, cz));

    // Centre line: double yellow.
    const cl = (off) => {
      const g = axis === 'x' ? G.ground(len, 0.16, 0.012) : G.ground(0.16, len, 0.012);
      G.place(g, axis === 'x' ? cx : cx + off, 0, axis === 'x' ? cz + off : cz);
      push('markY', this.mats.markingYellow, g);
    };
    cl(-0.22); cl(0.22);

    // Lane divider dashes between the two lanes on each side.
    for (const side of [-1, 1]) {
      const off = side * ((CITY.LANE_OFFSETS[0] + CITY.LANE_OFFSETS[1]) / 2);
      const dashes = Math.floor(len / 6);
      for (let k = 0; k < dashes; k++) {
        const t = -len / 2 + k * 6 + 1.5;
        const g = axis === 'x' ? G.ground(3, 0.14, 0.012) : G.ground(0.14, 3, 0.012);
        G.place(g, axis === 'x' ? cx + t : cx + off, 0, axis === 'x' ? cz + off : cz + t);
        push('markW', this.mats.markingWhite, g);
      }
    }

    // Pavements + kerbs on both flanks.
    const pw = K - R;
    for (const side of [-1, 1]) {
      const px = axis === 'x' ? cx : cx + side * (R + pw / 2);
      const pz = axis === 'x' ? cz + side * (R + pw / 2) : cz;
      const pW = axis === 'x' ? len : pw;
      const pD = axis === 'x' ? pw : len;
      push('pavement', this.mats.pavement, G.place(G.ground(pW, pD, 0.16, pW / 4, pD / 4), px, 0, pz));
      const kx = axis === 'x' ? cx : cx + side * (R + 0.17);
      const kz = axis === 'x' ? cz + side * (R + 0.17) : cz;
      push('kerb', this.mats.kerb, G.place(G.box(axis === 'x' ? len : 0.35, 0.16, axis === 'x' ? 0.35 : len), kx, 0.08, kz));
    }
  }

  /** Fill one city block: buildings around the frontage, yard/parking in the middle, street furniture. */
  buildBlock(i, j, push, rngChunk) {
    const P = CITY.PITCH, K = CITY.KERB_HALF;
    const x0 = i * P + K, x1 = (i + 1) * P - K;
    const z0 = j * P + K, z1 = (j + 1) * P - K;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = x1 - x0, d = z1 - z0;
    const district = districtAt(i, j);
    const rng = makeRng(31 + i * 7919 + j * 104729);

    // Ground surface of the block interior.
    const groundMat = district === 'residential' || district === 'hills' ? this.mats.grass
      : district === 'industrial' ? this.mats.asphalt : this.mats.concrete;
    const gk = district === 'residential' || district === 'hills' ? 'grass' : district === 'industrial' ? 'asphalt' : 'concrete';
    push(gk, groundMat, G.place(G.ground(w, d, 0.155, w / 8, d / 8), cx, 0, cz));

    const plan = BLOCK_PLANS[district](rng);
    const lots = subdivide(x0, z0, x1, z1, plan.lotSize, rng);

    for (const lot of lots) {
      if (rng() > plan.fillRate) { this.buildYard(lot, district, rng, push); continue; }
      this.buildBuilding(lot, district, plan, rng, push);
    }

    // Street furniture around the block frontage.
    this.buildFrontage(i, j, district, rng, push);
  }

  buildBuilding(lot, district, plan, rng, push) {
    const inset = rng.range(0.4, 2.2);
    const w = Math.max(7, lot.w - inset * 2);
    const d = Math.max(7, lot.d - inset * 2);
    const h = rng.range(plan.minH, plan.maxH);
    const style = rng.pick(plan.styles);
    const variants = this.facades[style];
    const fv = variants[rng.int(0, variants.length - 1)];

    const shell = G.buildingShell(w, h, d, fv.tileW, fv.tileH);
    G.place(shell.walls, lot.cx, 0, lot.cz);
    push(fv.key, fv.mat, shell.walls);

    const roof = G.roofSlab(w, h, d, style === 'tower' ? 1.3 : 0.9);
    G.place(roof, lot.cx, 0, lot.cz);
    push('roof', this.mats.roof, roof);

    const clutter = G.roofClutter(w, d, h, rng);
    if (clutter) { G.place(clutter, lot.cx, 0, lot.cz); push('metal', this.mats.metal, clutter); }

    // Setback upper mass for towers.
    if (style === 'tower' && rng.chance(0.6)) {
      const w2 = w * rng.range(0.5, 0.75), d2 = d * rng.range(0.5, 0.75), h2 = h * rng.range(0.25, 0.6);
      const s2 = G.buildingShell(w2, h2, d2, fv.tileW, fv.tileH);
      s2.walls.translate(0, h, 0);
      G.place(s2.walls, lot.cx, 0, lot.cz);
      push(fv.key, fv.mat, s2.walls);
      const r2 = G.roofSlab(w2, h2, d2, 1.0);
      r2.translate(0, h, 0);
      G.place(r2, lot.cx, 0, lot.cz);
      push('roof', this.mats.roof, r2);
    }

    // Ground-floor retail on the street-facing side.
    if (plan.retail && (lot.facing.x || lot.facing.z) && rng.chance(0.7)) {
      const face = lot.facing;   // unit vector pointing to the street
      const fw = (Math.abs(face.x) > 0.5 ? d : w) * 0.82;
      const ry = Math.atan2(face.x, face.z);
      const px = lot.cx + face.x * ((Math.abs(face.x) > 0.5 ? w : d) / 2 + 0.05);
      const pz = lot.cz + face.z * ((Math.abs(face.z) > 0.5 ? d : w) / 2 + 0.05);
      const sf = G.shopfront(fw);
      G.place(sf, px, 0.16, pz, ry);
      push('concrete', this.mats.concrete, sf);
      const gl = G.glazing(fw * 0.9, 2.6);
      G.place(gl, px + face.x * 0.16, 2.1, pz + face.z * 0.16, ry);
      push('glass', this.mats.glass, gl);
      const aw = G.awning(fw * 0.95, 1.4);
      G.place(aw, px, 0.16, pz, ry);
      push('paintedRed', this.mats.paintedRed, aw);
    }

    // Collider: full building footprint.
    this.colliders.add({
      minX: lot.cx - w / 2, maxX: lot.cx + w / 2,
      minZ: lot.cz - d / 2, maxZ: lot.cz + d / 2,
      height: h, tag: 'building',
    });
    this.stats.buildings++;
  }

  buildYard(lot, district, rng, push) {
    // An empty lot: parking bays, a fence, some greenery — never bare ground.
    if (district === 'industrial' || rng.chance(0.4)) {
      const n = Math.max(2, Math.floor(lot.w / 3));
      for (let k = 0; k < n; k++) {
        const g = G.ground(0.14, 5.2, 0.166);
        G.place(g, lot.x0 + 1.5 + k * 3, 0, lot.cz);
        push('markW', this.mats.markingWhite, g);
      }
      const f = G.fenceRun(lot.w * 0.9, 0);
      G.place(f, lot.cx, 0.16, lot.z0 + 0.6);
      push('darkMetal', this.mats.darkMetal, f);
      if (rng.chance(0.6)) {
        const dm = G.dumpster(rng() * 3);
        G.place(dm, lot.cx + rng.range(-lot.w / 3, lot.w / 3), 0.16, lot.cz + lot.d / 2 - 2);
        push('paintedRed', this.mats.paintedRed, dm);
      }
    } else {
      const trees = rng.int(1, 3);
      for (let k = 0; k < trees; k++) {
        const tx = lot.cx + rng.range(-lot.w / 3, lot.w / 3);
        const tz = lot.cz + rng.range(-lot.d / 3, lot.d / 3);
        this.addTree(tx, tz, district, rng, push);
      }
      for (let k = 0; k < rng.int(2, 5); k++) {
        const b = G.bush(rng);
        G.place(b, lot.cx + rng.range(-lot.w / 2.4, lot.w / 2.4), 0.16, lot.cz + rng.range(-lot.d / 2.4, lot.d / 2.4));
        push('foliage', this.mats.foliage, b);
      }
    }
  }

  addTree(x, z, district, rng, push) {
    if (district === 'coast' || district === 'downtown' || rng.chance(0.35)) {
      const p = G.palmTree(rng);
      G.place(p.trunk, x, 0.16, z);
      push('trunk', this.mats.trunk, p.trunk);
      const fr = G.palmFronds(p.height, p.lean, rng);
      G.place(fr, x, 0.16, z);
      push('foliage', this.mats.foliage, fr);
    } else {
      const t = G.broadleafTree(rng);
      G.place(t.trunk, x, 0.16, z);
      push('trunk', this.mats.trunk, t.trunk);
      G.place(t.canopy, x, 0.16, z);
      push('foliage', this.mats.foliage, t.canopy);
    }
    this.stats.props++;
  }

  /** Lamps, benches, bins, hydrants and trees along the four pavements of a block. */
  buildFrontage(i, j, district, rng, push) {
    const P = CITY.PITCH, K = CITY.KERB_HALF, R = CITY.ROAD_HALF;
    const x0 = i * P, x1 = (i + 1) * P, z0 = j * P, z1 = (j + 1) * P;
    const inset = (R + K) / 2;

    const edges = [
      { ax: 'x', from: x0 + K, to: x1 - K, fixed: z0 + inset, ry: 0, nz: -1, nx: 0 },
      { ax: 'x', from: x0 + K, to: x1 - K, fixed: z1 - inset, ry: Math.PI, nz: 1, nx: 0 },
      { ax: 'z', from: z0 + K, to: z1 - K, fixed: x0 + inset, ry: -Math.PI / 2, nz: 0, nx: -1 },
      { ax: 'z', from: z0 + K, to: z1 - K, fixed: x1 - inset, ry: Math.PI / 2, nz: 0, nx: 1 },
    ];

    for (const e of edges) {
      const len = e.to - e.from;
      const lamps = Math.max(2, Math.round(len / 26));
      for (let k = 0; k <= lamps; k++) {
        const t = e.from + (len * k) / lamps;
        const px = e.ax === 'x' ? t : e.fixed;
        const pz = e.ax === 'x' ? e.fixed : t;
        if (k % 2 === 0) {
          const ry = e.ry + Math.PI; // arm reaches out over the carriageway
          const pole = G.streetLight(ry);
          G.place(pole, px, 0.16, pz);
          push('darkMetal', this.mats.darkMetal, pole);
          const head = G.streetLightHead(ry);
          G.place(head, px, 0.16, pz);
          push('lampOn', this.mats.lampOn, head);
          const hx = px + Math.sin(ry) * 2.5, hz = pz + Math.cos(ry) * 2.5;
          this.streetLamps.push({ x: hx, y: 8.7, z: hz });
        } else if (rng.chance(0.55)) {
          this.addTree(px, pz, district, rng, push);
        } else if (rng.chance(0.5)) {
          const b = G.bench(e.ry);
          G.place(b, px, 0.16, pz);
          push('trunk', this.mats.trunk, b);
        } else if (rng.chance(0.5)) {
          const b = G.bin();
          G.place(b, px, 0.16, pz);
          push('darkMetal', this.mats.darkMetal, b);
        } else {
          const h = G.hydrant();
          G.place(h, px + (e.nx * -0.6), 0.16, pz + (e.nz * -0.6));
          push('paintedRed', this.mats.paintedRed, h);
        }
      }
      if (district !== 'industrial' && rng.chance(0.35)) {
        const bs = G.busStop(e.ry);
        const t = e.from + len * rng.range(0.3, 0.7);
        G.place(bs, e.ax === 'x' ? t : e.fixed, 0.16, e.ax === 'x' ? e.fixed : t);
        push('darkMetal', this.mats.darkMetal, bs);
      }
      if (district === 'industrial' && rng.chance(0.6)) {
        const up = G.utilityPole(e.ry);
        const t = e.from + len * rng.range(0.2, 0.8);
        G.place(up, e.ax === 'x' ? t : e.fixed, 0.16, e.ax === 'x' ? e.fixed : t);
        push('trunk', this.mats.trunk, up);
      }
      // Parking bay markings along the kerb.
      const bays = Math.floor(len / 6);
      for (let k = 0; k < bays; k++) {
        const t = e.from + k * 6 + 3;
        const g = e.ax === 'x' ? G.ground(0.12, 4.6, 0.014) : G.ground(4.6, 0.12, 0.014);
        const px = e.ax === 'x' ? t : e.fixed + (e.nx > 0 ? -2.6 : 2.6);
        const pz = e.ax === 'x' ? e.fixed + (e.nz > 0 ? -2.6 : 2.6) : t;
        G.place(g, px, 0, pz);
        push('markW', this.mats.markingWhite, g);
      }
    }
  }

  // ------------------------------------------------------------------ signals
  buildSignals() {
    const poles = [];
    const lensPositions = [];
    const K = CITY.KERB_HALF, R = CITY.ROAD_HALF;
    for (let i = 0; i < CITY.CELLS; i++) {
      for (let j = 0; j < CITY.CELLS; j++) {
        const x = i * CITY.PITCH, z = j * CITY.PITCH;
        const corners = [
          { dx: -1, dz: -1, ry: 0 }, { dx: 1, dz: -1, ry: Math.PI / 2 },
          { dx: 1, dz: 1, ry: Math.PI }, { dx: -1, dz: 1, ry: -Math.PI / 2 },
        ];
        for (const c of corners) {
          const px = x + c.dx * (R + 1.6), pz = z + c.dz * (R + 1.6);
          const g = G.trafficSignalPole(c.ry);
          G.place(g, px, 0.16, pz);
          poles.push(g);
          // Lens stack on the arm-mounted head. `axis` says which phase drives it.
          const ax = Math.abs(Math.cos(c.ry)) > 0.5 ? 'z' : 'x';
          const hx = px + Math.sin(c.ry) * 3.8, hz = pz + Math.cos(c.ry) * 3.8;
          lensPositions.push({ x: hx, y: 6.1, z: hz, ry: c.ry, node: { i, j }, axis: ax });
        }
      }
    }
    const merged = G.mergeGeometries(poles, false);
    const mesh = new THREE.Mesh(merged, this.mats.darkMetal);
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    poles.forEach((g) => g.dispose());

    // Three lenses per head, driven by instanceColor.
    const lensGeo = new THREE.CircleGeometry(0.14, 10);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6,
      roughness: 0.4, side: THREE.DoubleSide,
    });
    const inst = new THREE.InstancedMesh(lensGeo, lensMat, lensPositions.length * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    const v = new THREE.Vector3();
    lensPositions.forEach((p, idx) => {
      for (let k = 0; k < 3; k++) {
        e.set(0, p.ry, 0);
        q.setFromEuler(e);
        v.set(p.x + Math.sin(p.ry) * 0.22, p.y + 0.38 - k * 0.38, p.z + Math.cos(p.ry) * 0.22);
        m.compose(v, q, s);
        inst.setMatrixAt(idx * 3 + k, m);
        inst.setColorAt(idx * 3 + k, new THREE.Color(0x101010));
      }
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    this.root.add(inst);
    this.signalLenses = inst;
    this.signalHeads = lensPositions;
    this._lensColour = new THREE.Color();
  }

  updateSignals(clockSeconds) {
    if (!this.signalLenses) return;
    const c = this._lensColour;
    const OFF = 0x0d0d0d;
    for (let idx = 0; idx < this.signalHeads.length; idx++) {
      const h = this.signalHeads[idx];
      const node = this.graph.node(h.node.i, h.node.j);
      const state = this.graph.lightFor(node, clockSeconds)[h.axis];
      const cols = [
        state === 'red' ? 0xff2b1c : OFF,
        state === 'amber' ? 0xffaa11 : OFF,
        state === 'green' ? 0x22ee55 : OFF,
      ];
      for (let k = 0; k < 3; k++) {
        c.setHex(cols[k]);
        this.signalLenses.setColorAt(idx * 3 + k, c);
      }
    }
    if (this.signalLenses.instanceColor) this.signalLenses.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ landmarks
  buildLandmarks() {
    for (const p of this.pois) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.ry || 0;

      // A signature building for each point of interest, so they read at a distance.
      const w = p.kind === 'garage' || p.kind === 'tuning' ? 20 : 16;
      const d = 14, h = p.kind === 'story' ? 46 : p.kind === 'police' ? 12 : 9;
      const style = p.kind === 'story' ? 'tower' : p.kind === 'garage' || p.kind === 'tuning' ? 'warehouse' : 'shop';
      const fv = this.facades[style][0];
      const shell = G.buildingShell(w, h, d, fv.tileW, fv.tileH);
      const bm = new THREE.Mesh(shell.walls, fv.mat);
      bm.castShadow = bm.receiveShadow = true;
      g.add(bm);
      const roof = new THREE.Mesh(G.roofSlab(w, h, d, 0.9), this.mats.roof);
      roof.castShadow = true;
      g.add(roof);

      // Frontage: glazing, shutter and a lit sign.
      const front = d / 2 + 0.06;
      if (p.kind === 'garage' || p.kind === 'tuning') {
        const shutter = new THREE.Mesh(G.box(7.4, 4.4, 0.25), this.mats.metal);
        shutter.position.set(-w / 4, 2.3, front);
        g.add(shutter);
        const door = new THREE.Mesh(G.box(1.4, 2.4, 0.2), this.mats.darkMetal);
        door.position.set(w / 4, 1.2, front);
        g.add(door);
      } else {
        const gl = new THREE.Mesh(G.glazing(w * 0.7, 3.0), this.mats.glass);
        gl.position.set(0, 2.0, front);
        g.add(gl);
        const sf = new THREE.Mesh(G.shopfront(w * 0.78), this.mats.concrete);
        sf.position.set(0, 0, front - 0.05);
        g.add(sf);
      }

      const signMat = new THREE.MeshStandardMaterial({
        map: T.signboard(p.sign || p.name, '#101c24', signColour(p.kind), p.sub || ''),
        emissiveMap: T.signGlow(p.sign || p.name, signColour(p.kind), p.sub || ''),
        emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.7, side: THREE.DoubleSide,
      });
      this.emissiveMats.push(signMat);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, w * 0.2), signMat);
      sign.position.set(0, h * 0.62, front + 0.12);
      g.add(sign);

      // A blade sign hanging perpendicular, like a real high street.
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), signMat);
      blade.position.set(w / 2 + 1.6, 5.2, front - 2.5);
      blade.rotation.y = Math.PI / 2;
      g.add(blade);

      this.root.add(g);
      this.colliders.add({
        minX: p.x - w / 2 - 1, maxX: p.x + w / 2 + 1,
        minZ: p.z - d / 2 - 1, maxZ: p.z + d / 2 + 1,
        height: h, tag: 'poi', ref: p.id,
      });

      // Interaction volume just outside the door.
      const fx = p.x + Math.sin(p.ry || 0) * (d / 2 + 2.2);
      const fz = p.z + Math.cos(p.ry || 0) * (d / 2 + 2.2);
      this.doors.push({ x: fx, z: fz, r: 3.4, poi: p });
      p.doorX = fx; p.doorZ = fz;
    }

    // The pier: deck, piles, railing, and a lit arch at the entrance.
    this.buildPier();
  }

  buildPier() {
    const g = new THREE.Group();
    const z = CITY.PITCH * 6;
    const deck = new THREE.Mesh(G.ground(240, 22, 4.2, 40, 4), this.mats.trunk);
    deck.position.set(-160, 0, z);
    deck.receiveShadow = true;
    g.add(deck);
    const piles = [];
    for (let k = 0; k < 28; k++) {
      const px = -280 + k * 9;
      for (const pz of [z - 9, z + 9]) {
        piles.push(G.place(new THREE.CylinderGeometry(0.4, 0.5, 9, 7), px, 0, pz));
      }
    }
    const pm = new THREE.Mesh(G.mergeGeometries(piles, false), this.mats.trunk);
    g.add(pm);
    const rail = [];
    for (const pz of [z - 10.5, z + 10.5]) rail.push(G.fenceRun(240, 0) && G.place(G.fenceRun(240, 0), -160, 4.2, pz));
    g.add(new THREE.Mesh(G.mergeGeometries(rail, false), this.mats.darkMetal));
    this.root.add(g);
    this.colliders.add({ minX: -285, maxX: -40, minZ: z - 11, maxZ: z - 10, height: 2.2, tag: 'rail' });
    this.colliders.add({ minX: -285, maxX: -40, minZ: z + 10, maxZ: z + 11, height: 2.2, tag: 'rail' });
  }

  // ------------------------------------------------------------------ interiors
  /**
   * Interiors live 500 m below the city and are reached by a fade-out teleport.
   * Cheap, reliable, and the player never sees the seam.
   */
  buildInteriors() {
    const defs = [
      {
        id: 'vega_shop', w: 22, d: 16, h: 5.2, floor: this.mats.concrete, wall: this.mats.concrete,
        label: 'Vega & Daughter Auto', props: 'garage',
      },
      {
        id: 'apartment_1', w: 12, d: 10, h: 2.9, floor: this.mats.trunk, wall: this.mats.pavement,
        label: 'Linnet Street Studio', props: 'apartment',
      },
    ];
    let baseZ = -500;
    for (const def of defs) {
      const grp = new THREE.Group();
      grp.position.set(0, -500, baseZ);
      const parts = [];
      parts.push(G.ground(def.w, def.d, 0, def.w / 4, def.d / 4));
      const ceil = G.ground(def.w, def.d, def.h, def.w / 4, def.d / 4);
      ceil.scale(1, -1, 1);
      parts.push(ceil);
      const merged = G.mergeGeometries(parts, false);
      merged.computeVertexNormals();
      const fl = new THREE.Mesh(merged, def.floor);
      fl.receiveShadow = true;
      grp.add(fl);

      const walls = [];
      walls.push(G.place(G.box(def.w, def.h, 0.3), 0, def.h / 2, -def.d / 2));
      walls.push(G.place(G.box(def.w, def.h, 0.3), 0, def.h / 2, def.d / 2));
      walls.push(G.place(G.box(0.3, def.h, def.d), -def.w / 2, def.h / 2, 0));
      walls.push(G.place(G.box(0.3, def.h, def.d), def.w / 2, def.h / 2, 0));
      grp.add(new THREE.Mesh(G.mergeGeometries(walls, false), def.wall));

      const propGeos = [];
      if (def.props === 'garage') {
        // Two ramps, a tool bench, tyre stacks, a hanging lamp rig.
        propGeos.push(G.place(G.box(4.4, 0.35, 1.0), -5, 0.4, -3));
        propGeos.push(G.place(G.box(4.4, 0.35, 1.0), -5, 0.4, -1));
        propGeos.push(G.place(G.box(7.0, 1.0, 0.8), 8, 0.5, -6.5));
        for (let k = 0; k < 5; k++) propGeos.push(G.place(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 12), 9.5, 0.13 + k * 0.26, 5));
        for (let k = 0; k < 4; k++) propGeos.push(G.place(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 12), 8.2, 0.13 + k * 0.26, 5.6));
        propGeos.push(G.place(G.box(0.9, 1.9, 0.6), -9.5, 0.95, 6));
      } else {
        propGeos.push(G.place(G.box(2.0, 0.55, 1.6), -3, 0.28, -2));    // bed
        propGeos.push(G.place(G.box(1.4, 0.75, 0.7), 3, 0.38, 2));      // desk
        propGeos.push(G.place(G.box(1.9, 0.7, 0.85), 3.5, 0.35, -2.5)); // sofa
        propGeos.push(G.place(G.box(0.7, 1.8, 0.5), -5, 0.9, 3));       // wardrobe
      }
      const pm = new THREE.Mesh(G.mergeGeometries(propGeos, false), this.mats.darkMetal);
      pm.castShadow = true;
      grp.add(pm);

      const lamp = new THREE.PointLight(0xffd9a8, def.props === 'garage' ? 3.2 : 2.0, 26, 1.7);
      lamp.position.set(0, def.h - 0.5, 0);
      grp.add(lamp);
      grp.add(new THREE.AmbientLight(0x3a4048, 1.4));
      grp.visible = false;
      this.root.add(grp);

      this.interiors.set(def.id, {
        group: grp, def,
        origin: new THREE.Vector3(0, -500, baseZ),
        spawn: new THREE.Vector3(0, -500 + 0.1, baseZ + def.d / 2 - 2),
        exit: new THREE.Vector3(0, -500 + 0.1, baseZ + def.d / 2 - 1.2),
        bounds: { minX: -def.w / 2 + 0.6, maxX: def.w / 2 - 0.6, minZ: baseZ - def.d / 2 + 0.6, maxZ: baseZ + def.d / 2 - 0.6 },
      });
      baseZ -= 120;
    }
  }

  // ------------------------------------------------------------------ lighting pool
  buildLightPool() {
    const n = preset().streetLights;
    for (let k = 0; k < n; k++) {
      const l = new THREE.PointLight(0xffb765, 0, 34, 1.9);
      l.visible = false;
      this.scene.add(l);
      this.lightPool.push(l);
    }
  }

  /** Snap the small pool of real point lights to the nearest lamp heads. */
  updateLightPool(pos, nightAmount) {
    if (!this.lightPool.length) return;
    if (nightAmount < 0.05) {
      for (const l of this.lightPool) l.visible = false;
      return;
    }
    const cand = [];
    for (const s of this.streetLamps) {
      const d = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2;
      if (d < 70 * 70) cand.push({ s, d });
    }
    cand.sort((a, b) => a.d - b.d);
    for (let k = 0; k < this.lightPool.length; k++) {
      const l = this.lightPool[k];
      if (k < cand.length) {
        l.position.set(cand[k].s.x, cand[k].s.y, cand[k].s.z);
        l.intensity = 26 * nightAmount;
        l.visible = true;
      } else l.visible = false;
    }
  }

  /** Streaming: show only chunks within the preset radius. */
  updateStreaming(pos) {
    const r = preset().streamRadius * CHUNK_SIZE;
    const r2 = r * r;
    for (const [, g] of this.chunks) {
      const c = g.userData.centre;
      const dx = c.x - pos.x, dz = c.z - pos.z;
      const vis = dx * dx + dz * dz < r2;
      if (g.visible !== vis) g.visible = vis;
    }
  }

  /** Windows and signs light up as the sun goes down. */
  setNightAmount(a) {
    for (const m of this.emissiveMats) {
      m.emissiveIntensity = m === this.mats.lampOn ? a * 2.2 : a * (m.emissiveMap ? 1.0 : 0.6);
      m.needsUpdate = false;
    }
  }

  /** Wet roads: drop roughness and lift a little specular tint. */
  setWetness(w) {
    const M = this.mats;
    M.asphalt.roughness = 0.94 - w * 0.62;
    M.asphalt.metalness = w * 0.28;
    M.pavement.roughness = 0.92 - w * 0.42;
    M.markingWhite.roughness = 0.75 - w * 0.45;
    M.markingYellow.roughness = 0.75 - w * 0.45;
  }

  animateOcean(t) {
    if (!this.ocean) return;
    const pos = this.ocean.geometry.attributes.position;
    const base = this.oceanBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      pos.setZ(i, Math.sin(x * 0.012 + t * 0.9) * 0.55 + Math.cos(y * 0.02 - t * 0.7) * 0.4);
    }
    pos.needsUpdate = true;
    this.ocean.geometry.computeVertexNormals();
  }

  doorAt(x, z) {
    for (const d of this.doors) {
      if ((d.x - x) ** 2 + (d.z - z) ** 2 < d.r * d.r) return d;
    }
    return null;
  }
}

// ------------------------------------------------------------------ helpers

function frame() { return new Promise((r) => (window.requestAnimationFrame ? requestAnimationFrame(() => r()) : setTimeout(r, 0))); }

function signColour(kind) {
  return kind === 'police' ? '#7fb4ff'
    : kind === 'hospital' ? '#ff8a8a'
      : kind === 'story' ? '#cfd8e0'
        : kind === 'garage' || kind === 'tuning' ? '#7fe3cd'
          : '#ffb347';
}

function DISTRICT_LABEL(ci, cj) {
  const d = districtAt(ci * CHUNK_CELLS, cj * CHUNK_CELLS);
  return ({ coast: 'Sunset Reach', downtown: 'Downtown', midtown: 'Verdugo Row', residential: 'Palm Hollow', industrial: 'Kestrel Docks', hills: 'Aurelio Heights' })[d];
}

/** Split a block into street-facing lots. Every lot knows which way the street is. */
function subdivide(x0, z0, x1, z1, target, rng) {
  const lots = [];
  const w = x1 - x0, d = z1 - z0;
  const cols = Math.max(1, Math.round(w / target));
  const rows = Math.max(1, Math.round(d / target));
  for (let a = 0; a < cols; a++) {
    for (let b = 0; b < rows; b++) {
      const isEdge = a === 0 || b === 0 || a === cols - 1 || b === rows - 1;
      if (!isEdge && rng.chance(0.65)) continue; // hollow block interiors -> yards & parking
      const lx0 = x0 + (w * a) / cols, lx1 = x0 + (w * (a + 1)) / cols;
      const lz0 = z0 + (d * b) / rows, lz1 = z0 + (d * (b + 1)) / rows;
      let fx = 0, fz = 0;
      if (a === 0) fx = -1; else if (a === cols - 1) fx = 1;
      if (b === 0) fz = -1; else if (b === rows - 1) fz = 1;
      if (fx && fz) { if (rng.chance(0.5)) fx = 0; else fz = 0; }
      lots.push({
        x0: lx0, z0: lz0, x1: lx1, z1: lz1,
        cx: (lx0 + lx1) / 2, cz: (lz0 + lz1) / 2,
        w: lx1 - lx0, d: lz1 - lz0,
        facing: { x: fx, z: fz },
      });
    }
  }
  return lots;
}

const BLOCK_PLANS = {
  downtown: () => ({ lotSize: 30, fillRate: 0.92, minH: 26, maxH: 86, styles: ['tower', 'office', 'tower'], retail: true }),
  midtown: () => ({ lotSize: 22, fillRate: 0.85, minH: 9, maxH: 26, styles: ['office', 'brick', 'shop'], retail: true }),
  coast: () => ({ lotSize: 20, fillRate: 0.72, minH: 5, maxH: 15, styles: ['stucco', 'shop', 'stucco'], retail: true }),
  residential: () => ({ lotSize: 17, fillRate: 0.8, minH: 4.5, maxH: 12, styles: ['stucco', 'brick', 'stucco'], retail: false }),
  industrial: () => ({ lotSize: 32, fillRate: 0.7, minH: 7, maxH: 15, styles: ['warehouse', 'warehouse', 'brick'], retail: false }),
  hills: () => ({ lotSize: 24, fillRate: 0.55, minH: 5, maxH: 11, styles: ['stucco', 'stucco', 'shop'], retail: false }),
};
