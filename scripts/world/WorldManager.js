/**
 * WorldManager — owns the terrain, the forest, the landmarks, the night sky
 * and the queries everything else depends on (raycast, line of sight,
 * interactable lookup, noise propagation).
 */
import * as THREE from 'three';
import { Terrain, PLAYABLE_RADIUS, WORLD_SIZE } from './Terrain.js';
import { Vegetation, windUniforms } from './Vegetation.js';
import { planLandmarks, buildLandmark, NOTES, LANDMARK_TYPES } from './Landmarks.js';
import { plankTexture, metalTexture, rockTexture, softDot, normalFor, roughnessFor } from './Textures.js';
import { Settings } from '../core/Settings.js';
import { getBiome, skyFor } from './Biomes.js';
import { bakeStatic, freeze } from './Bake.js';
import { makeRNG } from '../core/RNG.js';
import { Audio } from '../core/AudioManager.js';

const INTERACT_CELL = 12;

export class WorldManager {
  constructor(game, seed, biomeId = 'hollow') {
    this.game = game;
    this.seed = seed;
    this.biomeId = biomeId;
    this.biome = getBiome(biomeId);
    this.scene = game.scene;
    this.terrain = new Terrain(seed, biomeId);
    this.structureBoxes = [];
    this.landmarks = [];
    this.animatedProps = [];      // set pieces that move; ticked each frame
    this.interactCells = new Map();
    this.notes = {};
    for (const n of NOTES) this.notes[n.id] = { ...n, read: false };
    this.dynamicLights = [];
    this.spawnPoint = { x: 0, z: 0 };
    this._lightScratch = [];
  }

  /* ---------------- construction ---------------- */

  async build(onProgress) {
    const step = (p, label) => { onProgress?.(p, label); return new Promise((r) => setTimeout(r, 0)); };

    await step(0.02, 'Surveying ' + this.biome.name.toLowerCase());
    const plan = planLandmarks(this.terrain, this.seed, this.biomeId);
    this.landmarks = plan.landmarks;
    this.spawnPoint = plan.spawn;

    // Flatten build pads before the heightfield is baked.
    for (const lm of this.landmarks) {
      if (['ranger', 'cabin', 'ruin', 'checkpoint', 'tower', 'camp', 'wreck', 'nest'].includes(lm.type)) {
        this.terrain.addFlattenZone(lm.x, lm.z, lm.clear * 0.55, lm.y);
      }
    }

    await step(0.08, 'Raising the ground');
    this.terrain.generate();
    for (const lm of this.landmarks) lm.y = this.terrain.heightAt(lm.x, lm.z);

    await step(0.22, 'Growing the forest');
    this.vegetation = new Vegetation(this.terrain, this.seed, Settings, this.biomeId);
    for (const lm of this.landmarks) this.vegetation.addExclusion(lm.x, lm.z, lm.clear);
    this.vegetation.build();
    this.scene.add(this.vegetation.group);

    await step(0.58, 'Laying the terrain mesh');
    this.terrainMesh = this.terrain.buildMesh(Settings.get('quality'), Settings.get('textureQuality'));
    this.scene.add(this.terrainMesh);
    for (const w of this.terrain.buildWater()) this.scene.add(w);

    await step(0.70, 'Building what people left behind');
    this.buildStructures();

    await step(0.84, 'Hanging the sky');
    this.buildSky();

    await step(0.92, 'Scattering supplies');
    // loot + forage are populated by GameManager (needs inventory/RNG wiring)
    return this;
  }

  buildStructures() {
    const tq = Settings.get('textureQuality');
    const mats = {
      // Relief and wear derived from each texture's own luminance — split
      // grain in the planks, pitting in the steel, fracture in the rock. It is
      // the cheapest thing in the renderer that makes a surface look like a
      // material instead of a coloured box.
      plank: new THREE.MeshStandardMaterial({
        map: plankTexture(tq), roughness: 0.95, color: 0x9a8d7c,
        normalMap: normalFor('plank' + tq, 2.2), normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: roughnessFor('plank' + tq, 0.72, 1.0),
      }),
      metal: new THREE.MeshStandardMaterial({
        map: metalTexture(tq), roughness: 0.6, metalness: 0.65, color: 0x8f9298,
        normalMap: normalFor('metal' + tq, 2.8), normalScale: new THREE.Vector2(1.1, 1.1),
        roughnessMap: roughnessFor('metal' + tq, 0.28, 0.86),
      }),
      rock: new THREE.MeshStandardMaterial({
        map: rockTexture(tq), roughness: 0.95, color: 0x8e8c85,
        normalMap: normalFor('rock' + tq, 3.0), normalScale: new THREE.Vector2(1.2, 1.2),
        roughnessMap: roughnessFor('rock' + tq, 0.7, 1.0),
      }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x6a6a66, roughness: 0.95 }),
      canvas: new THREE.MeshStandardMaterial({ color: 0x54563f, roughness: 1, side: THREE.DoubleSide }),
      shingle: new THREE.MeshStandardMaterial({ color: 0x33322e, roughness: 1, flatShading: true }),
      charred: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 1 }),
      ash: new THREE.MeshStandardMaterial({ color: 0x22201d, roughness: 1 }),
      dirt: new THREE.MeshStandardMaterial({ color: 0x3a3025, roughness: 1 }),
      paint: new THREE.MeshStandardMaterial({ color: 0x5c6a63, roughness: 0.7, metalness: 0.3 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 1 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 1 }),
      sandbag: new THREE.MeshStandardMaterial({ color: 0x585141, roughness: 1 }),
      container: new THREE.MeshStandardMaterial({ map: metalTexture(tq), color: 0x4b5f52, roughness: 0.8, metalness: 0.4 }),
      flesh: new THREE.MeshStandardMaterial({ color: 0x5c3a36, roughness: 0.72, flatShading: true }),
      paper: new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 1 }),
      beacon: new THREE.MeshStandardMaterial({ color: 0xff4a30, emissive: 0xff2a10, emissiveIntensity: 3, roughness: 1 }),
    };
    this.structureMats = mats;

    const rng = makeRNG(this.seed ^ 0xC0FFEE);
    this.landmarkBuilds = [];
    for (const lm of this.landmarks) {
      let built;
      try {
        built = buildLandmark(lm, this.terrain, mats, rng);
      } catch (e) {
        // One bad set piece must not cost the player the whole world.
        console.warn('[landmark]', lm.type, e);
        continue;
      }
      // A landmark is authored as dozens of little meshes and drawn as a
      // handful. Anything a system still needs a handle on — an interactable,
      // a light, a door — is protected and comes through untouched.
      const keep = new Set();
      for (const it of built.interactables || []) { if (it.object) keep.add(it.object); if (it.mesh) keep.add(it.mesh); }
      for (const l of built.lights || []) keep.add(l);
      for (const a of built.animated || []) keep.add(a);
      if (built.animated?.length) this.animatedProps.push(...built.animated);
      built.bake = bakeStatic(built.group, keep);
      freeze(built.group);
      this.scene.add(built.group);
      for (const b of built.obb) this.structureBoxes.push(b);
      lm.built = built;
      this.landmarkBuilds.push(built);
      for (const L of built.lights) this.addDynamicLight(L);
    }
  }

  addDynamicLight(def) {
    const l = new THREE.PointLight(def.color, 0, def.distance, 1.8);
    l.position.set(def.x, def.y, def.z);
    l.castShadow = false;
    this.scene.add(l);
    this.dynamicLights.push({ light: l, def, base: def.intensity });
  }

  /** Drive any landmark that moves. There are few of them and they are cheap. */
  updateProps(t) {
    for (const p of this.animatedProps) p.userData.tick?.(t);
  }

  /** The sky this world is actually using, night grade or morning grade. */
  get skyGrade() { return skyFor(this.biome, Settings.get('timeOfDay')); }

  buildSky() {
    const K = this._sky = this.skyGrade;
    const fogColor = new THREE.Color(K.fog);
    this.scene.fog = new THREE.FogExp2(fogColor, K.fogDensity);
    this.scene.background = fogColor;

    // gradient dome
    const skyGeo = new THREE.SphereGeometry(900, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(K.top) },
        bottom: { value: new THREE.Color(K.bottom) },
        horizon: { value: new THREE.Color(K.horizon) },
        nebula: { value: K.nebula || 0 },
      },
      vertexShader: `varying float vY; varying vec3 vDir;
        void main(){ vDir = normalize(position); vY = vDir.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon; uniform float nebula;
        varying float vY; varying vec3 vDir;
        float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vnoise(vec3 p){
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n = mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x),
                            mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x),
                            mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
          return n;
        }
        void main(){
          float t = clamp(vY, -1.0, 1.0);
          vec3 c = t > 0.0 ? mix(horizon, top, pow(t, 0.55)) : mix(horizon, bottom, pow(-t, 0.7));
          if (nebula > 0.0) {
            // Layered value noise reads as gas at this scale, and costs one
            // extra pass over a 24x16 dome.
            float n = vnoise(vDir * 3.1) * 0.6 + vnoise(vDir * 7.3) * 0.3 + vnoise(vDir * 15.0) * 0.15;
            n = smoothstep(0.42, 0.95, n);
            vec3 gas = mix(vec3(0.30, 0.10, 0.52), vec3(0.06, 0.28, 0.46), vnoise(vDir * 2.0 + 4.0));
            c += gas * n * nebula * (0.35 + 0.65 * max(0.0, t));
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // stars
    const starCount = K.stars;
    const sp = new Float32Array(starCount * 3);
    const sc = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.9 + 0.08;
      sp[i * 3] = Math.cos(a) * r * 800;
      sp[i * 3 + 1] = y * 800;
      sp[i * 3 + 2] = Math.sin(a) * r * 800;
      const b = 0.35 + Math.random() * 0.65;
      const warm = Math.random() < 0.2;
      sc[i * 3] = b * (warm ? 1 : 0.8) * K.starTint[0];
      sc[i * 3 + 1] = b * 0.85 * K.starTint[1];
      sc[i * 3 + 2] = b * (warm ? 0.75 : 1) * K.starTint[2];
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true,
      opacity: 0.85, depthWrite: false, fog: false, map: softDot(),
    }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // moon
    const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot(), color: K.moon, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    moonSprite.scale.set(K.moonSize, K.moonSize, 1);
    // Morning puts the sun low and to the side; night keeps the old moon.
    const sd = K.sunDir || [0.42, 0.58, -0.70];
    this.moonDir = new THREE.Vector3(sd[0], sd[1], sd[2]).normalize();
    moonSprite.position.copy(this.moonDir).multiplyScalar(760);
    this.scene.add(moonSprite);
    this.moonSprite = moonSprite;

    // lights
    this.hemi = new THREE.HemisphereLight(K.hemiSky, K.hemiGround, K.hemiIntensity);
    this.scene.add(this.hemi);

    // A floor of light. The Hollow is meant to be dark, but "dark" has to
    // still mean "you can tell a tree from a mutant from a cliff edge" — a
    // player who cannot navigate is not frightened, only annoyed. This is the
    // one light the player can turn all the way down if they want the
    // original moonless grade.
    this.fillAmbient = new THREE.AmbientLight(K.hemiSky, 0);
    this.scene.add(this.fillAmbient);

    this.moon = new THREE.DirectionalLight(K.moonLight, K.moonIntensity);
    this.moon.position.copy(this.moonDir).multiplyScalar(180);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const d = 70;
    this.moon.shadow.camera.left = -d; this.moon.shadow.camera.right = d;
    this.moon.shadow.camera.top = d; this.moon.shadow.camera.bottom = -d;
    this.moon.shadow.camera.near = 1; this.moon.shadow.camera.far = 420;
    this.moon.shadow.bias = -0.0009;
    this.moon.shadow.normalBias = 0.06;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    this.applyGraphics();
  }

  /**
   * Swap the sky for a different time of day without rebuilding the world.
   * The dome, the stars and the sun are objects rather than uniforms, so the
   * old ones have to go before the new ones are hung.
   */
  rebuildSky() {
    if (!this.sky) return;
    for (const o of [this.sky, this.stars, this.moonSprite, this.hemi, this.fillAmbient, this.moon]) {
      if (!o) continue;
      this.scene.remove(o);
      if (o.target) this.scene.remove(o.target);
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    }
    this.sky = this.stars = this.moonSprite = null;
    this.buildSky();
  }

  applyGraphics() {
    const q = Settings.get('shadows');
    this.moon.castShadow = q !== 'off';
    const size = q === 'high' ? 2048 : q === 'medium' ? 1024 : 512;
    if (this.moon.shadow.mapSize.x !== size) {
      this.moon.shadow.mapSize.set(size, size);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    const vd = Settings.get('viewDistance');
    const fogQ = Settings.get('fogQuality');
    const fd = (this._sky || this.skyGrade).fogDensity;
    if (this.scene.fog) this.scene.fog.density = (fogQ === 'low' ? fd * 1.3 : fd) * (165 / vd);
    const K = this._sky || this.skyGrade;
    const bright = Settings.get('brightness');
    this.hemi.intensity = K.hemiIntensity * bright;
    this.moon.intensity = K.moonIntensity * bright;
    if (this.fillAmbient) this.fillAmbient.intensity = 0.42 * (K.fillMul || 1) * Settings.get('ambientFill') * bright;
    // Exposure is deliberately raised more slowly than the lights: pushing it
    // alone washes the blacks to grey without making anything more legible.
    if (this.game.renderer) this.game.renderer.toneMappingExposure = K.exposure * (0.72 + bright * 0.28);
  }

  /* ---------------- interactable registry ---------------- */

  _cell(x, z) { return `${Math.floor(x / INTERACT_CELL)},${Math.floor(z / INTERACT_CELL)}`; }

  registerInteractable(it) {
    const k = this._cell(it.x, it.z);
    let a = this.interactCells.get(k);
    if (!a) { a = []; this.interactCells.set(k, a); }
    a.push(it);
    it._cellKey = k;
  }

  unregisterInteractable(it) {
    const a = this.interactCells.get(it._cellKey);
    if (!a) return;
    const i = a.indexOf(it);
    if (i >= 0) a.splice(i, 1);
  }

  queryInteractables(pos, radius) {
    const out = [];
    const c = Math.ceil(radius / INTERACT_CELL);
    const bx = Math.floor(pos.x / INTERACT_CELL), bz = Math.floor(pos.z / INTERACT_CELL);
    for (let i = -c; i <= c; i++) {
      for (let j = -c; j <= c; j++) {
        const a = this.interactCells.get(`${bx + i},${bz + j}`);
        if (a) for (const it of a) out.push(it);
      }
    }
    return out;
  }

  /* ---------------- queries ---------------- */

  /**
   * Ray against creatures, terrain, structures and tree trunks.
   * Returns { point, normal, dist, material, entity?, part? } or null.
   */
  raycast(origin, dir, maxDist, entities) {
    let best = null;

    if (entities) {
      const hit = entities.raycast(origin, dir, maxDist);
      if (hit) best = hit;
    }

    const limit = best ? best.dist : maxDist;

    // structures (OBB slab test)
    for (let i = 0; i < this.structureBoxes.length; i++) {
      const b = this.structureBoxes[i];
      const t = rayOBB(origin, dir, b);
      if (t !== null && t < limit && (!best || t < best.dist)) {
        best = {
          dist: t, material: b.type === 'metal' ? 'metal' : b.type === 'rock' ? 'rock' : b.type === 'flesh' ? 'flesh' : 'wood',
          point: new THREE.Vector3().copy(origin).addScaledVector(dir, t),
          normal: new THREE.Vector3(-dir.x, -dir.y, -dir.z).normalize(),
        };
      }
    }

    // tree trunks / rocks (vertical cylinders)
    const cols = this.vegetation.queryColliders(origin.x, origin.z, Math.min(maxDist, 60), this._lightScratch);
    const step = 4;
    // sample along the ray so distant trunks are still tested
    for (let d = 2; d < Math.min(maxDist, best ? best.dist : maxDist); d += step) {
      const px = origin.x + dir.x * d, pz = origin.z + dir.z * d;
      const near = this.vegetation.queryColliders(px, pz, 3.0, this._lightScratch);
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        const t = rayCylinder(origin, dir, c.x, c.z, c.r);
        if (t !== null && t > 0.3 && t < (best ? best.dist : maxDist)) {
          const py = origin.y + dir.y * t;
          const groundY = this.terrain.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
          if (py > groundY - 0.2 && py < groundY + (c.type === 'tree' ? 16 : 2.2)) {
            best = {
              dist: t, material: c.type === 'tree' ? 'wood' : c.type === 'rock' ? 'rock' : 'foliage',
              point: new THREE.Vector3().copy(origin).addScaledVector(dir, t),
              normal: new THREE.Vector3(origin.x + dir.x * t - c.x, 0, origin.z + dir.z * t - c.z).normalize(),
            };
          }
        }
      }
    }

    // terrain march
    const tMax = Math.min(maxDist, best ? best.dist : maxDist);
    let prevD = 0;
    let prevAbove = origin.y - this.terrain.heightAt(origin.x, origin.z);
    const marchStep = Math.max(0.6, tMax / 90);
    for (let d = marchStep; d <= tMax; d += marchStep) {
      const px = origin.x + dir.x * d, py = origin.y + dir.y * d, pz = origin.z + dir.z * d;
      const above = py - this.terrain.heightAt(px, pz);
      if (above <= 0) {
        // refine
        let lo = prevD, hi = d;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const mx = origin.x + dir.x * mid, my = origin.y + dir.y * mid, mz = origin.z + dir.z * mid;
          if (my - this.terrain.heightAt(mx, mz) > 0) lo = mid; else hi = mid;
        }
        if (!best || hi < best.dist) {
          const p = new THREE.Vector3().copy(origin).addScaledVector(dir, hi);
          best = {
            dist: hi, point: p,
            normal: this.terrain.normalAt(p.x, p.z, new THREE.Vector3()),
            material: this.terrain.surfaceAt(p.x, p.z) === 'rock' ? 'rock' :
                      this.terrain.isWater(p.x, p.z) ? 'water' : 'dirt',
          };
        }
        break;
      }
      prevD = d; prevAbove = above;
    }

    return best;
  }

  /** Cheap occlusion test used by AI perception. */
  hasLineOfSight(from, to, dist) {
    const steps = Math.min(16, Math.max(5, Math.ceil(dist / 5)));
    const dx = (to.x - from.x) / steps, dy = (to.y - from.y) / steps, dz = (to.z - from.z) / steps;
    let blockers = 0;
    for (let i = 1; i < steps; i++) {
      const x = from.x + dx * i, y = from.y + dy * i, z = from.z + dz * i;
      if (y < this.terrain.heightAt(x, z) + 0.15) return false;
      const near = this.vegetation.queryColliders(x, z, 1.2, this._lightScratch);
      for (let k = 0; k < near.length; k++) {
        const c = near[k];
        if (c.type !== 'tree') continue;
        const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
        if (d2 < (c.r + 0.15) ** 2) { blockers++; break; }
      }
      if (blockers >= 2) return false;
    }
    // Dense undergrowth degrades sight lines with distance rather than
    // blocking outright, which keeps stalkers from being blind at range.
    return !(blockers === 1 && dist > 26);
  }

  /* ---------------- events ---------------- */

  onNoise(pos, level) { this.game.entities?.onNoise(pos, level); }
  onGunshot(pos, range) { this.game.entities?.onGunshot(pos, range); }
  onImpactNoise(pos) { this.game.entities?.onNoise(pos, 0.4); }

  markNoteRead(id) {
    if (this.notes[id] && !this.notes[id].read) {
      this.notes[id].read = true;
      this.game.stats.itemsLooted += 0;
    }
  }

  useRadio(it) {
    if (it.used) {
      this.game.ui.toast('Only carrier tone now', 'warn');
      this.game.ui.subtitle('…carrier tone. Nothing behind it but the hiss of the valley.');
      return;
    }
    it.used = true;
    this.revealLandmarks(999);
    Audio.animal('distantScream', { x: it.x + 40, y: it.y, z: it.z + 40 });
    this.game.ui.toast('Emergency loop received — all landmarks marked', 'good');
    this.game.ui.subtitle('"…all residents of the Hollow District are advised to shelter and await extraction. Do not approach wildlife. Do not approach persons behaving abnormally. This message repeats."');
  }

  revealLandmarks(radius) {
    const p = this.game.player.position;
    let n = 0;
    for (const lm of this.landmarks) {
      if (lm.discovered) continue;
      if (Math.hypot(lm.x - p.x, lm.z - p.z) <= radius) { lm.discovered = true; n++; }
    }
    return n;
  }

  /** Discovery on approach — drives the compass and the objective line. */
  checkDiscovery(pos) {
    for (const lm of this.landmarks) {
      if (lm.discovered) continue;
      if (Math.hypot(lm.x - pos.x, lm.z - pos.z) < lm.clear + 12) {
        lm.discovered = true;
        this.game.stats.landmarksFound++;
        this.game.ui.toast(`Discovered: ${lm.label}`, 'good');
        this.game.director?.onDiscovery(lm);
        return lm;
      }
    }
    return null;
  }

  nearestUndiscovered(pos) {
    let best = null, bd = Infinity;
    for (const lm of this.landmarks) {
      if (lm.discovered) continue;
      const d = Math.hypot(lm.x - pos.x, lm.z - pos.z);
      if (d < bd) { bd = d; best = lm; }
    }
    return best ? { lm: best, dist: bd } : null;
  }

  /* ---------------- per-frame ---------------- */

  update(dt, time, camPos) {
    windUniforms.uTime.value = time;
    windUniforms.uWind.value = (0.28 + Math.sin(time * 0.13) * 0.16 + Math.sin(time * 0.041) * 0.1)
      * (this.game.windScale ?? 1);

    this.vegetation.updateVisibility(camPos, Settings.get('viewDistance'));
    this.terrain.updateWater(time);

    // sky follows the camera so it never clips
    this.sky.position.set(camPos.x, 0, camPos.z);
    this.stars.position.set(camPos.x, 0, camPos.z);
    this.moonSprite.position.copy(this.moonDir).multiplyScalar(760).add(new THREE.Vector3(camPos.x, 0, camPos.z));

    // shadow frustum follows the player
    this.moon.position.set(camPos.x + this.moonDir.x * 140, camPos.y + this.moonDir.y * 140, camPos.z + this.moonDir.z * 140);
    this.moon.target.position.set(camPos.x, camPos.y - 4, camPos.z);
    this.moon.target.updateMatrixWorld();

    // dynamic light budget: keep only the nearest few alive
    const budget = Settings.get('quality') === 'low' ? 3 : 6;
    const sorted = this.dynamicLights
      .map((L) => ({ L, d: (L.def.x - camPos.x) ** 2 + (L.def.z - camPos.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < sorted.length; i++) {
      const { L, d } = sorted[i];
      const inBudget = i < budget && d < (L.def.distance * 3) ** 2;
      let target = inBudget ? L.base : 0;
      if (L.def.beacon) {
        const blink = (Math.sin(time * 1.15) > 0.55) ? 1 : 0.06;
        target = L.base * blink;
        if (L.def.mesh) L.def.mesh.material.emissiveIntensity = 0.4 + blink * 3.5;
        // the beacon is a navigation landmark: never cull it
        target = L.base * blink;
      } else if (L.def.pulse) {
        target = inBudget ? L.base * (0.55 + Math.sin(time * 1.9) * 0.45) : 0;
      }
      L.light.intensity += (target - L.light.intensity) * Math.min(1, dt * 6);
      L.light.visible = L.light.intensity > 0.001;
    }
  }

  dispose() {
    this.vegetation?.dispose();
    this.terrain?.dispose();
    this.interactCells.clear();
    this.structureBoxes.length = 0;
  }
}

/* ---------------- ray helpers ---------------- */

function rayOBB(o, d, b) {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const dx = o.x - b.x, dz = o.z - b.z;
  const ox = dx * c - dz * s, oz = dx * s + dz * c;
  const oy = o.y - (b.yBot + b.yTop) / 2;
  const ddx = d.x * c - d.z * s, ddz = d.x * s + d.z * c;
  const hy = (b.yTop - b.yBot) / 2;
  let tmin = -Infinity, tmax = Infinity;
  const axes = [[ox, ddx, b.hw], [oy, d.y, hy], [oz, ddz, b.hd]];
  for (const [oo, dd, h] of axes) {
    if (Math.abs(dd) < 1e-8) { if (oo < -h || oo > h) return null; continue; }
    let t1 = (-h - oo) / dd, t2 = (h - oo) / dd;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0.05 ? tmin : (tmax > 0.05 ? tmax : null);
}

function rayCylinder(o, d, cx, cz, r) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  return t > 0 ? t : null;
}
