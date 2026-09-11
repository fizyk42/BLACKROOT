// Player character: on-foot locomotion, third-person camera, combat and vehicle handover.

import * as THREE from 'three';
import { Character, locomotionFor, OUTFITS, SKIN_TONES } from './character.js';
import { clamp, damp, dampAngle, angleDiff, resolveCircleVsBoxes, lerp } from '../core/util.js';
import { settings, difficulty } from '../core/settings.js';
import { isOnRoad } from '../world/citymap.js';

export const WEAPONS = {
  fists: { id: 'fists', name: 'Fists', melee: true, damage: 9, rate: 0.42, range: 1.9 },
  pistol: { id: 'pistol', name: 'Sidearm', damage: 22, rate: 0.28, range: 90, mag: 12, spread: 0.016, price: 1200, ammoPrice: 45 },
  smg: { id: 'smg', name: 'Compact SMG', damage: 15, rate: 0.085, range: 70, mag: 30, spread: 0.036, price: 6800, ammoPrice: 120, auto: true },
};

const PLAYER_RADIUS = 0.38;
const _boxes = [];

export class Player {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.character = new Character({ outfit: OUTFITS[0], skin: SKIN_TONES[2] });
    scene.add(this.character.root);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;              // facing
    this.vy = 0;
    this.grounded = true;
    this.groundY = 0;
    this.crouched = false;
    this.sprinting = false;
    this.health = 100;
    this.maxHealth = 100;
    this.stamina = 100;
    this.dead = false;
    this.deadTimer = 0;
    this.interior = null;      // interior id when indoors

    this.vehicle = null;       // Vehicle when driving
    this.enterCooldown = 0;

    // Combat
    this.weapons = { fists: { ammo: Infinity, reserve: Infinity } };
    this.weaponOrder = ['fists'];
    this.weapon = 'fists';
    this.aiming = false;
    this.fireTimer = 0;
    this.reloading = 0;
    this.meleeTimer = 0;
    this.tracers = [];

    // Camera rig
    this.camYaw = 0;
    this.camPitch = 0.16;
    this.camDist = 5.4;
    this.camDistTarget = 5.4;
    this.camMode = 0;          // 0 chase, 1 close, 2 bonnet/hood, 3 far
    this.shake = 0;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();

    this.lastSafePos = new THREE.Vector3();
    this.footTimer = 0;
  }

  get inVehicle() { return !!this.vehicle; }

  setOutfit(o, skin) { this.character.setOutfit(o, skin ?? this.character.skin); }

  teleport(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.camYaw = yaw;
    this.vy = 0;
    this.character.setPosition(x, y, z);
    this.character.setYaw(yaw);
  }

  giveWeapon(id, ammo = 0) {
    const w = WEAPONS[id];
    if (!w) return;
    if (!this.weapons[id]) {
      this.weapons[id] = { ammo: w.mag || 0, reserve: 0 };
      this.weaponOrder.push(id);
    }
    this.weapons[id].reserve += ammo;
  }

  nextWeapon() {
    const i = this.weaponOrder.indexOf(this.weapon);
    this.weapon = this.weaponOrder[(i + 1) % this.weaponOrder.length];
    this.reloading = 0;
  }

  groundHeightAt(x, z) {
    if (this.interior) return this.world.interiors.get(this.interior).origin.y;
    return isOnRoad(x, z) ? 0 : 0.16;
  }

  damage(amount, source) {
    if (this.dead) return;
    const d = amount * difficulty().damageTaken;
    this.health = clamp(this.health - d, 0, this.maxHealth);
    if (this.onDamaged) this.onDamaged(d, source);
    if (this.health <= 0) this.die();
    else if (d > 4) this.character.playOnce('hit', 1.2);
  }

  heal(a) { this.health = clamp(this.health + a, 0, this.maxHealth); }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = 0;
    this.character.play('die', 0.12, { loop: false });
    if (this.vehicle) this.exitVehicle(true);
    if (this.onDeath) this.onDeath();
  }

  revive(x, z) {
    this.dead = false;
    this.health = this.maxHealth * 0.6;
    this.stamina = 100;
    this.teleport(x, this.groundHeightAt(x, z), z);
    this.character.play('idle', 0.1);
  }

  // ---------------------------------------------------------------- vehicles
  enterVehicle(v, asPassenger = false) {
    if (!v || this.vehicle) return false;
    this.vehicle = v;
    v.driver = 'player';
    v.engineOn = true;
    v.parked = false;
    this.camYaw = v.yaw;
    this.camPitch = 0.13;
    this.aiming = false;
    this.character.play('drive', 0.2);
    this.enterCooldown = 0.5;
    if (this.onEnterVehicle) this.onEnterVehicle(v);
    return true;
  }

  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return;
    if (!force && Math.abs(v.speed) > 9) return;   // no jumping out at speed
    const door = v.doorPosition(-1);
    this.vehicle = null;
    v.driver = null;
    v.engineOn = false;
    v.speed *= 0.2;
    this.pos.set(door.x, this.groundHeightAt(door.x, door.z), door.z);
    this.yaw = v.yaw - Math.PI / 2;
    this.enterCooldown = 0.6;
    this.character.play('idle', 0.2);
    if (this.onExitVehicle) this.onExitVehicle(v);
  }

  // ---------------------------------------------------------------- update
  update(dt, input, camera, colliders, ctx) {
    this.enterCooldown = Math.max(0, this.enterCooldown - dt);
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.finishReload();
    }

    this.updateCameraInput(dt, input);

    if (this.dead) {
      this.deadTimer += dt;
      this.character.update(dt);
      this.updateCamera(dt, camera, colliders);
      return;
    }

    if (this.vehicle) this.updateDriving(dt, input, ctx);
    else this.updateOnFoot(dt, input, colliders, ctx);

    this.character.update(dt);
    this.updateCamera(dt, camera, colliders);
    this.updateTracers(dt);
  }

  updateCameraInput(dt, input) {
    const speed = 1;
    const looking = Math.abs(input.axes.lookX) + Math.abs(input.axes.lookY) > 0.0001;
    this.cameraLookTimer = looking ? 1.2 : Math.max(0, (this.cameraLookTimer || 0) - dt);
    this.camYaw -= input.axes.lookX * speed;
    this.camPitch = clamp(this.camPitch + input.axes.lookY * speed, -0.65, 1.15);
    if (input.mouse.wheel) {
      this.camDistTarget = clamp(this.camDistTarget + input.mouse.wheel * 0.6, 2.2, 9.5);
    }
    if (input.pressed('camera')) this.camMode = (this.camMode + 1) % 4;
  }

  updateOnFoot(dt, input, colliders, ctx) {
    const ax = input.axes.moveX, az = input.axes.moveY;
    const moving = Math.hypot(ax, az) > 0.02;

    this.aiming = input.isDown('aim') && this.weapon !== 'fists';
    const wantSprint = settings.holdToSprint ? input.isDown('sprint') : input.isDown('sprint');
    this.crouched = input.isDown('crouch') && this.grounded;

    let maxSpeed = this.crouched ? 1.7 : this.aiming ? 2.0 : 4.1;
    this.sprinting = wantSprint && moving && !this.crouched && !this.aiming && this.stamina > 1;
    if (this.sprinting) maxSpeed = 7.2;

    if (this.sprinting) this.stamina = clamp(this.stamina - dt * 17, 0, 100);
    else this.stamina = clamp(this.stamina + dt * (moving ? 9 : 16), 0, 100);
    if (this.stamina <= 0) this.sprinting = false;

    // Movement is camera-relative.
    const cy = this.camYaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    // Camera looks along +Z at yaw zero: screen-right is -X.
    const rx = -Math.cos(cy), rz = Math.sin(cy);
    let wx = fx * az + rx * ax;
    let wz = fz * az + rz * ax;
    const l = Math.hypot(wx, wz);
    if (l > 1) { wx /= l; wz /= l; }

    const accel = this.grounded ? 22 : 6;
    this.vel.x = damp(this.vel.x, wx * maxSpeed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * maxSpeed, accel, dt);

    // Facing: turn toward movement, or toward the camera while aiming.
    if (this.aiming) this.yaw = dampAngle(this.yaw, cy, 18, dt);
    else if (moving) this.yaw = dampAngle(this.yaw, Math.atan2(wx, wz), 11, dt);

    // Jump + gravity.
    if (input.pressed('jump') && this.grounded && !this.crouched && this.stamina > 6) {
      this.vy = 5.1;
      this.grounded = false;
      this.stamina -= 6;
      this.character.playOnce('jumpStart', 1.4);
    }
    this.vy -= 19.6 * dt;

    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;

    // Static collision.
    if (colliders) {
      colliders.query(nx - 2, nz - 2, nx + 2, nz + 2, _boxes);
      const res = resolveCircleVsBoxes(nx, nz, PLAYER_RADIUS, _boxes, 2, this.pos.y);
      nx = res.x; nz = res.z;
      if (res.hit) {
        // Kill the velocity component pushing into the wall so we slide along it.
        const d = this.vel.x * res.nx + this.vel.z * res.nz;
        if (d < 0) { this.vel.x -= res.nx * d; this.vel.z -= res.nz * d; }
      }
    }
    // Interiors have their own simple box bounds.
    if (this.interior) {
      const b = this.world.interiors.get(this.interior).bounds;
      nx = clamp(nx, b.minX, b.maxX);
      nz = clamp(nz, b.minZ, b.maxZ);
    }

    this.pos.x = nx; this.pos.z = nz;

    const gy = this.groundHeightAt(nx, nz);
    let y = this.pos.y + this.vy * dt;
    if (y <= gy) {
      if (!this.grounded && this.vy < -7) this.character.playOnce('jumpLand', 1.3);
      y = gy; this.vy = 0; this.grounded = true;
    } else this.grounded = false;
    this.pos.y = y;

    // Animation.
    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded) {
      this.character.play('jumpLoop', 0.12);
    } else if (this.meleeTimer > 0) {
      // one-shot punch is already playing
    } else if (this.reloading > 0) {
      this.character.play('reload', 0.1, { loop: false });
    } else if (this.aiming) {
      this.character.play(planar > 0.4 ? 'aim' : 'aim', 0.14);
    } else {
      const loco = locomotionFor(planar, this.crouched);
      this.character.play(loco.key, 0.16, { speed: loco.speed });
    }

    this.character.setPosition(this.pos.x, this.pos.y, this.pos.z);
    this.character.setYaw(this.yaw);

    // Footstep hook for audio.
    if (this.grounded && planar > 0.5) {
      this.footTimer -= dt * (planar / 1.5);
      if (this.footTimer <= 0) {
        this.footTimer = 0.55;
        if (this.onFootstep) this.onFootstep(planar);
      }
    }

    this.handleCombat(dt, ctx);
    if (this.grounded && !this.interior) this.lastSafePos.copy(this.pos);
  }

  updateDriving(dt, input, ctx) {
    const v = this.vehicle;
    const ctl = {
      throttle: input.axes.throttle,
      brake: input.axes.brake,
      steer: input.axes.steer,
      handbrake: input.isDown('handbrake'),
    };
    v.update(dt, ctl, ctx.colliders, ctx.otherVehicles);

    if (input.pressed('headlights')) v.headlights = !v.headlights;
    if (input.pressed('horn') && this.onHorn) this.onHorn();
    if (input.isDown('recover') || input.pressed('recover')) {
      this.recoverTimer = (this.recoverTimer || 0) + dt;
      if (this.recoverTimer > 0.7) { this.recoverVehicle(); this.recoverTimer = 0; }
    } else this.recoverTimer = 0;

    // Sit the character in the driver's seat.
    const s = v.spec;
    const seatX = -s.length * 0.06, seatY = s.height * 0.30, seatZ = -s.width * 0.24;
    const c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    this.pos.set(
      v.pos.x - seatX * sn + seatZ * c,
      seatY,
      v.pos.z - seatX * c - seatZ * sn,
    );
    this.yaw = v.yaw;
    this.character.setPosition(this.pos.x, this.pos.y - 0.52, this.pos.z);
    this.character.setYaw(this.yaw);
    this.character.play('drive', 0.2);

    if (v.lastImpact > 6) {
      this.damage(v.lastImpact * 0.35, 'crash');
      this.shake = Math.min(1, this.shake + v.lastImpact * 0.02);
      v.lastImpact = 0;
    }
  }

  recoverVehicle() {
    const v = this.vehicle;
    if (!v) return;
    v.speed = 0;
    v.yawRate = 0;
    // Nudge back to the nearest lane centre, pointing along the road.
    const g = this.world.graph;
    const n = g.nearestNode(v.pos.x, v.pos.z);
    let best = null, bestD = Infinity;
    for (const eid of n.out) {
      const e = g.edges[eid];
      for (let t = 0.1; t <= 0.9; t += 0.2) {
        const p = g.lanePoint(e, t, 0, {});
        const d = (p.x - v.pos.x) ** 2 + (p.z - v.pos.z) ** 2;
        if (d < bestD) { bestD = d; best = { p, e }; }
      }
    }
    if (best) {
      v.pos.set(best.p.x, 0, best.p.z);
      v.yaw = g.edgeHeading(best.e);
    }
    if (this.onRecover) this.onRecover();
  }

  // ---------------------------------------------------------------- combat
  handleCombat(dt, ctx) {
    const w = WEAPONS[this.weapon];
    const slot = this.weapons[this.weapon];
    const input = ctx.input;

    if (input.pressed('nextWeapon')) this.nextWeapon();
    if (input.pressed('holster')) this.weapon = 'fists';
    if (input.pressed('reload') && !w.melee && slot.ammo < w.mag && slot.reserve > 0 && this.reloading <= 0) {
      this.reloading = 1.35;
      this.character.playOnce('reload', 1.0);
    }

    const wantsFire = w.auto ? input.isDown('fire') : input.pressed('fire');
    if (!wantsFire || this.fireTimer > 0 || this.reloading > 0) return;

    if (w.melee) {
      this.fireTimer = w.rate;
      this.meleeTimer = 0.42;
      this.character.playOnce(Math.random() < 0.5 ? 'punchA' : 'punchB', 1.25);
      if (ctx.onMelee) ctx.onMelee(this, w);
      return;
    }
    if (slot.ammo <= 0) {
      if (slot.reserve > 0 && this.reloading <= 0) { this.reloading = 1.35; this.character.playOnce('reload', 1.0); }
      else if (this.onDryFire) this.onDryFire();
      return;
    }

    slot.ammo--;
    this.fireTimer = w.rate;
    this.shake = Math.min(1, this.shake + 0.18);
    this.character.playOnce('shoot', 1.5);

    // Hitscan from the muzzle along the camera direction.
    const dir = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      -Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).normalize();
    const spread = w.spread * (this.aiming ? 0.35 : 1) * (settings.aimAssist ? 0.8 : 1);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + 1.42, this.pos.z);
    if (ctx.onShot) ctx.onShot(this, w, origin, dir);
    this.addTracer(origin, origin.clone().addScaledVector(dir, w.range));
  }

  finishReload() {
    const w = WEAPONS[this.weapon];
    const slot = this.weapons[this.weapon];
    if (!w.mag) return;
    const need = w.mag - slot.ammo;
    const take = Math.min(need, slot.reserve);
    slot.ammo += take;
    slot.reserve -= take;
  }

  addTracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- camera
  updateCamera(dt, camera, colliders) {
    const inCar = !!this.vehicle;
    const modes = inCar
      ? [{ d: 7.6, h: 2.5, fovMul: 1.0 }, { d: 5.2, h: 2.0, fovMul: 1.0 }, { d: 0.2, h: 1.25, fovMul: 1.05 }, { d: 11.5, h: 4.2, fovMul: 0.98 }]
      : [{ d: this.camDistTarget, h: 1.62, fovMul: 1 }, { d: 2.6, h: 1.55, fovMul: 1 }, { d: 1.6, h: 1.58, fovMul: 1 }, { d: 8.0, h: 2.2, fovMul: 1 }];
    const m = modes[this.camMode % modes.length];

    // While driving, the camera drifts behind the car unless the player looks around.
    if (inCar && Math.abs(this.vehicle.speed) > 3 && !(this.cameraLookTimer > 0)) {
      const behind = this.vehicle.yaw;
      this.camYaw = dampAngle(this.camYaw, behind, 2.2 * clamp(Math.abs(this.vehicle.speed) / 14, 0, 1), dt);
      this.camPitch = damp(this.camPitch, 0.13, 2.0, dt);
    }

    const aimTight = this.aiming ? 0.55 : 1;
    this.camDist = damp(this.camDist, m.d * aimTight, 7, dt);

    const target = new THREE.Vector3(this.pos.x, this.pos.y + m.h, this.pos.z);
    if (this.aiming && !inCar) {
      // Over-the-shoulder offset.
      target.x += Math.cos(this.camYaw) * 0.55;
      target.z -= Math.sin(this.camYaw) * 0.55;
    }

    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const dirX = -Math.sin(this.camYaw) * cp;
    const dirZ = -Math.cos(this.camYaw) * cp;
    const dirY = sp;

    let dist = this.camDist;
    // Camera collision: shorten the arm if it would clip a building.
    if (colliders) {
      colliders.query(
        Math.min(target.x, target.x + dirX * dist) - 1, Math.min(target.z, target.z + dirZ * dist) - 1,
        Math.max(target.x, target.x + dirX * dist) + 1, Math.max(target.z, target.z + dirZ * dist) + 1, _boxes,
      );
      for (const b of _boxes) {
        if (b.height !== undefined && target.y > b.height) continue;
        for (let t = 0.25; t <= 1.0; t += 0.12) {
          const px = target.x + dirX * dist * t;
          const pz = target.z + dirZ * dist * t;
          if (px > b.minX - 0.4 && px < b.maxX + 0.4 && pz > b.minZ - 0.4 && pz < b.maxZ + 0.4) {
            dist = Math.min(dist, dist * t * 0.92);
            break;
          }
        }
      }
    }

    this._camPos.set(target.x + dirX * dist, target.y + dirY * dist + 0.35, target.z + dirZ * dist);
    if (this.interior) this._camPos.y = Math.min(this._camPos.y, target.y + 1.4);

    const smoothing = inCar ? 16 : 20;
    camera.position.x = damp(camera.position.x, this._camPos.x, smoothing, dt);
    camera.position.y = damp(camera.position.y, this._camPos.y, smoothing, dt);
    camera.position.z = damp(camera.position.z, this._camPos.z, smoothing, dt);

    // Screen shake.
    this.shake = damp(this.shake, 0, 4, dt);
    const sh = settings.reducedCameraShake ? this.shake * 0.25 : this.shake;
    if (sh > 0.001) {
      camera.position.x += (Math.random() - 0.5) * sh * 0.32;
      camera.position.y += (Math.random() - 0.5) * sh * 0.32;
      camera.position.z += (Math.random() - 0.5) * sh * 0.32;
    }

    this._camLook.copy(target);
    this._camLook.y += this.aiming ? 0.12 : 0.25;
    camera.lookAt(this._camLook);

    const speedFov = inCar ? clamp(Math.abs(this.vehicle.speed) / 55, 0, 1) * 12 : 0;
    const targetFov = settings.fov * m.fovMul * (this.aiming ? 0.78 : 1) + speedFov;
    camera.fov = damp(camera.fov, targetFov, 6, dt);
    camera.updateProjectionMatrix();
  }

  serialise() {
    return {
      x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3),
      health: Math.round(this.health),
      outfit: this.character.outfit.id, skin: this.character.skin,
      weapons: Object.fromEntries(Object.entries(this.weapons).map(([k, v]) => [k, {
        ammo: v.ammo === Infinity ? -1 : v.ammo, reserve: v.reserve === Infinity ? -1 : v.reserve,
      }])),
      weapon: this.weapon,
    };
  }

  restore(d) {
    if (!d) return;
    this.teleport(d.x || 0, d.y || 0, d.z || 0, d.yaw || 0);
    this.health = d.health ?? 100;
    const o = OUTFITS.find((x) => x.id === d.outfit) || OUTFITS[0];
    this.setOutfit(o, d.skin);
    if (d.weapons) {
      for (const [k, v] of Object.entries(d.weapons)) {
        if (!WEAPONS[k]) continue;
        if (!this.weapons[k]) { this.weapons[k] = { ammo: 0, reserve: 0 }; this.weaponOrder.push(k); }
        this.weapons[k].ammo = v.ammo < 0 ? Infinity : v.ammo;
        this.weapons[k].reserve = v.reserve < 0 ? Infinity : v.reserve;
      }
    }
    this.weapon = d.weapon && this.weapons[d.weapon] ? d.weapon : 'fists';
  }
}
