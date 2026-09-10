// Wanted system. Crimes raise heat, police units spawn and pursue, losing line of
// sight drops the pursuit into a search, and surviving the search clears it.

import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { clamp, damp, angleDiff } from '../core/util.js';
import { difficulty } from '../core/settings.js';
import { poi } from '../world/citymap.js';

export const CRIMES = {
  speeding: { heat: 0.12, label: 'Reckless driving' },
  hitPed: { heat: 0.9, label: 'Hit a pedestrian' },
  hitCar: { heat: 0.25, label: 'Dangerous driving' },
  fireWeapon: { heat: 0.7, label: 'Firing a weapon' },
  killPed: { heat: 2.2, label: 'Homicide' },
  stealCar: { heat: 0.55, label: 'Vehicle theft' },
  assaultPolice: { heat: 1.6, label: 'Assaulting an officer' },
  evade: { heat: 0.35, label: 'Failing to stop' },
};

const LEVEL_UNITS = [0, 1, 2, 3, 4, 6];
const SEARCH_TIME = [0, 18, 26, 34, 44, 60];

export class PoliceSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.graph = world.graph;
    this.heat = 0;             // continuous 0..5
    this.level = 0;            // integer wanted stars
    this.state = 'clear';      // clear | pursuit | search
    this.searchTimer = 0;
    this.units = [];
    this.spawnCooldown = 0;
    this.lastKnown = new THREE.Vector3();
    this.enabled = true;
    this.onLevelChange = null;
    this.onBusted = null;
  }

  reportCrime(kind, position) {
    if (!this.enabled) return;
    const c = CRIMES[kind];
    if (!c) return;
    const before = this.level;
    this.heat = clamp(this.heat + c.heat * difficulty().wantedGain, 0, 5);
    this.level = Math.min(5, Math.floor(this.heat));
    if (position) this.lastKnown.copy(position);
    if (this.level > 0) {
      this.state = 'pursuit';
      this.searchTimer = 0;
    }
    if (this.level !== before && this.onLevelChange) this.onLevelChange(this.level, c.label);
  }

  clearWanted() {
    this.heat = 0;
    this.level = 0;
    this.state = 'clear';
    this.searchTimer = 0;
    this.despawnAll();
    if (this.onLevelChange) this.onLevelChange(0, null);
  }

  despawnAll() {
    for (const u of this.units) {
      u.vehicle.sirenOn = false;
      u.vehicle.detach(this.scene);
    }
    this.units.length = 0;
  }

  /** Any unit close enough and roughly facing the player counts as line of sight. */
  hasLineOfSight(playerPos) {
    for (const u of this.units) {
      const d = Math.hypot(u.vehicle.pos.x - playerPos.x, u.vehicle.pos.z - playerPos.z);
      if (d < 55) return true;
    }
    return false;
  }

  spawnUnit(playerPos) {
    const g = this.graph;
    for (let a = 0; a < 14; a++) {
      const e = g.edges[Math.floor(Math.random() * g.edges.length)];
      const p = g.lanePoint(e, Math.random(), 0, {});
      const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (d < 60 || d > 230) continue;
      const v = new Vehicle('police', { x: p.x, z: p.z });
      v.yaw = g.edgeHeading(e);
      v.driver = 'police';
      v.engineOn = true;
      v.headlights = true;
      v.sirenOn = true;
      v.attach(this.scene);
      const unit = { vehicle: v, path: null, pathIndex: 0, repathTimer: 0, rammed: 0 };
      this.units.push(unit);
      return unit;
    }
    return null;
  }

  update(dt, playerPos, playerVehicle, colliders, allVehicles) {
    if (!this.enabled) return;

    // Heat decays slowly whenever nobody has eyes on the player.
    if (this.state === 'search') {
      this.searchTimer -= dt;
      if (this.searchTimer <= 0) this.clearWanted();
    } else if (this.state === 'pursuit') {
      if (this.hasLineOfSight(playerPos)) {
        this.lastKnown.copy(playerPos);
      } else if (this.units.length > 0) {
        this.state = 'search';
        this.searchTimer = SEARCH_TIME[this.level] || 20;
      }
    }
    if (this.level === 0) {
      this.heat = Math.max(0, this.heat - dt * 0.05);
      if (this.units.length) this.despawnAll();
      return;
    }

    // Maintain the right number of units for the current level.
    this.spawnCooldown -= dt;
    const want = LEVEL_UNITS[this.level];
    if (this.units.length < want && this.spawnCooldown <= 0) {
      this.spawnUnit(playerPos);
      this.spawnCooldown = 2.4;
    }
    while (this.units.length > want) {
      const u = this.units.pop();
      u.vehicle.detach(this.scene);
    }

    const chaseTarget = this.state === 'pursuit' ? playerPos : this.lastKnown;

    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const v = u.vehicle;

      if (v.destroyed) {
        v.sirenOn = false;
        v.detach(this.scene);
        this.units.splice(i, 1);
        continue;
      }
      if (Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z) > 340) {
        v.detach(this.scene);
        this.units.splice(i, 1);
        continue;
      }

      // Route along the road network toward the target, refreshed periodically.
      u.repathTimer -= dt;
      const dToTarget = Math.hypot(v.pos.x - chaseTarget.x, v.pos.z - chaseTarget.z);
      if (u.repathTimer <= 0 || !u.path) {
        u.repathTimer = 1.6;
        const from = this.graph.nearestNode(v.pos.x, v.pos.z);
        const to = this.graph.nearestNode(chaseTarget.x, chaseTarget.z);
        const path = this.graph.findPath(from.id, to.id);
        u.path = path ? this.graph.pathToWaypoints(path, 0) : null;
        u.pathIndex = 0;
      }

      let aimX = chaseTarget.x, aimZ = chaseTarget.z;
      if (dToTarget > 34 && u.path && u.pathIndex < u.path.length) {
        const wp = u.path[u.pathIndex];
        if (Math.hypot(wp.x - v.pos.x, wp.z - v.pos.z) < 9) u.pathIndex++;
        const cur = u.path[Math.min(u.pathIndex, u.path.length - 1)];
        aimX = cur.x; aimZ = cur.z;
      }

      const dx = aimX - v.pos.x, dz = aimZ - v.pos.z;
      const desired = Math.atan2(dx, dz);
      const err = angleDiff(v.yaw, desired);
      const steer = clamp(err * 2.6, -1, 1);

      // Speed: full chase when close, cruise while searching.
      let target = this.state === 'pursuit' ? 20 + this.level * 3.5 : 11;
      if (Math.abs(err) > 0.7) target = Math.min(target, 8);
      if (dToTarget < 9 && playerVehicle) target = Math.min(target, Math.abs(playerVehicle.speed) + 3);

      const throttle = v.speed < target ? clamp((target - v.speed) * 0.3, 0, 1) : 0;
      const brake = v.speed > target + 2 ? clamp((v.speed - target) * 0.25, 0, 1) : 0;

      v.update(dt, { throttle, brake, steer, handbrake: false }, colliders, allVehicles);
      v.sirenOn = this.state === 'pursuit';
    }
  }

  /** Called when the player is on foot and an officer is on top of them. */
  checkBust(playerPos, playerInVehicle) {
    if (this.level === 0 || playerInVehicle) return false;
    for (const u of this.units) {
      const d = Math.hypot(u.vehicle.pos.x - playerPos.x, u.vehicle.pos.z - playerPos.z);
      if (d < 4.5 && Math.abs(u.vehicle.speed) < 4) {
        u.bustTimer = (u.bustTimer || 0) + 1;
        if (u.bustTimer > 40) return true;
      } else u.bustTimer = 0;
    }
    return false;
  }

  bustConsequences(economy) {
    const fineTable = [0, 250, 600, 1200, 2400, 4800];
    const fine = fineTable[this.level] || 250;
    const taken = economy.fine(fine, 'busted');
    const station = poi('police');
    this.clearWanted();
    return { fine: taken, spawn: { x: station.doorX ?? station.x, z: station.doorZ ?? station.z } };
  }

  hospitalConsequences(economy) {
    const bill = Math.min(economy.money, 500 + this.level * 250);
    economy.fine(bill, 'hospital');
    const h = poi('hospital');
    this.clearWanted();
    return { fee: bill, spawn: { x: h.doorX ?? h.x, z: h.doorZ ?? h.z } };
  }

  serialise() { return { heat: this.heat, level: this.level }; }
}
