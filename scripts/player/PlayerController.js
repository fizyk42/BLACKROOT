/**
 * PlayerController — grounded first-person movement.
 *
 * Deliberately not a floating camera: acceleration and friction are separate,
 * air control is limited, the head bobs and settles, landings compress the
 * camera, and every step queries the terrain for a surface material.
 *
 * Collision is 2D-cylinder vs (tree cylinders + structure OBBs) with vertical
 * support from either the heightfield or the top face of a structure box, so
 * the player can walk into cabins and stand on decks.
 */
import * as THREE from 'three';
import { Input } from '../core/Input.js';
import { Settings } from '../core/Settings.js';
import { Audio } from '../core/AudioManager.js';

const STAND_H = 1.80;
const CROUCH_H = 1.15;
const RADIUS = 0.36;
const STEP_H = 0.55;

const SPEED = { walk: 3.5, sprint: 6.4, crouch: 1.65, swim: 1.9 };
const ACCEL = { ground: 13, air: 2.6 };   // blend rate per second toward target velocity
const FRICTION = 11.5;
const GRAVITY = 22.0;
const JUMP_V = 6.4;

export class PlayerController {
  constructor(camera, world, stats) {
    this.camera = camera;
    this.world = world;
    this.stats = stats;

    this.position = new THREE.Vector3(0, 0, 0);   // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = STAND_H;
    this.targetHeight = STAND_H;
    this.grounded = true;
    this.crouching = false;
    this.sprinting = false;
    this.moving = false;
    this.inWater = false;
    this.waterDepth = 0;
    /**
     * Biome physics. The Long Dark has a third of the gravity; the Drowned
     * Shelf has almost none and a great deal of drag. Set once per run by the
     * GameManager from the biome descriptor.
     */
    this.env = { gravity: 1, drag: 1, moveMul: 1, jumpMul: 1, freeSwim: false, slip: 0 };
    this.surface = 'dirt';

    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.landDipVel = 0;
    this.viewRoll = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVel = 0;
    this.recoilYawVel = 0;
    this.breathPhase = 0;

    this.noise = 0;             // 0..1 loudness the AI can hear this frame
    this.noiseDecay = 0;
    this._stepDist = 0;
    this._lastGroundY = 0;
    this._fallStartY = 0;
    this._wasGrounded = true;
    this._jumpCooldown = 0;
    this._sprintToggle = false;
    this._crouchToggle = false;
    this._colliderScratch = [];
  }

  spawn(x, z) {
    const y = this.world.terrain.heightAt(x, z);
    this.position.set(x, y + 0.2, z);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.height = this.targetHeight = STAND_H;
    this.crouching = false;
    this._fallStartY = y;
  }

  get eyePosition() {
    return _eye.set(this.position.x, this.position.y + this.height - 0.16 - this.landDip, this.position.z);
  }

  get forward() {
    return _fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  /* ---------------- collision helpers ---------------- */

  /** Highest walkable surface under the player at (x,z), including structures. */
  groundHeightAt(x, z, feetY) {
    let best = this.world.terrain.heightAt(x, z);
    const boxes = this.world.structureBoxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.yTop > feetY + STEP_H + 0.05) continue;
      if (b.yTop < best) continue;
      if (this._insideBox(b, x, z, RADIUS * 0.55)) best = b.yTop;
    }
    return best;
  }

  _insideBox(b, x, z, pad) {
    const dx = x - b.x, dz = z - b.z;
    const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) <= b.hw + pad && Math.abs(lz) <= b.hd + pad;
  }

  /** Push the player out of trees, rocks and structure walls. */
  resolveCollisions(feetY) {
    const p = this.position;
    const cols = this.world.vegetation.queryColliders(p.x, p.z, RADIUS + 1.2, this._colliderScratch);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const dx = p.x - c.x, dz = p.z - c.z;
      const r = c.r + RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      p.x += dx * push; p.z += dz * push;
    }

    const boxes = this.world.structureBoxes;
    const headY = feetY + this.height;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      // vertical overlap test: ignore boxes we are standing on or that are above our head
      if (b.yTop <= feetY + STEP_H + 0.02) continue;
      if (b.yBot >= headY - 0.05) continue;
      const dx = p.x - b.x, dz = p.z - b.z;
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      let lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = b.hw + RADIUS, ez = b.hd + RADIUS;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      // push out along the shallowest axis
      const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
      if (px < pz) lx += Math.sign(lx || 1) * px;
      else lz += Math.sign(lz || 1) * pz;
      const c2 = Math.cos(b.rot), s2 = Math.sin(b.rot);
      p.x = b.x + (lx * c2 - lz * s2);
      p.z = b.z + (lx * s2 + lz * c2);
    }

    // Keep the player inside the Hollow.
    const rc = Math.hypot(p.x, p.z);
    const LIMIT = 452;
    if (rc > LIMIT) { p.x = (p.x / rc) * LIMIT; p.z = (p.z / rc) * LIMIT; }
  }

  /* ---------------- main update ---------------- */

  update(dt, allowInput) {
    const T = this.world.terrain;
    this.noise = Math.max(0, this.noise - dt * 2.2);

    /* ----- look ----- */
    if (allowInput) {
      const adsFactor = this.adsFactor || 1;
      const look = Input.takeLook(adsFactor);
      this.yaw -= look.x;
      this.pitch -= look.y;
      const lim = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    }

    /* ----- stance ----- */
    if (allowInput) {
      if (Settings.get('toggleCrouch')) this.crouching = this._crouchToggle;
      else this.crouching = Input.down('ControlLeft') || Input.down('ControlRight') || Input.down('KeyC');
    }
    // do not stand up into geometry
    this.targetHeight = this.crouching ? CROUCH_H : STAND_H;
    this.height += (this.targetHeight - this.height) * Math.min(1, dt * 11);

    /* ----- ground state ----- */
    const feetY = this.position.y;
    const groundY = this.groundHeightAt(this.position.x, this.position.z, feetY);
    const wl = T.waterLevelAt(this.position.x, this.position.z);
    this.waterDepth = wl > -1e8 ? Math.max(0, wl - groundY) : 0;
    this.inWater = this.waterDepth > 0.35 && this.position.y < wl;

    /* ----- movement input ----- */
    let ax = 0, az = 0;
    let wish = { x: 0, z: 0 };
    if (allowInput) wish = Input.moveAxis();
    this.moving = (wish.x !== 0 || wish.z !== 0);

    const wantSprint = allowInput && (Settings.get('toggleSprint') ? this._sprintToggle : Input.anyDown('ShiftLeft', 'ShiftRight'));
    this.sprinting = wantSprint && this.moving && wish.z > 0.1 && !this.crouching &&
      !this.stats.exhausted && !this.inWater && this.grounded;

    let speed = this.inWater ? SPEED.swim
      : this.crouching ? SPEED.crouch
      : this.sprinting ? SPEED.sprint : SPEED.walk;
    speed *= this.env.moveMul;

    // condition modifiers
    if (this.stats.hunger < 20) speed *= 0.86;
    if (this.stats.thirst < 20) speed *= 0.9;
    if (this.stats.health < 30) speed *= 0.9;
    if (this.overloaded) speed *= 0.78;
    if (this.aiming) speed *= 0.55;
    if (this.reloading) speed *= 0.9;

    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const wx = (-sin) * wish.z + cos * wish.x;
    const wz = (-cos) * wish.z + (-sin) * wish.x;

    const accel = this.grounded ? ACCEL.ground : ACCEL.air;
    const targetVX = wx * speed, targetVZ = wz * speed;

    // Friction and acceleration are separate: friction only bites when the
    // player lets go of the stick, so holding a direction reaches full speed
    // instead of settling at an equilibrium between the two.
    if (!this.moving && (this.grounded || this.inWater)) {
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      if (sp > 0.02) {
        const f = Math.max(0, 1 - FRICTION * dt);
        this.velocity.x *= f; this.velocity.z *= f;
      } else { this.velocity.x = 0; this.velocity.z = 0; }
    }
    const blend = Math.min(1, accel * dt);
    this.velocity.x += (targetVX - this.velocity.x) * blend;
    this.velocity.z += (targetVZ - this.velocity.z) * blend;

    /* ----- stamina drain ----- */
    if (this.sprinting) this.stats.useStamina(11.5 * dt);

    /* ----- jump ----- */
    this._jumpCooldown = Math.max(0, this._jumpCooldown - dt);
    if (allowInput && Input.down('Space') && this.grounded && this._jumpCooldown <= 0 &&
        this.stats.stamina > 12 && !this.inWater) {
      this.velocity.y = JUMP_V * this.env.jumpMul * (this.crouching ? 0.75 : 1);
      this.grounded = false;
      this._jumpCooldown = 0.28;
      this.stats.useStamina(11);
      this._fallStartY = this.position.y;
      this.emitNoise(0.35);
    }

    /* ----- vertical integration ----- */
    if (this.noclip) {
      // Fly. Nothing holds you up and nothing gets in the way.
      const rise = allowInput && Input.down('Space') ? 1 : 0;
      const sink = allowInput && Input.anyDown('KeyC', 'ControlLeft', 'ControlRight') ? -1 : 0;
      this.velocity.y = (rise + sink) * 12 * this.env.moveMul;
      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
      this.position.z += this.velocity.z * dt;
      this.grounded = false;
      this._wasGrounded = false;
      this._fallStartY = this.position.y;
      this.applyCamera(dt);
      return;
    }
    if (this.inWater && this.env.freeSwim) {
      // Neutral buoyancy: you hang where you stop, and you climb or sink on
      // purpose. Nothing hauls you to the surface, because down there the
      // surface is not where you want to be anyway.
      const rise = allowInput && Input.down('Space') ? 1 : 0;
      const sink = allowInput && Input.anyDown('KeyC', 'ControlLeft', 'ControlRight') ? -1 : 0;
      const target = (rise + sink) * 3.0 - 0.25;
      this.velocity.y += (target - this.velocity.y) * Math.min(1, dt * 3.2);
    } else if (this.inWater) {
      this.velocity.y += (-1.2 - this.velocity.y) * Math.min(1, dt * 4);
      if (allowInput && Input.down('Space')) this.velocity.y = 2.2;
    } else {
      this.velocity.y -= GRAVITY * this.env.gravity * dt;
    }
    // Thick water and thin air both show up here.
    if (this.env.drag !== 1) {
      const f = Math.max(0, 1 - (this.env.drag - 1) * 1.6 * dt);
      this.velocity.x *= f; this.velocity.z *= f;
    }
    if (this.velocity.y < -60) this.velocity.y = -60;

    /* ----- integrate ----- */
    const prevX = this.position.x, prevZ = this.position.z;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    this.resolveCollisions(this.position.y);

    // recompute ground after horizontal move (we may have stepped up)
    const gY = this.groundHeightAt(this.position.x, this.position.z, this.position.y);
    if (this.position.y <= gY + 0.001) {
      if (!this._wasGrounded) {
        const fall = this._fallStartY - gY;
        if (fall > 2.2) {
          const hard = fall > 5.0;
          this.landDipVel = -Math.min(0.30, fall * 0.035);
          Audio.land(hard);
          this.emitNoise(hard ? 0.7 : 0.4);
          if (fall > 6.0) {
            const dmg = (fall - 6.0) * 9.5;
            this.stats.damage(dmg, 'the fall', { bleed: 0.3 });
          }
        } else if (fall > 0.6) {
          Audio.land(false);
        }
      }
      this.position.y = gY;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      if (this._wasGrounded) this._fallStartY = this.position.y;
      this.grounded = false;
    }
    // water surface clamp (wading, not swimming)
    if (this.waterDepth > 0 && wl > -1e8 && !this.env.freeSwim) {
      const maxWade = wl - 0.15;
      if (this.position.y < maxWade && this.waterDepth > 1.5) {
        this.position.y = Math.min(this.position.y + dt * 2.0, maxWade);
        this.velocity.y = Math.max(this.velocity.y, 0);
      }
    }

    this._wasGrounded = this.grounded;

    /* ----- surface + footsteps ----- */
    const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.stats.distance += moved;
    if (this.grounded && moved > 0.0005) {
      this._stepDist += moved;
      const stride = this.crouching ? 1.35 : this.sprinting ? 1.95 : 1.62;
      if (this._stepDist >= stride) {
        this._stepDist = 0;
        this.surface = this.inWater ? 'water' : this.structureSurface() || T.surfaceAt(this.position.x, this.position.z);
        Audio.footstep(this.surface, this.sprinting, this.crouching);
        this.emitNoise(this.crouching ? 0.10 : this.sprinting ? 0.55 : 0.28);
      }
    }

    /* ----- head bob, landing dip, breathing ----- */
    const targetBob = this.grounded && this.moving ? (this.sprinting ? 1.35 : this.crouching ? 0.5 : 0.85) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 7);
    this.bobPhase += moved * (this.crouching ? 4.6 : 3.5);
    this.landDipVel += (-this.landDip * 42 - this.landDipVel * 9.5) * dt;
    this.landDip += this.landDipVel * dt;

    const targetRoll = -wish.x * 0.014 * (this.sprinting ? 1.5 : 1);
    this.viewRoll += (targetRoll - this.viewRoll) * Math.min(1, dt * 6);

    // exhaustion breathing
    this.breathPhase += dt * (this.stats.exhausted ? 2.6 : 1.1);
    if (this.stats.stamina < 34 && this.breathPhase > Math.PI * 2) {
      this.breathPhase = 0;
      Audio.breath(1 - this.stats.stamina / 34);
    } else if (this.breathPhase > Math.PI * 2) this.breathPhase -= Math.PI * 2;

    /* ----- recoil spring ----- */
    this.recoilVel += (-this.recoilPitch * 130 - this.recoilVel * 17) * dt;
    this.recoilPitch += this.recoilVel * dt;
    this.recoilYawVel += (-this.recoilYaw * 130 - this.recoilYawVel * 17) * dt;
    this.recoilYaw += this.recoilYawVel * dt;

    this.applyCamera(dt);
  }

  structureSurface() {
    const boxes = this.world.structureBoxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (Math.abs(b.yTop - this.position.y) > 0.12) continue;
      if (this._insideBox(b, this.position.x, this.position.z, 0.1)) return b.type === 'rock' ? 'rock' : b.type === 'metal' ? 'metal' : 'wood';
    }
    return null;
  }

  applyCamera() {
    const bobScale = Settings.get('headBob');
    const bobY = Math.sin(this.bobPhase * 2) * 0.031 * this.bobAmount * bobScale;
    const bobX = Math.cos(this.bobPhase) * 0.026 * this.bobAmount * bobScale;
    const breath = Math.sin(this.breathPhase) * 0.006 * (this.stats.exhausted ? 2.4 : 1);

    const e = this.eyePosition;
    this.camera.position.set(
      e.x + bobX * Math.cos(this.yaw),
      e.y + bobY + breath,
      e.z - bobX * Math.sin(this.yaw)
    );
    _euler.set(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, this.viewRoll + bobX * 0.5, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);
  }

  addRecoil(pitch, yaw) {
    this.recoilVel -= pitch * 12;
    this.recoilYawVel += yaw * 12;
  }

  /** Publish a noise event the AI can react to. */
  emitNoise(level) {
    this.noise = Math.max(this.noise, level);
    this.world.onNoise?.(this.position, level);
  }

  get overloaded() { return this._overloaded; }
  set overloaded(v) { this._overloaded = v; }

  serialize() {
    return { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw, pitch: this.pitch };
  }
  deserialize(d) {
    if (!d) return;
    this.position.set(d.x, d.y, d.z);
    this.yaw = d.yaw; this.pitch = d.pitch;
    this.velocity.set(0, 0, 0);
  }
}

const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
