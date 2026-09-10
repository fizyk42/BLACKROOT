// Pedestrians walk the pavement network, wait at kerbs, and scatter from danger.
// They share the player's rig and animation set, so they move like people, not props.

import * as THREE from 'three';
import { Character, locomotionFor, OUTFITS, SKIN_TONES } from './character.js';
import { CITY } from '../world/citymap.js';
import { clamp, damp, dampAngle, angleDiff, makeRng } from '../core/util.js';
import { preset } from '../core/settings.js';

const WALK_OFFSET = (CITY.ROAD_HALF + CITY.KERB_HALF) / 2;

export class Pedestrian {
  constructor(graph, x, z, rng) {
    this.graph = graph;
    this.pos = new THREE.Vector3(x, 0.16, z);
    this.yaw = rng() * Math.PI * 2;
    this.speed = 0;
    this.targetSpeed = 1.05 + rng() * 0.5;
    this.state = 'walk';       // walk | wait | flee | hurt
    this.fleeTimer = 0;
    this.pauseTimer = 0;
    this.health = 40;
    this.character = new Character({
      outfit: OUTFITS[Math.floor(rng() * OUTFITS.length)],
      skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)],
    });
    this.character.setPosition(x, 0.16, z);
    this.waypoint = null;
    this.pickWaypoint();
  }

  /** Pavement corners around an intersection make a natural walkable ring. */
  pickWaypoint() {
    const g = this.graph;
    const n = g.nearestNode(this.pos.x, this.pos.z);
    const cand = [];
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        cand.push({ x: n.x + dx * WALK_OFFSET, z: n.z + dz * WALK_OFFSET });
      }
    }
    for (const eid of n.out) {
      const e = g.edges[eid];
      const b = g.nodes[e.b];
      for (const s of [-1, 1]) {
        cand.push({
          x: (n.x + b.x) / 2 + (e.axis === 'x' ? 0 : s * WALK_OFFSET),
          z: (n.z + b.z) / 2 + (e.axis === 'z' ? 0 : s * WALK_OFFSET),
        });
      }
    }
    const far = cand.filter((c) => Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > 6);
    this.waypoint = (far.length ? far : cand)[Math.floor(Math.random() * (far.length || cand.length))];
  }

  scare(fromX, fromZ, duration = 5) {
    this.state = 'flee';
    this.fleeTimer = Math.max(this.fleeTimer, duration);
    this.fleeFrom = { x: fromX, z: fromZ };
    this.targetSpeed = 4.8 + Math.random() * 1.4;
  }

  hurt(amount, fromX, fromZ) {
    this.health -= amount;
    if (this.health <= 0) {
      this.state = 'down';
      this.character.play('die', 0.1, { loop: false });
      return true;
    }
    this.character.playOnce('hit', 1.2);
    this.scare(fromX, fromZ, 8);
    return false;
  }

  update(dt, ctx) {
    if (this.state === 'down') { this.character.update(dt); return; }

    if (this.state === 'flee') {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) { this.state = 'walk'; this.targetSpeed = 1.05 + Math.random() * 0.5; }
    }

    let tx, tz;
    if (this.state === 'flee' && this.fleeFrom) {
      tx = this.pos.x + (this.pos.x - this.fleeFrom.x);
      tz = this.pos.z + (this.pos.z - this.fleeFrom.z);
    } else {
      if (!this.waypoint) this.pickWaypoint();
      tx = this.waypoint.x; tz = this.waypoint.z;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 1.4) {
        this.pauseTimer = Math.random() < 0.25 ? 1.5 + Math.random() * 3 : 0;
        this.pickWaypoint();
      }
    }

    // Step aside for approaching vehicles.
    let avoidX = 0, avoidZ = 0;
    for (const v of ctx.vehicles) {
      const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 7 && d > 0.01) {
        const w = (7 - d) / 7;
        avoidX += (dx / d) * w * 3;
        avoidZ += (dz / d) * w * 3;
        if (d < 3 && Math.abs(v.speed) > 4) this.scare(v.pos.x, v.pos.z, 4);
      }
    }

    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      this.targetSpeed = 0;
    } else if (this.state !== 'flee') {
      this.targetSpeed = 1.05 + (this.targetSpeed > 2 ? 0 : 0.35);
    }

    let dirX = tx - this.pos.x + avoidX;
    let dirZ = tz - this.pos.z + avoidZ;
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len; dirZ /= len;

    this.speed = damp(this.speed, this.pauseTimer > 0 ? 0 : this.targetSpeed, 5, dt);
    this.pos.x += dirX * this.speed * dt;
    this.pos.z += dirZ * this.speed * dt;
    if (this.speed > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(dirX, dirZ), 8, dt);

    const loco = locomotionFor(this.speed, false);
    this.character.play(loco.key, 0.2, { speed: loco.speed });
    this.character.setPosition(this.pos.x, this.pos.y, this.pos.z);
    this.character.setYaw(this.yaw);
    this.character.update(dt);
  }
}

export class PedSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.peds = [];
    this.rng = makeRng(4242);
    this.spawnRadius = 90;
    this.despawnRadius = 150;
  }

  desiredCount() { return preset().peds; }

  spawn(playerPos) {
    const g = this.world.graph;
    for (let a = 0; a < 8; a++) {
      const n = g.nodes[Math.floor(this.rng() * g.nodes.length)];
      const x = n.x + (this.rng() < 0.5 ? -1 : 1) * WALK_OFFSET + this.rng.range(-6, 6);
      const z = n.z + (this.rng() < 0.5 ? -1 : 1) * WALK_OFFSET + this.rng.range(-6, 6);
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (d < 25 || d > this.spawnRadius) continue;
      const p = new Pedestrian(g, x, z, this.rng);
      this.scene.add(p.character.root);
      this.peds.push(p);
      return p;
    }
    return null;
  }

  scareNear(x, z, radius = 22, duration = 6) {
    for (const p of this.peds) {
      if (Math.hypot(p.pos.x - x, p.pos.z - z) < radius) p.scare(x, z, duration);
    }
  }

  /** Returns the pedestrian closest to a point within `radius`, or null. */
  nearest(x, z, radius = 2.2) {
    let best = null, bd = radius * radius;
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      const d = (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  update(dt, playerPos, ctx) {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const d = Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z);
      if (d > this.despawnRadius || (p.state === 'down' && (p.downTimer = (p.downTimer || 0) + dt) > 25)) {
        p.character.dispose(this.scene);
        this.peds.splice(i, 1);
        continue;
      }
      p.update(dt, ctx);
    }
    if (this.peds.length < this.desiredCount()) this.spawn(playerPos);
  }

  clear() {
    for (const p of this.peds) p.character.dispose(this.scene);
    this.peds.length = 0;
  }
}
