/**
 * PlayerStats — health, stamina, hunger, thirst, bleeding, poison and timed
 * effects. Single source of truth for "how the body is doing"; the damage
 * system, HUD and death screen all read from here.
 */
import { Audio } from '../core/AudioManager.js';

export class PlayerStats {
  constructor(difficulty) {
    this.reset(difficulty);
  }

  reset(difficulty) {
    this.diff = difficulty;
    this.maxHealth = 100;
    this.health = 100;
    this.maxStamina = 100;
    this.stamina = 100;
    this.hunger = 100;      // 100 = full
    this.thirst = 100;
    this.bleeding = 0;      // stacks; each drains hp/s
    this.poison = 0;
    this.dead = false;
    this.causeOfDeath = '';
    this.effects = [];      // {type, remaining, ...}
    this.staminaLock = 0;   // seconds before regen resumes
    this._graceUntil = 0;   // brief immunity after a hit; see damage()
    this.lastDamageAt = -999;
    this.damageResist = 0;
    this.kills = 0;
    this.distance = 0;
    this.timeAlive = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.itemsLooted = 0;
    this.landmarksFound = 0;
    this._painTimer = 0;
    this._hbTimer = 0;
  }

  get healthPct() { return this.health / this.maxHealth; }
  get staminaPct() { return this.stamina / this.maxStamina; }
  get hungerPct() { return this.hunger / 100; }
  get thirstPct() { return this.thirst / 100; }

  /** Exhausted players cannot sprint or swing heavy weapons. */
  get exhausted() { return this.stamina < 6; }

  addEffect(type, duration, data = {}) {
    const existing = this.effects.find((e) => e.type === type);
    if (existing) { existing.remaining = Math.max(existing.remaining, duration); Object.assign(existing, data); }
    else this.effects.push({ type, remaining: duration, ...data });
  }
  hasEffect(type) { return this.effects.some((e) => e.type === type); }
  removeEffect(type) { this.effects = this.effects.filter((e) => e.type !== type); }

  damage(amount, source = 'unknown', opts = {}) {
    if (this.dead) return 0;
    // A recovery window after being hit. Without one, two creatures that
    // reach you at the same time take turns removing a third of your health
    // with nothing you can do about it, and dying to that feels like the game
    // cheating rather than like a mistake you made. Environmental damage —
    // bleeding, falls, drowning — ignores it, because there is nothing to
    // recover from.
    const grace = this.diff.iFrames ?? 0;
    if (grace > 0 && !opts.ignoreGrace && this._graceUntil > this.timeAlive) return 0;

    let dmg = amount * this.diff.dmgTaken;
    if (this.damageResist > 0) dmg *= (1 - this.damageResist);
    if (this.hasEffect('painkillers')) dmg *= 0.72;
    if (grace > 0 && !opts.ignoreGrace) this._graceUntil = this.timeAlive + grace;
    this.health -= dmg;
    this.lastDamageAt = this.timeAlive;
    this.staminaLock = Math.max(this.staminaLock, 0.6);
    if (opts.bleed && Math.random() < opts.bleed * (this.diff.bleedMul ?? 1)) {
      this.bleeding = Math.min(4, this.bleeding + 1);
    }
    if (opts.poison) this.poison = Math.min(3, this.poison + 1);
    Audio.hurt(Math.min(1, dmg / 40));
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.causeOfDeath = source;
    }
    return dmg;
  }

  heal(amount) {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  useStamina(amount) {
    this.stamina = Math.max(0, this.stamina - amount);
    this.staminaLock = Math.max(this.staminaLock, 0.45);
  }

  eat(item) {
    if (item.hunger) this.hunger = Math.max(0, Math.min(100, this.hunger + item.hunger));
    if (item.thirst) this.thirst = Math.max(0, Math.min(100, this.thirst + item.thirst));
    if (item.health) this.heal(item.health);
    if (item.healOverTime) this.addEffect('regen', item.healDuration || 10, { rate: item.healOverTime / (item.healDuration || 10) });
    if (item.stopsBleed) this.bleeding = 0;
    if (item.curePoison) this.poison = 0;
    if (item.damageResist) {
      this.addEffect('painkillers', item.resistDuration || 30);
      this.damageResist = item.damageResist;
    }
    if (item.staminaBoost) this.addEffect('stamboost', item.resistDuration || 30, { mul: 1 + item.staminaBoost });
  }

  update(dt, ctx) {
    if (this.dead) return;
    this.timeAlive += dt;
    const d = this.diff;

    // --- hunger & thirst ---
    this.hunger = Math.max(0, this.hunger - dt * 0.20 * d.hungerRate * (ctx.sprinting ? 1.7 : 1));
    if (ctx.thirstEnabled) {
      this.thirst = Math.max(0, this.thirst - dt * 0.28 * d.thirstRate * (ctx.sprinting ? 1.8 : 1));
    }

    // --- stamina ---
    this.staminaLock = Math.max(0, this.staminaLock - dt);
    if (this.staminaLock <= 0) {
      let regen = 15.5;
      if (this.hunger < 25) regen *= 0.45;
      else if (this.hunger < 50) regen *= 0.72;
      if (this.thirst < 25) regen *= 0.55;
      if (ctx.crouching && !ctx.moving) regen *= 1.5;
      if (ctx.overloaded) regen *= 0.6;
      const boost = this.effects.find((e) => e.type === 'stamboost');
      if (boost) regen *= boost.mul;
      this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
    }

    // --- damage over time ---
    // Out-of-combat healing. This is the single biggest thing standing between
    // "difficult" and "punishing": without it every scratch is permanent until
    // you find a bandage, and a run is decided by the first bad thirty seconds.
    const regen = this.diff.regen || 0;
    const quiet = this.timeAlive - this.lastDamageAt;
    if (regen > 0 && !this.dead && this.bleeding <= 0 && this.poison <= 0
        && quiet > (this.diff.regenDelay ?? 6)) {
      const cap = this.maxHealth * (this.diff.regenCap ?? 0.7);
      if (this.health < cap) {
        // Slower when you are starving or parched: food and water still matter,
        // they just are not a second health bar you can die to by accident.
        let rate = regen;
        if (this.hunger < 25 || this.thirst < 25) rate *= 0.45;
        this.health = Math.min(cap, this.health + rate * dt);
      }
    }

    if (this.bleeding > 0) {
      this.health -= this.bleeding * 0.85 * dt;
      this._painTimer -= dt;
      if (this._painTimer <= 0) { this._painTimer = 3.5; Audio.breath(0.6); }
    }
    if (this.poison > 0) {
      this.health -= this.poison * 0.5 * dt;
      this.stamina = Math.max(0, this.stamina - this.poison * 1.4 * dt);
    }
    if (this.hunger <= 0) this.health -= 0.55 * dt;
    if (this.thirst <= 0 && ctx.thirstEnabled) this.health -= 0.9 * dt;

    // --- regeneration ---
    const regenFx = this.effects.find((e) => e.type === 'regen');
    if (regenFx) this.heal(regenFx.rate * dt);
    // Above the difficulty's regen cap the fast recovery stops and this slow
    // trickle takes over — well fed, watered, and left alone for a good while.
    // So a fight costs you a few seconds of standing still, and the last
    // sliver costs you either a bandage or a long quiet walk.
    if (this.hunger > 60 && this.thirst > 45 && this.bleeding === 0 &&
        this.timeAlive - this.lastDamageAt > 22 && this.health < this.maxHealth) {
      this.heal(0.55 * dt);
    }

    // --- effect timers ---
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.remaining -= dt;
      if (e.remaining <= 0) {
        if (e.type === 'painkillers') this.damageResist = 0;
        this.effects.splice(i, 1);
      }
    }

    // --- heartbeat when critical ---
    if (this.health < 28) {
      this._hbTimer -= dt;
      if (this._hbTimer <= 0) {
        this._hbTimer = 0.55 + (this.health / 28) * 0.5;
        Audio.heartbeat();
      }
    }

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (!this.causeOfDeath) {
        this.causeOfDeath = this.bleeding > 0 ? 'blood loss'
          : this.thirst <= 0 ? 'dehydration'
          : this.hunger <= 0 ? 'starvation' : 'your injuries';
      }
    }
  }

  serialize() {
    return {
      health: this.health, stamina: this.stamina, hunger: this.hunger, thirst: this.thirst,
      bleeding: this.bleeding, poison: this.poison, kills: this.kills, distance: this.distance,
      timeAlive: this.timeAlive, itemsLooted: this.itemsLooted, landmarksFound: this.landmarksFound,
      shotsFired: this.shotsFired, shotsHit: this.shotsHit,
    };
  }
  deserialize(d) { if (d) Object.assign(this, d); this.dead = false; this.effects = []; this.damageResist = 0; }
}
