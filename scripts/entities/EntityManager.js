/**
 * EntityManager — population, spawning, level-of-detail AI ticking, alerts and
 * bullet hit resolution against creatures.
 *
 * Distant creatures are updated at a fraction of the frame rate and hidden
 * entirely past the view distance; this is what keeps a hundred-odd AI agents
 * affordable.
 */
import * as THREE from 'three';
import { Mutant, MUTANT_CONFIG } from './MutantAI.js';
import { Boss, BOSSES } from './Bosses.js';
import { Animal, ANIMAL_CONFIG } from './AnimalAI.js';
import { PLAYABLE_RADIUS } from '../world/Terrain.js';

const LOD_NEAR = 60;
const LOD_MID = 130;
const LOD_FAR = 235;

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.all = [];
    this.active = [];
    this.frame = 0;
    this.mutantCap = 42;
    this.animalCap = 46;
    this.spawnZones = [];
  }

  /* ---------------- population ---------------- */

  populate(landmarks, rng, density, biome) {
    const T = this.game.world.terrain;
    const scene = this.game.scene;
    this.biome = biome || null;
    this.mutantCap = Math.round(42 * density);
    this.animalCap = Math.round(46 * Math.min(1.2, density + 0.2));

    // The biome decides who lives here. Weightings keep the biome's own
    // creature dominant without making the place a single-enemy shooting
    // gallery.
    const roster = (biome && biome.creatures.mutants) || ['stalker', 'crawler', 'screamer', 'brute'];
    const weighted = roster.map((id, i) => [id, i === 0 ? 6 : Math.max(1, 4 - i)]);
    const wildlife = !biome || biome.creatures.wildlife !== false;

    // Territories around threatening landmarks
    const spawnPt = this.game.world.spawnPoint;
    for (const lm of landmarks) {
      if (lm.threat <= 0.05) continue;
      // The quiet ring is a property of the *world*, not of one spawn loop: a
      // threatening landmark that happens to sit near the campfire would
      // otherwise put four stalkers inside it and undo the whole idea.
      if (Math.hypot(lm.x - spawnPt.x, lm.z - spawnPt.z) < 95) continue;
      const n = Math.round((1 + lm.threat * 4.2) * density);
      for (let i = 0; i < n; i++) {
        // Landmarks skew the roster: the local horror concentrates in the
        // places it nests, and the imports show up around the edges.
        const local = weighted.map(([id, w], k) => [id,
          w * (lm.type === 'nest' || lm.type === 'cave' ? (k === 0 ? 1.8 : 0.8) : 1)]);
        const type = rng.weighted(local);
        const spot = T.findWalkable(lm.x, lm.z, rng, 20, 12 + lm.clear + rng() * 24);
        this.spawnMutant(type, spot.x, spot.z);
      }
      this.spawnZones.push({ x: lm.x, z: lm.z, threat: lm.threat, r: 40 });
    }

    // Roamers spread through the forest, biased away from the starting camp
    const spawn = this.game.world.spawnPoint;
    let guard = 0;
    while (this.countAlive('mutant') < this.mutantCap && guard++ < 400) {
      const a = rng() * Math.PI * 2, r = 70 + rng() * (PLAYABLE_RADIUS - 90);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // A quiet ring around where the player wakes up. The first minute of a
      // horror game should let the player learn the controls and the dark
      // before anything comes for them; being killed at the campfire teaches
      // nothing except that the game is unfair.
      if (Math.hypot(x - spawn.x, z - spawn.z) < 110) continue;
      if (T.isWater(x, z) || T.slopeAt(x, z) > 0.5) continue;
      const type = rng.weighted(weighted);
      this.spawnMutant(type, x, z);
    }

    // Wildlife by habitat: deer and rabbits in open damp ground, wolves in the
    // deep forest, boar near undergrowth, bears rare and remote.
    guard = 0;
    while (wildlife && this.countAlive('animal') < this.animalCap && guard++ < 600) {
      const a = rng() * Math.PI * 2, r = rng() * (PLAYABLE_RADIUS - 30);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (T.isWater(x, z) || T.slopeAt(x, z) > 0.5) continue;
      const m = T.moistureAt(x, z);
      const distFromSpawn = Math.hypot(x - spawn.x, z - spawn.z);
      let type;
      if (distFromSpawn > 220 && rng() < 0.10) type = 'bear';
      else type = rng.weighted([
        ['rabbit', 7 + (1 - m) * 4],
        ['deer', 6 + m * 4],
        // Boar charge when startled and hit hard enough to end a fresh run in
        // seconds. Deer and rabbits stay near the campfire — they are what
        // makes the opening feel like a forest rather than a level — but
        // anything that fights back keeps its distance.
        ['boar', distFromSpawn > 75 ? 3 + m * 3 : 0],
        // The quiet ring that holds the mutants back has to hold the predators
        // back too, or the careful opening minute is spent being eaten by a
        // wolf pack forty metres from the campfire — which reads to the player
        // as the game being unfair, not as the forest being dangerous.
        ['wolf', distFromSpawn > 110 ? 5 : 0],
      ]);
      if (type === 'wolf') {
        // wolves come in packs of 2–4
        const packSize = 2 + Math.floor(rng() * 3);
        const packId = Math.floor(rng() * 1e6);
        for (let i = 0; i < packSize; i++) {
          const s = T.findWalkable(x, z, rng, 12, 14);
          const w = this.spawnAnimal('wolf', s.x, s.z);
          if (w) w.packId = packId;
        }
      } else {
        this.spawnAnimal(type, x, z);
      }
    }
  }

  spawnMutant(type, x, z) {
    if (!MUTANT_CONFIG[type]) return null;
    const m = new Mutant(this.game, type);
    m.spawn(x, z, this.game.scene);
    this.all.push(m);
    this.active.push(m);
    return m;
  }

  /** Place the biome's boss and its arena. */
  spawnBoss(id, x, z, depthScale = 1) {
    if (!BOSSES[id]) return null;
    const boss = new Boss(this.game, id, depthScale);
    boss.spawnAt(x, z, this.game.scene);
    this.all.push(boss);
    this.active.push(boss);
    this.boss = boss;
    return boss;
  }

  spawnAnimal(type, x, z) {
    if (!ANIMAL_CONFIG[type]) return null;
    const a = new Animal(this.game, type);
    a.spawn(x, z, this.game.scene);
    this.all.push(a);
    this.active.push(a);
    return a;
  }

  countAlive(faction) {
    let n = 0;
    for (const e of this.active) if (e.alive && e.faction === faction) n++;
    return n;
  }

  /* ---------------- alerts ---------------- */

  /** Everything within radius becomes suspicious of `pos`. */
  alertNear(pos, radius, exclude, strength, focusPos) {
    for (const e of this.active) {
      if (!e.alive || e === exclude) continue;
      if (e.faction !== 'mutant') continue;
      const d = Math.hypot(e.position.x - pos.x, e.position.z - pos.z);
      if (d > radius) continue;
      const s = strength * (1 - d / radius);
      e.alertLevel = Math.min(1, e.alertLevel + s);
      e.lastKnownPos.copy(focusPos || pos);
      if (e.state === 'IDLE' || e.state === 'PATROL' || e.state === 'GRAZE') { e.state = 'INVESTIGATE'; e.stateTime = 0; }
    }
  }

  alertPack(source, radius) {
    for (const e of this.active) {
      if (!e.alive || e === source || e.packId !== source.packId || !e.packId) continue;
      const d = Math.hypot(e.position.x - source.position.x, e.position.z - source.position.z);
      if (d > radius) continue;
      e.aggro = Math.max(e.aggro, source.aggro * 0.9);
      e.alertLevel = 1;
      e.lastKnownPos.copy(source.lastKnownPos);
      if (e.state === 'GRAZE' || e.state === 'PATROL' || e.state === 'IDLE') { e.state = 'STALK'; e.stateTime = 0; }
    }
  }

  /** Gunshots carry a long way and pull mutants toward the sound. */
  onGunshot(pos, radius) {
    for (const e of this.active) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - pos.x, e.position.z - pos.z);
      if (e.faction === 'mutant') {
        if (d < 130) { e.alertLevel = Math.min(1, e.alertLevel + (1 - d / 130) * 0.95); e.lastKnownPos.copy(pos);
          if (e.state === 'IDLE' || e.state === 'PATROL') { e.state = 'INVESTIGATE'; e.stateTime = 0; } }
      } else if (d < 80) {
        if (e.temperament === 'skittish') { e.state = 'FLEE'; e.stateTime = 0; }
        else e.alertLevel = Math.min(1, e.alertLevel + 0.4);
      }
    }
  }

  onNoise(pos, level) {
    if (level < 0.05) return;
    for (const e of this.active) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - pos.x, e.position.z - pos.z);
      if (d > 90) continue;
      e.hear(pos, level);
    }
  }

  /* ---------------- update ---------------- */

  update(dt, playerPos, viewDistance) {
    this.frame++;
    const nearest = { mutant: Infinity, hostile: Infinity };
    let threatCount = 0;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      const dx = e.position.x - playerPos.x, dz = e.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);

      if (!e.alive) {
        if (!e.updateCorpse(dt)) {
          e.despawn(this.game.scene);
          this.active.splice(i, 1);
        } else {
          e.model.visible = dist < viewDistance + 40;
        }
        continue;
      }

      // visibility / LOD
      const lod = dist < LOD_NEAR ? 0 : dist < LOD_MID ? 1 : dist < LOD_FAR ? 2 : 3;
      e.lodLevel = lod;
      e.model.visible = dist < viewDistance + 45;

      if (lod === 3) {
        // dormant: nudge them home occasionally so the world does not clump
        if ((this.frame + e.id) % 120 === 0) e.update(dt * 120, dist, lod);
        continue;
      }
      const stride = lod === 0 ? 1 : lod === 1 ? 2 : 6;
      if ((this.frame + e.id) % stride === 0) e.update(dt * stride, dist, lod);

      if (e.faction === 'mutant') {
        nearest.mutant = Math.min(nearest.mutant, dist);
        if (e.state === 'CHASE' || e.state === 'ATTACK' || e.state === 'STALK') threatCount++;
      }
      if ((e.faction === 'mutant' && (e.state === 'CHASE' || e.state === 'ATTACK')) ||
          (e.faction === 'animal' && (e.state === 'CHASE' || e.state === 'ATTACK'))) {
        nearest.hostile = Math.min(nearest.hostile, dist);
      }
    }

    this.nearestMutant = nearest.mutant;
    this.nearestHostile = nearest.hostile;
    this.threatCount = threatCount;
  }

  /* ---------------- hit testing ---------------- */

  /**
   * Ray vs creature capsules. Returns the closest hit within maxDist.
   * Head is a sphere at headHeight; body is a vertical capsule.
   */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const e of this.active) {
      if (!e.alive) continue;
      const dx = e.position.x - origin.x, dz = e.position.z - origin.z;
      if (dx * dx + dz * dz > (maxDist + 3) * (maxDist + 3)) continue;

      // head sphere
      _c.set(e.position.x, e.position.y + e.headHeight, e.position.z);
      let t = raySphere(origin, dir, _c, e.radius * 0.62);
      if (t !== null && t < maxDist && (!best || t < best.dist)) {
        best = { dist: t, entity: e, part: 'head' };
      }
      // Bosses carry named weak points, tested before the body so a hit on
      // one is never swallowed by the plate armour around it.
      if (e.weakPoints) {
        for (const w of e.weakPoints) {
          if (!w.revealed) continue;
          const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
          _c.set(e.position.x - fx * (w.z || 0), e.position.y + w.y, e.position.z - fz * (w.z || 0));
          const tw = raySphere(origin, dir, _c, w.r);
          if (tw !== null && tw < maxDist && (!best || tw < best.dist)) {
            best = { dist: tw, entity: e, part: w.name };
          }
        }
      }

      // body capsule approximated by 3 spheres
      const segs = 3;
      for (let i = 0; i < segs; i++) {
        const h = e.height * (0.22 + (i / (segs - 1)) * 0.55);
        _c.set(e.position.x, e.position.y + h, e.position.z);
        t = raySphere(origin, dir, _c, e.radius * 1.05);
        if (t !== null && t < maxDist && (!best || t < best.dist)) {
          best = { dist: t, entity: e, part: 'body' };
        }
      }
    }
    if (best) {
      best.point = new THREE.Vector3().copy(origin).addScaledVector(dir, best.dist);
      best.normal = new THREE.Vector3().copy(dir).negate();
      best.material = 'flesh';
    }
    return best;
  }

  /** Nearest live creature the player is looking at (for the interaction UI). */
  lookedAt(origin, dir, maxDist = 4.0) {
    const r = this.raycast(origin, dir, maxDist);
    return r ? r.entity : null;
  }

  nearestCorpse(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const e of this.active) {
      if (e.alive || e.looted) continue;
      const d = Math.hypot(e.position.x - pos.x, e.position.z - pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  clear() {
    for (const e of this.all) e.despawn(this.game.scene);
    this.all.length = 0;
    this.active.length = 0;
  }

  serialize() {
    return this.active.filter((e) => e.alive).map((e) => ({
      t: e.type, f: e.faction, x: e.position.x, z: e.position.z, h: e.health,
    }));
  }
}

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t > 0 ? t : null;
}

const _c = new THREE.Vector3();
