/**
 * Entity — shared base for every living thing that is not the player.
 *
 * Handles: model attachment, grounded movement with obstacle avoidance,
 * procedural walk animation, hit flinch, knockback, death and corpse decay,
 * plus the perception helpers (sight cone, line of sight, hearing) that both
 * mutant and animal AI build on.
 */
import * as THREE from 'three';
import { CREATURE_FACTORIES } from './CreatureModels.js';

export const STATE = {
  IDLE: 'IDLE', PATROL: 'PATROL', INVESTIGATE: 'INVESTIGATE', STALK: 'STALK',
  CHASE: 'CHASE', ATTACK: 'ATTACK', FLEE: 'FLEE', DEAD: 'DEAD', GRAZE: 'GRAZE',
};

let nextId = 1;

export class Entity {
  constructor(game, type, cfg) {
    this.game = game;
    this.id = nextId++;
    this.type = type;
    this.faction = cfg.faction || 'neutral';
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.knockback = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;

    this.maxHealth = cfg.health;
    this.health = cfg.health;
    this.radius = cfg.radius;
    this.height = cfg.height;
    this.headHeight = cfg.headHeight ?? cfg.height * 0.86;
    this.speed = cfg.speed;
    this.runSpeed = cfg.runSpeed ?? cfg.speed * 1.8;
    this.damage = cfg.damage ?? 0;
    this.attackRange = cfg.attackRange ?? 2.0;
    this.attackCooldown = cfg.attackCooldown ?? 1.5;
    this.viewRange = cfg.viewRange ?? 40;
    this.fov = cfg.fov ?? 1.4;             // half-angle radians
    this.hearRange = cfg.hearRange ?? 45;
    this.armor = cfg.armor ?? 0;
    this.mass = cfg.mass ?? 1;
    this.lootTable = cfg.lootTable || null;
    this.xpNoise = cfg.noise ?? 0.5;

    this.state = STATE.IDLE;
    this.stateTime = 0;
    this.alive = true;
    this.flinch = 0;
    this.attackTimer = 0;
    this.lastHitAt = -999;
    this.alertLevel = 0;              // 0..1 suspicion
    this.target = null;               // player reference when hostile
    this.lastKnownPos = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.wanderTarget = new THREE.Vector3();
    this.deathTimer = 0;
    this.corpse = false;
    this.looted = false;
    this.animPhase = Math.random() * 10;
    this.soundTimer = Math.random() * 8;
    this.active = true;
    this.lodLevel = 0;
    this._scratch = [];

    const factory = CREATURE_FACTORIES[cfg.model || type];
    this.model = factory ? factory() : new THREE.Group();
    this.parts = this.model.userData.parts || { legs: [], arms: [] };
    this.model.scale.setScalar(cfg.scale || 1);
    this.model.visible = false;
  }

  spawn(x, z, scene) {
    const y = this.game.world.terrain.heightAt(x, z);
    this.position.set(x, y, z);
    this.home.set(x, y, z);
    this.wanderTarget.set(x, y, z);
    this.model.position.copy(this.position);
    this.model.visible = true;
    this.alive = true;
    this.corpse = false;
    this.looted = false;
    this.health = this.maxHealth;
    this.state = STATE.IDLE;
    this.deathTimer = 0;
    this.model.rotation.set(0, 0, 0);
    if (!this.model.parent) scene.add(this.model);
  }

  despawn(scene) {
    if (this.model.parent) scene.remove(this.model);
    this.model.visible = false;
    this.active = false;
  }

  get eyePos() { return _e.set(this.position.x, this.position.y + this.headHeight, this.position.z); }

  distanceToPlayer() {
    const p = this.game.player.position;
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }

  /** True if the player is within the view cone and not occluded. */
  canSeePlayer(rangeMul = 1) {
    const p = this.game.player;
    const dx = p.position.x - this.position.x;
    const dz = p.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    let range = this.viewRange * rangeMul;
    // crouching in cover and standing still make the player much harder to see
    if (p.crouching) range *= 0.55;
    if (!p.moving) range *= 0.8;
    if (this.game.flashlight.on) range *= 1.9;
    if (dist > range) return false;
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const dot = (dx * fwdX + dz * fwdZ) / Math.max(0.001, dist);
    if (dot < Math.cos(this.fov)) return false;
    return this.game.world.hasLineOfSight(this.eyePos, p.eyePosition, dist);
  }

  hear(pos, level) {
    const d = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
    const effective = this.hearRange * (0.35 + level);
    if (d > effective) return false;
    const strength = (1 - d / effective) * level;
    if (strength <= 0.02) return false;
    this.onHeard(pos, strength);
    return true;
  }

  onHeard(pos, strength) {
    this.alertLevel = Math.min(1, this.alertLevel + strength * 0.8);
    this.lastKnownPos.set(pos.x, pos.y, pos.z);
    // Turn toward the sound. Without this a creature can be "alerted" while
    // still facing a tree, and its own view cone never finds you.
    if (strength > 0.05) {
      this.targetYaw = Math.atan2(-(pos.x - this.position.x), -(pos.z - this.position.z));
    }
  }

  /* ---------------- movement ---------------- */

  moveTowards(dt, tx, tz, speed, avoid = true) {
    let dx = tx - this.position.x, dz = tz - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return 0;
    dx /= d; dz /= d;

    // Avoidance fades out over the last few metres. A creature closing for a
    // kill shoulders through undergrowth instead of politely orbiting its
    // target, which is both how animals behave and the difference between an
    // attack landing and a creature circling forever just out of reach.
    const avoidStrength = avoid ? Math.min(1, Math.max(0, (d - 2.0) / 3.5)) : 0;
    if (avoidStrength > 0.01) {
      const cols = this.game.world.vegetation.queryColliders(this.position.x, this.position.z, this.radius + 2.4, this._scratch);
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const ox = this.position.x - c.x, oz = this.position.z - c.z;
        const od = Math.hypot(ox, oz);
        const want = c.r + this.radius + 0.9;
        if (od < want && od > 0.001) {
          const w = (want - od) / want;
          dx += (ox / od) * w * 1.9 * avoidStrength;
          dz += (oz / od) * w * 1.9 * avoidStrength;
        }
      }
      const n = Math.hypot(dx, dz);
      if (n > 0.001) { dx /= n; dz /= n; }
    }

    this.targetYaw = Math.atan2(-dx, -dz);
    this.position.x += dx * speed * dt;
    this.position.z += dz * speed * dt;
    return d;
  }

  /**
   * moveTowards with stuck detection.
   *
   * There is no navmesh: creatures steer locally, which means a wall or a
   * boulder between them and their target can hold them at a fixed distance
   * forever. When progress stalls, commit to a tangential detour for a couple
   * of seconds — enough to round a cabin corner and find the doorway.
   */
  steerTo(dt, tx, tz, speed) {
    const d = Math.hypot(tx - this.position.x, tz - this.position.z);
    if (this._bestProgress === undefined) this._bestProgress = d;
    // slowly re-baseline so a moving target does not read as being stuck
    this._bestProgress += dt * 0.6;
    if (d < this._bestProgress - 0.2) { this._bestProgress = d; this._stuckTimer = 0; }
    else this._stuckTimer = (this._stuckTimer || 0) + dt;

    // Only detour when there is somewhere to detour to. Inside 6 m the
    // creature commits: a detour at close range just becomes an orbit.
    if (this._stuckTimer > 1.1 && (this._detourTimer || 0) <= 0 && d > 6) {
      this._detourTimer = 1.6 + Math.random();
      this._detourSign = Math.random() < 0.5 ? -1 : 1;
      this._stuckTimer = 0;
    }
    if (d <= 6) this._detourTimer = 0;
    if (this._detourTimer > 0) {
      this._detourTimer -= dt;
      const dx = tx - this.position.x, dz = tz - this.position.z;
      const len = Math.hypot(dx, dz) || 1;
      // mostly sideways, slightly forward — sweeps along the obstruction
      tx = this.position.x + (-dz / len) * this._detourSign * 7 + (dx / len) * 2.5;
      tz = this.position.z + (dx / len) * this._detourSign * 7 + (dz / len) * 2.5;
    }
    return this.moveTowards(dt, tx, tz, speed);
  }

  resetSteering() { this._bestProgress = undefined; this._stuckTimer = 0; this._detourTimer = 0; }

  resolveCollision() {
    const cols = this.game.world.vegetation.queryColliders(this.position.x, this.position.z, this.radius + 1.0, this._scratch);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const dx = this.position.x - c.x, dz = this.position.z - c.z;
      const r = c.r + this.radius * 0.8;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      this.position.x += dx * push;
      this.position.z += dz * push;
    }
    const boxes = this.game.world.structureBoxes;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      if (bx.yTop <= this.position.y + 0.4) continue;
      if (bx.yBot >= this.position.y + this.height) continue;
      const dx = this.position.x - bx.x, dz = this.position.z - bx.z;
      const c = Math.cos(-bx.rot), s = Math.sin(-bx.rot);
      let lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = bx.hw + this.radius, ez = bx.hd + this.radius;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
      if (px < pz) lx += Math.sign(lx || 1) * px; else lz += Math.sign(lz || 1) * pz;
      const c2 = Math.cos(bx.rot), s2 = Math.sin(bx.rot);
      this.position.x = bx.x + (lx * c2 - lz * s2);
      this.position.z = bx.z + (lx * s2 + lz * c2);
    }
    const rc = Math.hypot(this.position.x, this.position.z);
    if (rc > 448) { this.position.x = this.position.x / rc * 448; this.position.z = this.position.z / rc * 448; }
  }

  applyPhysics(dt) {
    // knockback decays fast
    if (this.knockback.lengthSq() > 0.0001) {
      this.position.x += this.knockback.x * dt;
      this.position.z += this.knockback.z * dt;
      this.knockback.multiplyScalar(Math.pow(0.0015, dt));
    }
    this.resolveCollision();
    const ground = this.game.world.terrain.heightAt(this.position.x, this.position.z);
    this.position.y += (ground - this.position.y) * Math.min(1, dt * 12);
  }

  /* ---------------- animation ---------------- */

  animate(dt, moveSpeed) {
    const p = this.parts;
    this.animPhase += dt * (1.6 + moveSpeed * 1.5);
    const amp = Math.min(1, moveSpeed / Math.max(0.5, this.runSpeed)) * 0.9;
    if (p.legs) {
      for (let i = 0; i < p.legs.length; i++) {
        const ph = this.animPhase * 2.4 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI * 0.5 : 0);
        p.legs[i].rotation.x = Math.sin(ph) * 0.85 * amp;
      }
    }
    if (p.arms && p.arms.length) {
      for (let i = 0; i < p.arms.length; i++) {
        const ph = this.animPhase * 2.4 + (i ? 0 : Math.PI);
        const base = this.state === STATE.CHASE || this.state === STATE.ATTACK ? -0.9 : -0.1;
        p.arms[i].rotation.x = base + Math.sin(ph) * 0.6 * amp;
        p.arms[i].rotation.z = (i ? -1 : 1) * (0.12 + amp * 0.1);
      }
    }
    if (p.torso) {
      p.torso.rotation.z = Math.sin(this.animPhase * 2.4) * 0.05 * amp;
      p.torso.rotation.x = (this.state === STATE.CHASE ? 0.22 : 0.06) + Math.sin(this.animPhase * 4.8) * 0.02 * amp;
    }
    if (p.head) {
      p.head.rotation.y = Math.sin(this.animPhase * 0.7) * 0.18 * (1 - amp);
    }
    // Anything the shared animator cannot express — a maw opening, a lure
    // swinging, a ring of shards turning — is the model's own business.
    if (this.model.userData.tick) this.model.userData.tick(this.game.time, amp, this.state);

    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 3.4);
      this.model.position.x += (Math.random() - 0.5) * this.flinch * 0.09;
      this.model.position.z += (Math.random() - 0.5) * this.flinch * 0.09;
    }
    // face travel direction
    let d = this.targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 7);
    this.model.rotation.y = this.yaw;
    this.model.position.copy(this.position);
  }

  /* ---------------- damage & death ---------------- */

  die(dir, point) {
    this.alive = false;
    this.state = STATE.DEAD;
    this.corpse = true;
    this.deathTimer = 0;
    this.onDeath?.(dir, point);
    // topple: fall away from the shot direction
    this._fallAxis = Math.atan2(dir?.x || 0, dir?.z || 1);
    this._fallAmount = 0;
  }

  updateCorpse(dt) {
    this.deathTimer += dt;
    // Guard the topple values: an entity can be killed without going through
    // die() (level cleanup, scripted removal) and NaN in a matrix is contagious.
    if (!Number.isFinite(this._fallAxis)) this._fallAxis = 0;
    if (!Number.isFinite(this._fallAmount)) this._fallAmount = 0;
    this._fallAmount = Math.min(1, this._fallAmount + dt * 2.6);
    const t = this._fallAmount;
    const ease = 1 - Math.pow(1 - t, 3);
    this.model.rotation.set(
      Math.cos(this._fallAxis) * (Math.PI / 2) * ease,
      this.yaw,
      -Math.sin(this._fallAxis) * (Math.PI / 2) * ease
    );
    const ground = this.game.world.terrain.heightAt(this.position.x, this.position.z);
    this.position.y += (ground - this.position.y) * Math.min(1, dt * 8);
    this.model.position.copy(this.position);
    this.model.position.y += 0.05;
    // corpses linger, then sink away so the world does not fill with bodies
    if (this.deathTimer > 90) {
      const sink = (this.deathTimer - 90) * 0.25;
      this.model.position.y -= sink;
      if (sink > 2.5) return false;
    }
    return true;
  }
}

const _e = new THREE.Vector3();
