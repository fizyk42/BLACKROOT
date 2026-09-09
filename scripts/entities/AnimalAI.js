/**
 * AnimalAI — wildlife that behaves like wildlife, not like slower mutants.
 *
 *  rabbit  bolts at almost anything, never fights
 *  deer    grazes, watches, flees in long arcs
 *  boar    ignores you until crowded, then charges, then disengages
 *  wolf    stalks in packs, circles, darts in and out, howls to gather
 *  bear    rare, territorial, slow to anger and catastrophic once angry
 */
import * as THREE from 'three';
import { Entity, STATE } from './Entity.js';
import { Audio } from '../core/AudioManager.js';

export const ANIMAL_CONFIG = {
  rabbit: {
    faction: 'animal', model: 'rabbit', health: 8, radius: 0.18, height: 0.34, headHeight: 0.3,
    speed: 1.2, runSpeed: 8.5, damage: 0, attackRange: 0, viewRange: 26, fov: 2.4, hearRange: 34,
    mass: 0.2, temperament: 'skittish', fleeRange: 18, lootTable: null, scale: 1,
  },
  deer: {
    faction: 'animal', model: 'deer', health: 55, radius: 0.5, height: 1.6, headHeight: 1.5,
    speed: 1.5, runSpeed: 9.5, damage: 0, attackRange: 0, viewRange: 42, fov: 2.2, hearRange: 55,
    mass: 1.4, temperament: 'skittish', fleeRange: 26, lootTable: null, scale: 1,
  },
  boar: {
    faction: 'animal', model: 'boar', health: 95, radius: 0.55, height: 1.0, headHeight: 0.9,
    speed: 1.4, runSpeed: 8.0, damage: 22, attackRange: 1.9, attackCooldown: 1.9,
    viewRange: 22, fov: 1.8, hearRange: 32, mass: 1.8, temperament: 'defensive',
    fleeRange: 0, aggroRange: 11, lootTable: null, scale: 1,
  },
  wolf: {
    faction: 'animal', model: 'wolf', health: 62, radius: 0.42, height: 1.05, headHeight: 0.95,
    speed: 2.2, runSpeed: 9.2, damage: 15, attackRange: 1.9, attackCooldown: 1.15,
    viewRange: 46, fov: 1.7, hearRange: 60, mass: 0.9, temperament: 'predator',
    aggroRange: 34, lootTable: null, scale: 1,
  },
  bear: {
    faction: 'animal', model: 'bear', health: 300, radius: 0.85, height: 1.7, headHeight: 1.45,
    speed: 1.5, runSpeed: 8.4, damage: 48, attackRange: 2.5, attackCooldown: 1.9,
    viewRange: 30, fov: 1.5, hearRange: 44, mass: 3.4, temperament: 'territorial',
    aggroRange: 16, armor: 0.15, lootTable: null, scale: 1,
  },
};

export class Animal extends Entity {
  constructor(game, type) {
    super(game, type, ANIMAL_CONFIG[type]);
    const cfg = ANIMAL_CONFIG[type];
    this.temperament = cfg.temperament;
    this.fleeRange = cfg.fleeRange || 0;
    this.aggroRange = cfg.aggroRange || 0;
    this.aggro = 0;
    this.packId = 0;
    this.circleDir = Math.random() < 0.5 ? 1 : -1;
    this.callTimer = Math.random() * 25;
    this.grazeTimer = 0;
    this.state = STATE.GRAZE;
    this.attackWindup = 0;
    this.pendingAttack = false;
  }

  onDamaged(dmg, dir, point, part, source) {
    this.alertLevel = 1;
    this.lastKnownPos.copy(this.game.player.position);
    if (this.temperament === 'skittish') { this.state = STATE.FLEE; this.stateTime = 0; }
    else { this.aggro = 1; this.state = STATE.CHASE; this.stateTime = 0; }
    if (this.type === 'wolf') {
      Audio.animal('wolfBark', this.position);
      this.game.entities.alertPack(this, 40);
    } else if (this.type === 'bear') Audio.animal('bearRoar', this.position);
    else if (this.type === 'boar') Audio.animal('boarSnort', this.position);
  }

  onDeath() {
    Audio.animal('death', this.position);
    this.game.fx.blood(this.eyePos, new THREE.Vector3(0, 1, 0), 24);
  }

  think(dt, dist, visible) {
    const p = this.game.player;
    this.stateTime += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.aggro = Math.max(0, this.aggro - dt * 0.05);

    // being lit by the flashlight startles prey and provokes predators
    const lit = this.game.flashlight.illuminates(this.eyePos);
    if (lit > 0.3 && dist < 30) this.alertLevel = Math.min(1, this.alertLevel + dt * 1.2);

    const threatened = visible || this.alertLevel > 0.6;

    switch (this.temperament) {
      case 'skittish':
        if (threatened && dist < this.fleeRange) { this.state = STATE.FLEE; this.stateTime = 0; }
        break;
      case 'defensive':
        if (threatened && dist < this.aggroRange) this.aggro = Math.min(1, this.aggro + dt * 0.9);
        if (this.aggro > 0.6 && this.state !== STATE.CHASE && this.state !== STATE.ATTACK) {
          this.state = STATE.CHASE; this.stateTime = 0;
          Audio.animal('boarSnort', this.position);
        }
        break;
      case 'predator':
        if (threatened && dist < this.aggroRange) this.aggro = Math.min(1, this.aggro + dt * 0.5);
        if (this.aggro > 0.45 && this.state !== STATE.ATTACK) {
          if (this.state !== STATE.CHASE && this.state !== STATE.STALK) { this.state = STATE.STALK; this.stateTime = 0; }
        }
        break;
      case 'territorial':
        if (threatened && dist < this.aggroRange) this.aggro = Math.min(1, this.aggro + dt * 0.55);
        if (this.aggro > 0.75 && this.state !== STATE.CHASE && this.state !== STATE.ATTACK) {
          this.state = STATE.CHASE; this.stateTime = 0;
          Audio.animal('bearRoar', this.position);
        }
        break;
      default: break;
    }

    switch (this.state) {
      case STATE.GRAZE:
      case STATE.IDLE: {
        this.grazeTimer -= dt;
        if (this.grazeTimer <= 0) {
          this.grazeTimer = 3 + Math.random() * 7;
          this.pickWanderTarget(this.type === 'wolf' ? 34 : 18);
          this.state = STATE.PATROL; this.stateTime = 0;
        }
        if (this.parts.neck) this.parts.neck.rotation.x = 0.55 + Math.sin(this.game.time * 0.6 + this.id) * 0.12;
        break;
      }
      case STATE.PATROL: {
        const d = this.moveTowards(dt, this.wanderTarget.x, this.wanderTarget.z, this.speed);
        if (this.parts.neck) this.parts.neck.rotation.x *= 0.9;
        if (d < 2 || this.stateTime > 12) { this.state = STATE.GRAZE; this.stateTime = 0; this.grazeTimer = 2 + Math.random() * 6; }
        break;
      }
      case STATE.FLEE: {
        const dx = this.position.x - p.position.x, dz = this.position.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        // flee in a slight arc rather than a straight line
        const ax = dx / d, az = dz / d;
        const cx = -az * 0.35 * this.circleDir, cz = ax * 0.35 * this.circleDir;
        this.moveTowards(dt, this.position.x + (ax + cx) * 14, this.position.z + (az + cz) * 14, this.runSpeed);
        if ((dist > this.fleeRange * 2.2 && this.stateTime > 2.5) || this.stateTime > 9) {
          this.state = STATE.GRAZE; this.stateTime = 0; this.alertLevel = 0.2;
        }
        break;
      }
      case STATE.STALK: {
        // wolves circle at a distance, waiting for the pack
        const want = 11;
        const dx = p.position.x - this.position.x, dz = p.position.z - this.position.z;
        const d = Math.hypot(dx, dz) || 1;
        const px = -dz / d, pz = dx / d;
        const tx = p.position.x - (dx / d) * want + px * 6 * this.circleDir;
        const tz = p.position.z - (dz / d) * want + pz * 6 * this.circleDir;
        this.moveTowards(dt, tx, tz, this.speed * 2.2);
        if (Math.random() < dt * 0.25) this.circleDir *= -1;
        if (this.stateTime > 4 + Math.random() * 5 && this.aggro > 0.55) { this.state = STATE.CHASE; this.stateTime = 0; Audio.animal('wolfGrowl', this.position); }
        if (dist > 55) { this.state = STATE.GRAZE; this.stateTime = 0; this.aggro *= 0.4; }
        break;
      }
      case STATE.CHASE: {
        this.steerTo(dt, p.position.x, p.position.z, this.runSpeed);
        if (dist <= this.attackRange) { this.state = STATE.ATTACK; this.stateTime = 0; this.attackWindup = 0.22; this.pendingAttack = true; }
        if (this.type === 'wolf' && this.stateTime > 5) { this.state = STATE.STALK; this.stateTime = 0; }
        if (this.stateTime > 16 || dist > 62) { this.state = STATE.GRAZE; this.stateTime = 0; this.aggro *= 0.5; }
        break;
      }
      case STATE.ATTACK: {
        this.targetYaw = Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z));
        if (this.attackWindup > 0) {
          this.attackWindup -= dt;
          if (this.attackWindup <= 0 && this.pendingAttack) { this.pendingAttack = false; this.executeAttack(); }
        } else if (this.attackTimer <= 0) {
          if (dist <= this.attackRange + 0.4) { this.attackWindup = 0.22; this.pendingAttack = true; this.attackTimer = this.attackCooldown; }
          else { this.state = STATE.CHASE; this.stateTime = 0; }
        }
        if (dist > this.attackRange * 2.2) { this.state = this.type === 'wolf' ? STATE.STALK : STATE.CHASE; this.stateTime = 0; }
        // boars disengage after a successful charge
        if (this.type === 'boar' && this.stateTime > 3.5) { this.state = STATE.FLEE; this.stateTime = 0; this.aggro = 0.2; this.fleeRange = 14; }
        break;
      }
      default: break;
    }

    // ambient calls
    this.callTimer -= dt;
    if (this.callTimer <= 0) {
      this.callTimer = 18 + Math.random() * 40;
      if (dist < 140) {
        if (this.type === 'wolf' && Math.random() < 0.5) { Audio.animal('wolfHowl', this.position); this.game.entities.alertPack(this, 60); }
        else if (this.type === 'deer' && Math.random() < 0.3) Audio.animal('deerCall', this.position);
        else if (this.type === 'boar' && Math.random() < 0.3) Audio.animal('boarSnort', this.position);
      }
    }
  }

  executeAttack() {
    const p = this.game.player;
    const d = this.distanceToPlayer();
    if (d <= this.attackRange + 0.6) {
      const dir = new THREE.Vector3(p.position.x - this.position.x, 0, p.position.z - this.position.z).normalize();
      this.game.damage.applyToPlayer(this.damage, this.displayName(), { bleed: this.type === 'bear' ? 0.6 : 0.35, dir });
      if (this.type === 'bear' || this.type === 'boar') {
        p.velocity.x += dir.x * 6.5; p.velocity.z += dir.z * 6.5; p.velocity.y += 1.8;
      }
      Audio.animal(this.type === 'wolf' ? 'wolfBark' : this.type === 'bear' ? 'bearRoar' : 'boarSnort', this.position);
    }
  }

  pickWanderTarget(radius) {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * radius;
    const x = this.home.x + Math.cos(a) * r;
    const z = this.home.z + Math.sin(a) * r;
    const T = this.game.world.terrain;
    if (Math.hypot(x, z) < 435 && !T.isWater(x, z) && T.slopeAt(x, z) < 0.55) this.wanderTarget.set(x, 0, z);
    else this.wanderTarget.copy(this.home);
  }

  displayName() {
    return { rabbit: 'a rabbit', deer: 'a deer', boar: 'a boar', wolf: 'a wolf', bear: 'a bear' }[this.type] || 'an animal';
  }

  update(dt, dist, lod) {
    if (!this.alive) return;
    const visible = lod === 0 ? this.canSeePlayer() : dist < this.viewRange * 0.6;
    this.think(dt, dist, visible);
    this.applyPhysics(dt);
    const moving = this.state === STATE.FLEE || this.state === STATE.CHASE ? this.runSpeed
      : this.state === STATE.PATROL || this.state === STATE.STALK ? this.speed * 1.5 : 0.15;
    this.animate(dt, moving);
    if (this.model.userData.tail) {
      this.model.userData.tail.rotation.z = Math.sin(this.animPhase * 3) * 0.25;
    }
  }
}
