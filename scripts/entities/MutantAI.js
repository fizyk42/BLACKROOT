/**
 * MutantAI — four archetypes sharing one state machine but reading it very
 * differently.
 *
 *  Stalker  keeps trees between itself and you, watches, closes only when you
 *           look away, and turns vicious once it knows it has been seen.
 *  Brute    is slow, loud, enormously durable and charges in straight lines.
 *  Crawler  hugs the ground in undergrowth and ambushes from close range.
 *  Screamer avoids melee, and its call drags every mutant in earshot to you.
 *
 * States: IDLE PATROL INVESTIGATE STALK CHASE ATTACK FLEE DEAD
 */
import * as THREE from 'three';
import { Entity, STATE } from './Entity.js';
import { Audio } from '../core/AudioManager.js';

/**
 * Every mutant declares a `behaviour`, and the state machine branches on that
 * rather than on the type name. A biome can therefore introduce a creature
 * that looks nothing like anything else and still moves like something the
 * player has learnt to read — which is what makes a new biome frightening
 * rather than merely unfamiliar.
 */
export const MUTANT_CONFIG = {
  /* ---- the Hollow ---- */
  stalker: {
    faction: 'mutant', model: 'stalker', behaviour: 'stalk', biome: 'hollow',
    label: 'a Stalker',
    health: 105, radius: 0.45, height: 2.4, headHeight: 2.10,
    speed: 1.5, runSpeed: 6.6, damage: 17, attackRange: 2.35, attackCooldown: 1.25,
    viewRange: 46, fov: 1.15, hearRange: 58, armor: 0.0, mass: 1.0, scale: 1,
    lootTable: 'nest', noise: 0.35, lightShy: 0.55,
  },
  brute: {
    faction: 'mutant', model: 'brute', behaviour: 'charge', biome: 'hollow',
    label: 'a Brute',
    health: 340, radius: 0.85, height: 2.7, headHeight: 2.25,
    speed: 1.5, runSpeed: 4.6, damage: 41, attackRange: 2.9, attackCooldown: 2.1,
    viewRange: 38, fov: 1.0, hearRange: 62, armor: 0.30, mass: 3.2, scale: 1,
    lootTable: 'nest', noise: 1.0, lightShy: 0.0,
  },
  crawler: {
    faction: 'mutant', model: 'crawler', behaviour: 'swarm', biome: 'hollow',
    label: 'a Crawler',
    health: 58, radius: 0.42, height: 0.9, headHeight: 0.62,
    speed: 2.2, runSpeed: 8.2, damage: 13, attackRange: 1.8, attackCooldown: 0.85,
    viewRange: 26, fov: 1.5, hearRange: 40, armor: 0, mass: 0.7, scale: 1,
    lootTable: 'nest', noise: 0.25, lightShy: 0.25,
  },
  screamer: {
    faction: 'mutant', model: 'screamer', behaviour: 'call', biome: 'hollow',
    label: 'a Screamer',
    health: 72, radius: 0.42, height: 1.9, headHeight: 1.68,
    speed: 1.9, runSpeed: 5.4, damage: 9, attackRange: 1.9, attackCooldown: 1.6,
    viewRange: 52, fov: 1.35, hearRange: 70, armor: 0, mass: 0.8, scale: 1,
    lootTable: 'nest', noise: 0.6, lightShy: 0.75,
  },

  /* ---- the Void ---- */
  choir: {
    faction: 'mutant', model: 'choir', behaviour: 'call', biome: 'void',
    label: 'a Choir',
    health: 96, radius: 0.5, height: 2.2, headHeight: 1.95,
    speed: 2.4, runSpeed: 6.0, damage: 14, attackRange: 2.6, attackCooldown: 1.5,
    viewRange: 64, fov: 3.14, hearRange: 80, armor: 0.1, mass: 0.6, scale: 1,
    lootTable: 'nest', noise: 0.5, lightShy: 0.0, floats: true,
  },

  /* ---- the Abyss ---- */
  drowned: {
    faction: 'mutant', model: 'drowned', behaviour: 'charge', biome: 'abyss',
    label: 'a Drowned',
    health: 250, radius: 0.72, height: 2.2, headHeight: 1.86,
    speed: 1.3, runSpeed: 4.2, damage: 33, attackRange: 2.6, attackCooldown: 1.8,
    viewRange: 30, fov: 1.2, hearRange: 90, armor: 0.18, mass: 2.4, scale: 1,
    lootTable: 'nest', noise: 0.7, lightShy: 0.0,
  },

  /* ---- the Cinder ---- */
  ashwalker: {
    faction: 'mutant', model: 'ashwalker', behaviour: 'swarm', biome: 'cinder',
    label: 'an Ashwalker',
    health: 120, radius: 0.5, height: 2.2, headHeight: 1.92,
    speed: 2.4, runSpeed: 7.4, damage: 21, attackRange: 2.2, attackCooldown: 1.0,
    viewRange: 42, fov: 1.3, hearRange: 55, armor: 0.05, mass: 1.1, scale: 1,
    lootTable: 'nest', noise: 0.55, lightShy: 0.0, burns: true,
  },

  /* ---- the Permafrost ---- */
  rimewretch: {
    faction: 'mutant', model: 'rimewretch', behaviour: 'charge', biome: 'permafrost',
    label: 'a Rimewretch',
    health: 290, radius: 0.62, height: 2.3, headHeight: 1.98,
    speed: 1.1, runSpeed: 4.0, damage: 36, attackRange: 2.5, attackCooldown: 1.9,
    viewRange: 40, fov: 1.1, hearRange: 66, armor: 0.42, mass: 2.8, scale: 1,
    lootTable: 'nest', noise: 0.5, lightShy: 0.0, chills: true,
  },

  /* ---- the Bloom ---- */
  sporebearer: {
    faction: 'mutant', model: 'sporebearer', behaviour: 'stalk', biome: 'bloom',
    label: 'a Sporebearer',
    health: 140, radius: 0.52, height: 2.0, headHeight: 1.72,
    speed: 1.6, runSpeed: 5.2, damage: 15, attackRange: 2.2, attackCooldown: 1.3,
    viewRange: 34, fov: 1.25, hearRange: 62, armor: 0.08, mass: 1.3, scale: 1,
    lootTable: 'nest', noise: 0.4, lightShy: 0.2, sporeBurst: true,
  },
};

/** The mutants that belong to a biome, in spawn-weight order. */
export function mutantsForBiome(biomeId) {
  const own = Object.keys(MUTANT_CONFIG).filter((k) => MUTANT_CONFIG[k].biome === biomeId);
  const core = ['stalker', 'brute', 'crawler', 'screamer'];
  return biomeId === 'hollow' ? core : [...own, ...core];
}

export class Mutant extends Entity {
  constructor(game, type) {
    super(game, type, MUTANT_CONFIG[type]);
    const cfg = MUTANT_CONFIG[type];
    this.cfg = cfg;
    this.behaviour = cfg.behaviour || 'stalk';
    this.lightShy = cfg.lightShy;
    this.stalkDistance = 14 + Math.random() * 9;
    this.callTimer = 3 + Math.random() * 8;
    this.lostTimer = 0;
    this.chargeTimer = 0;
    this.hasBeenSeen = false;
    this.screamCooldown = 0;
    this.lungeTimer = 0;
    this.attackWindup = 0;
    this.pendingAttack = false;
  }

  onDamaged(dmg, dir, point, part, source) {
    this.alertLevel = 1;
    this.hasBeenSeen = true;
    this.lastKnownPos.copy(this.game.player.position);
    if (this.state !== STATE.ATTACK) {
      // Screamers break contact and call; everything else closes.
      this.state = (this.behaviour === 'call' && this.health < this.maxHealth * 0.5) ? STATE.FLEE : STATE.CHASE;
      this.stateTime = 0;
    }
    if (Math.random() < 0.5) Audio.mutantGrowl(this.type, this.position);
  }

  onDeath() {
    Audio.mutantDeath(this.type, this.position);
    this.game.fx.blood(this.eyePos, new THREE.Vector3(0, 1, 0), 30);
    if (this.behaviour === 'call') this.game.entities.alertNear(this.position, 20, this, 0.35);
    if (this.cfg.sporeBurst) this.burstSpores();
  }

  /* ---------------- brain ---------------- */

  think(dt, dist, playerVisible) {
    const p = this.game.player;
    this.stateTime += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.screamCooldown = Math.max(0, this.screamCooldown - dt);
    this.alertLevel = Math.max(0, this.alertLevel - dt * 0.045);

    // Being lit is loud, in its own way.
    const lit = this.game.flashlight.illuminates(this.eyePos);
    if (lit > 0.12 && dist < 40) {
      this.alertLevel = Math.min(1, this.alertLevel + dt * (0.8 + lit));
      if (this.lightShy > 0 && this.state === STATE.STALK && lit > 0.5) {
        // caught in the beam: stalkers commit, screamers recoil
        if (this.behaviour === 'call') { this.state = STATE.FLEE; this.stateTime = 0; }
        else if (!this.hasBeenSeen) { this.hasBeenSeen = true; this.state = STATE.CHASE; this.stateTime = 0; Audio.mutantGrowl(this.type, this.position); }
      }
    }

    // Proximity sense: at conversational range they know something is there
    // even without a clean sight line, unless you are still and crouched.
    if (dist < 6.5) {
      const stealth = p.crouching && !p.moving ? 0.25 : 1.0;
      this.alertLevel = Math.min(1, this.alertLevel + dt * 0.9 * stealth * (1 - dist / 6.5));
      if (this.alertLevel > 0.4) this.lastKnownPos.copy(p.position);
    }

    if (playerVisible) {
      this.lastKnownPos.copy(p.position);
      this.lostTimer = 0;
      this.alertLevel = Math.min(1, this.alertLevel + dt * 1.4);
    } else {
      this.lostTimer += dt;
    }

    switch (this.state) {
      case STATE.IDLE:
        // Idle mutants sweep their head around rather than staring at one spot,
        // so standing behind one is a temporary advantage, not a permanent one.
        if (this.alertLevel > 0.12) {
          this.targetYaw = Math.atan2(-(this.lastKnownPos.x - this.position.x), -(this.lastKnownPos.z - this.position.z));
        } else {
          this.targetYaw += Math.sin(this.game.time * 0.35 + this.id) * dt * 0.9;
        }
        if (this.stateTime > 2 + Math.random() * 4) { this.state = STATE.PATROL; this.stateTime = 0; this.pickWanderTarget(); }
        if (this.alertLevel > 0.30) { this.state = STATE.INVESTIGATE; this.stateTime = 0; }
        if (playerVisible && dist < this.viewRange) this.enterEngagement(dist);
        break;

      case STATE.PATROL: {
        const d = this.moveTowards(dt, this.wanderTarget.x, this.wanderTarget.z, this.speed);
        if (d < 2.2 || this.stateTime > 14) { this.state = STATE.IDLE; this.stateTime = 0; }
        if (this.alertLevel > 0.35) { this.state = STATE.INVESTIGATE; this.stateTime = 0; }
        if (playerVisible && dist < this.viewRange) this.enterEngagement(dist);
        break;
      }

      case STATE.INVESTIGATE: {
        const d = this.steerTo(dt, this.lastKnownPos.x, this.lastKnownPos.z, this.speed * 1.5);
        if (playerVisible) this.enterEngagement(dist);
        else if (d < 2.5 || this.stateTime > 12) {
          this.state = this.alertLevel > 0.6 ? STATE.STALK : STATE.IDLE;
          this.stateTime = 0;
        }
        break;
      }

      case STATE.STALK: this.stalkBehaviour(dt, dist, playerVisible); break;
      case STATE.CHASE: this.chaseBehaviour(dt, dist, playerVisible); break;
      case STATE.ATTACK: this.attackBehaviour(dt, dist); break;

      case STATE.FLEE: {
        const dx = this.position.x - p.position.x, dz = this.position.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        this.moveTowards(dt, this.position.x + dx / d * 12, this.position.z + dz / d * 12, this.runSpeed * 0.9);
        if (this.stateTime > 5 + Math.random() * 4 || dist > 45) {
          this.state = this.behaviour === 'call' ? STATE.STALK : STATE.INVESTIGATE;
          this.stateTime = 0;
        }
        break;
      }
      default: break;
    }

    // ambient vocalisations
    this.callTimer -= dt;
    if (this.callTimer <= 0) {
      this.callTimer = 7 + Math.random() * 16;
      if (dist < 75 && Math.random() < 0.55) Audio.mutantGrowl(this.type, this.position);
    }
  }

  enterEngagement(dist) {
    this.resetSteering();
    if (this.behaviour === 'charge' || this.hasBeenSeen || dist < 9) {
      this.state = STATE.CHASE;
      if (!this.hasBeenSeen) Audio.mutantGrowl(this.type, this.position);
      this.hasBeenSeen = true;
    } else {
      this.state = STATE.STALK;
    }
    this.stateTime = 0;
  }

  /** Keep distance, use cover, close when unobserved. */
  stalkBehaviour(dt, dist, visible) {
    const p = this.game.player;
    const lookingAtMe = this.playerFacingMe();
    const want = this.stalkDistance * (lookingAtMe ? 1.25 : 0.55);

    if (dist > want + 3) {
      // approach, preferring to hug tree cover
      const t = this.coverPointToward(p.position);
      this.moveTowards(dt, t.x, t.z, lookingAtMe ? this.speed * 1.1 : this.runSpeed * 0.55);
    } else if (dist < want - 3 && lookingAtMe) {
      const dx = this.position.x - p.position.x, dz = this.position.z - p.position.z;
      const d = Math.hypot(dx, dz) || 1;
      this.moveTowards(dt, this.position.x + dx / d * 6, this.position.z + dz / d * 6, this.speed * 1.6);
    } else {
      // hold still and watch — the most unnerving thing it can do
      this.targetYaw = Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z));
    }

    if (this.behaviour === 'call' && visible && this.screamCooldown <= 0 && dist < 42) {
      this.scream();
    }
    if (dist < 7 && !lookingAtMe) { this.state = STATE.CHASE; this.stateTime = 0; this.hasBeenSeen = true; Audio.mutantGrowl(this.type, this.position); }
    if (this.stateTime > 26 && this.alertLevel > 0.75) { this.state = STATE.CHASE; this.stateTime = 0; this.hasBeenSeen = true; }
    if (this.lostTimer > 18 && this.alertLevel < 0.4) { this.state = STATE.INVESTIGATE; this.stateTime = 0; }
  }

  chaseBehaviour(dt, dist, visible) {
    const p = this.game.player;
    const tx = visible ? p.position.x : this.lastKnownPos.x;
    const tz = visible ? p.position.z : this.lastKnownPos.z;

    if (this.behaviour === 'charge') {
      this.chargeTimer -= dt;
      const charging = this.chargeTimer > 0;
      if (!charging && dist > 8 && dist < 26 && Math.random() < dt * 0.5) {
        this.chargeTimer = 2.4;
        Audio.mutantGrowl('brute', this.position);
      }
      this.steerTo(dt, tx, tz, charging ? this.runSpeed * 1.6 : this.runSpeed);
    } else if (this.behaviour === 'swarm') {
      // erratic weaving approach
      const wob = Math.sin(this.game.time * 5 + this.id) * 4.5 * Math.min(1, dist / 12);
      this.steerTo(dt, tx + wob * Math.cos(this.yaw), tz + wob * Math.sin(this.yaw), this.runSpeed);
    } else if (this.behaviour === 'call') {
      if (dist < 9) {
        const dx = this.position.x - p.position.x, dz = this.position.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        this.moveTowards(dt, this.position.x + dx / d * 8, this.position.z + dz / d * 8, this.runSpeed);
      } else this.steerTo(dt, tx, tz, this.speed * 1.6);
      if (this.screamCooldown <= 0 && dist < 46) this.scream();
    } else {
      this.steerTo(dt, tx, tz, this.runSpeed);
    }

    if (dist <= this.attackRange && visible) {
      this.state = STATE.ATTACK; this.stateTime = 0; this.attackWindup = this.behaviour === 'charge' ? 0.55 : 0.25;
      this.pendingAttack = true;
    }
    if (!visible && this.lostTimer > 9) {
      const d = Math.hypot(this.lastKnownPos.x - this.position.x, this.lastKnownPos.z - this.position.z);
      if (d < 3) { this.state = STATE.STALK; this.stateTime = 0; }
    }
    if (this.lostTimer > 26) { this.state = STATE.INVESTIGATE; this.stateTime = 0; }
  }

  attackBehaviour(dt, dist) {
    const p = this.game.player;
    this.targetYaw = Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z));
    if (this.attackWindup > 0) {
      this.attackWindup -= dt;
      // small lunge into the swing
      if (dist > this.attackRange * 0.55) this.moveTowards(dt, p.position.x, p.position.z, this.runSpeed * 0.5);
      if (this.attackWindup <= 0 && this.pendingAttack) {
        this.pendingAttack = false;
        this.executeAttack(dist);
      }
      return;
    }
    if (this.attackTimer <= 0) {
      if (dist <= this.attackRange + 0.4) {
        this.attackWindup = this.behaviour === 'charge' ? 0.55 : 0.25;
        this.pendingAttack = true;
        this.attackTimer = this.attackCooldown;
      } else { this.state = STATE.CHASE; this.stateTime = 0; }
    }
    if (dist > this.attackRange * 2.0) { this.state = STATE.CHASE; this.stateTime = 0; }
  }

  executeAttack(dist) {
    const p = this.game.player;
    const d = this.distanceToPlayer();
    Audio.mutantAttack(this.position);
    this.lungeTimer = 0.25;
    if (d <= this.attackRange + 0.65) {
      const dir = new THREE.Vector3(p.position.x - this.position.x, 0, p.position.z - this.position.z).normalize();
      this.game.damage.applyToPlayer(this.damage, this.displayName(), {
        bleed: this.behaviour === 'charge' ? 0.55 : 0.3, dir,
      });
      // heavies shove you
      if (this.behaviour === 'charge') {
        p.velocity.x += dir.x * 7.5;
        p.velocity.z += dir.z * 7.5;
        p.velocity.y += 2.2;
      }
    }
  }

  scream() {
    this.screamCooldown = 12 + Math.random() * 8;
    Audio.mutantScream(this.position);
    this.game.entities.alertNear(this.position, 95, this, 1.0, this.game.player.position);
    this.game.ui.subtitle('A call goes up somewhere close — and something answers.');
    this.game.director?.onScream(this.position);
  }

  playerFacingMe() {
    const p = this.game.player;
    const dx = this.position.x - p.position.x, dz = this.position.z - p.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const f = p.forward;
    return (dx / d * f.x + dz / d * f.z) > 0.55;
  }

  /** Pick an approach point that keeps a tree roughly between us and the player. */
  coverPointToward(target) {
    const cols = this.game.world.vegetation.queryColliders(this.position.x, this.position.z, 14, this._scratch);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.type !== 'tree' || c.r < 0.4) continue;
      const dToTarget = Math.hypot(c.x - target.x, c.z - target.z);
      const dToMe = Math.hypot(c.x - this.position.x, c.z - this.position.z);
      if (dToTarget > 30 || dToMe > 16) continue;
      const score = -dToTarget * 1.0 - dToMe * 0.4;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return target;
    // stand on the far side of the trunk from the player
    const ux = (best.x - target.x), uz = (best.z - target.z);
    const ul = Math.hypot(ux, uz) || 1;
    return { x: best.x + ux / ul * (best.r + 0.6), z: best.z + uz / ul * (best.r + 0.6) };
  }

  pickWanderTarget() {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 26;
    const x = this.home.x + Math.cos(a) * r;
    const z = this.home.z + Math.sin(a) * r;
    if (Math.hypot(x, z) < 440 && !this.game.world.terrain.isWater(x, z)) this.wanderTarget.set(x, 0, z);
  }

  displayName() { return this.cfg.label || 'a mutant'; }

  /** A Sporebearer's death is its most dangerous moment. */
  burstSpores() {
    const p = this.game.player;
    const d = this.distanceToPlayer();
    this.game.fx?.blood(this.eyePos, new THREE.Vector3(0, 1, 0), 40);
    if (d < 4.5) {
      this.game.damage.applyToPlayer(14 * (1 - d / 4.5), 'a Sporebearer\u2019s burst', { bleed: 0 });
      this.game.ui.toast('Spores — hold your breath and move', 'bad');
    }
    this.game.entities.alertNear(this.position, 26, this, 0.5);
  }

  update(dt, dist, lod) {
    if (!this.alive) return;
    const visible = lod === 0 ? this.canSeePlayer() : (dist < this.viewRange * 0.7 && this.alertLevel > 0.5);
    this.think(dt, dist, visible);
    this.applyPhysics(dt);
    const moveSpeed = this.state === STATE.CHASE ? this.runSpeed : this.state === STATE.PATROL || this.state === STATE.INVESTIGATE ? this.speed : 0.2;
    this.animate(dt, moveSpeed);
    if (this.lungeTimer > 0) {
      this.lungeTimer -= dt;
      const t = Math.max(0, this.lungeTimer / 0.25);
      if (this.parts.arms) for (const a of this.parts.arms) a.rotation.x = -2.2 * t;
    }
    if (this.parts.jaw && !this.model.userData.tick) {
      const open = this.screamCooldown > 10.5 ? 1 : 0;
      this.parts.jaw.rotation.x = open * 0.6;
    }
    // Floaters never touch the ground; animate() has just written the model
    // back onto the terrain, so the lift is applied after it.
    if (this.cfg.floats) {
      this.model.position.y = this.position.y + 0.42 + Math.sin(this.game.time * 0.8 + this.id) * 0.10;
    }
  }
}
