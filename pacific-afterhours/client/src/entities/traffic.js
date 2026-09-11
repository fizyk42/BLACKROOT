// Ambient traffic. Cars follow the directed lane graph, stop at red lights,
// brake for whatever is in front of them, and are recycled around the player.

import * as THREE from 'three';
import { Vehicle, VEHICLES, PAINTS } from './vehicle.js';
import { CITY } from '../world/citymap.js';
import { clamp, angleDiff, damp } from '../core/util.js';
import { preset, settings } from '../core/settings.js';

const CIVILIAN_TYPES = ['sedan', 'sedan', 'sedan', 'suv', 'van', 'pickup', 'sports', 'taxi'];

export class TrafficCar {
  constructor(graph, edge, lane) {
    const type = CIVILIAN_TYPES[Math.floor(Math.random() * CIVILIAN_TYPES.length)];
    this.vehicle = new Vehicle(type, { colour: PAINTS[Math.floor(Math.random() * PAINTS.length)].hex });
    this.vehicle.driver = 'traffic';
    this.graph = graph;
    this.edge = edge;
    this.lane = lane;
    this.t = Math.random();
    this.targetSpeed = 9 + Math.random() * 5;
    this.patience = 0;
    this.active = true;
    this.honkCooldown = 0;
    const p = graph.lanePoint(edge, this.t, lane, {});
    this.vehicle.pos.set(p.x, 0, p.z);
    this.vehicle.yaw = graph.edgeHeading(edge);
    this.vehicle.speed = this.targetSpeed * 0.7;
    this.vehicle.engineOn = true;
  }

  get pos() { return this.vehicle.pos; }

  /** Point a little way further along the route, used as the steering target. */
  lookAhead(dist) {
    const e = this.edge;
    const t = this.t + dist / e.length;
    if (t <= 1) return this.graph.lanePoint(e, t, this.lane, {});
    const next = this.nextEdge || e;
    return this.graph.lanePoint(next, Math.min(1, t - 1), this.lane, {});
  }

  chooseNext() {
    const opts = this.graph.exits(this.edge.b, this.edge);
    // Prefer going straight on, so traffic reads as purposeful rather than random.
    const straight = opts.find((o) => o.dx === this.edge.dx && o.dz === this.edge.dz);
    if (straight && Math.random() < 0.62) return straight;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  update(dt, clock, colliders, allVehicles, player) {
    const v = this.vehicle;
    if (!this.nextEdge) this.nextEdge = this.chooseNext();

    const ahead = this.lookAhead(6 + Math.abs(v.speed) * 0.45);
    const dx = ahead.x - v.pos.x, dz = ahead.z - v.pos.z;
    const desired = Math.atan2(dx, dz);
    const err = angleDiff(v.yaw, desired);
    const steer = clamp(-err * 2.4, -1, 1);

    // Reasons to slow down: red light ahead, car in front, sharp turn.
    let target = this.targetSpeed;
    const distToNode = (1 - this.t) * this.edge.length;
    if (distToNode < 18 && !this.graph.canProceed(this.edge, clock)) {
      target = Math.max(0, (distToNode - 7) * 0.55);
    }
    if (Math.abs(err) > 0.35) target = Math.min(target, 7);

    // Look for anything occupying our lane in front.
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const scan = 6 + Math.abs(v.speed) * 1.15;
    let nearest = Infinity;
    for (const other of allVehicles) {
      if (other === v || !other.active) continue;
      const ox = other.pos.x - v.pos.x, oz = other.pos.z - v.pos.z;
      const along = ox * fx + oz * fz;
      if (along < 0.5 || along > scan) continue;
      const side = Math.abs(ox * fz - oz * fx);
      if (side > 1.9) continue;
      nearest = Math.min(nearest, along);
    }
    if (nearest < Infinity) {
      target = Math.min(target, Math.max(0, (nearest - 5.2) * 0.9));
      if (nearest < 6 && v.speed < 1 && this.honkCooldown <= 0 && player &&
        player.distanceTo(v.pos) < 40) {
        this.honkCooldown = 4 + Math.random() * 6;
        if (this.onHonk) this.onHonk(v.pos);
      }
    }
    this.honkCooldown -= dt;

    // Pedestrians and the player on foot count as obstacles too.
    if (player) {
      const ox = player.x - v.pos.x, oz = player.z - v.pos.z;
      const along = ox * fx + oz * fz;
      const side = Math.abs(ox * fz - oz * fx);
      if (along > 0 && along < 12 && side < 2.2) target = Math.min(target, Math.max(0, (along - 4) * 0.6));
    }

    const throttle = v.speed < target - 0.4 ? clamp((target - v.speed) * 0.35, 0, 0.8) : 0;
    const brake = v.speed > target + 0.5 ? clamp((v.speed - target) * 0.3, 0, 1) : 0;

    v.update(dt, { throttle, brake, steer, handbrake: false }, colliders, null);

    // Advance the route parameter by projecting onto the current edge.
    const a = this.graph.nodes[this.edge.a];
    const b = this.graph.nodes[this.edge.b];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    this.t = clamp(((v.pos.x - a.x) * ex + (v.pos.z - a.z) * ez) / len2, 0, 1.2);
    if (this.t >= 0.995) {
      this.edge = this.nextEdge;
      this.nextEdge = this.chooseNext();
      this.t = 0.02;
    }
  }
}

export class TrafficSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.graph = world.graph;
    this.cars = [];
    this.parked = [];
    this.spawnRadius = 190;
    this.despawnRadius = 300;
  }

  get vehicles() { return this.cars.map((c) => c.vehicle); }

  desiredCount() {
    return Math.round(preset().traffic * clamp(settings.trafficDensity, 0, 2));
  }

  /** Parked cars are real, enterable vehicles — the player can always find a ride. */
  desiredParked() { return Math.round(preset().traffic * 0.55); }

  spawnNear(playerPos, allVehicles) {
    const g = this.graph;
    for (let attempt = 0; attempt < 12; attempt++) {
      const e = g.edges[Math.floor(Math.random() * g.edges.length)];
      const lane = Math.random() < 0.5 ? 0 : 1;
      const t = Math.random();
      const p = g.lanePoint(e, t, lane, {});
      const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (d < 70 || d > this.spawnRadius) continue;
      let clear = true;
      for (const v of allVehicles) {
        if (Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < 11) { clear = false; break; }
      }
      if (!clear) continue;
      const car = new TrafficCar(g, e, lane);
      car.t = t;
      car.vehicle.pos.set(p.x, 0, p.z);
      car.vehicle.attach(this.scene);
      this.cars.push(car);
      return car;
    }
    return null;
  }

  spawnParked(playerPos, allVehicles) {
    const P = CITY.PITCH, K = CITY.KERB_HALF;
    for (let attempt = 0; attempt < 14; attempt++) {
      const i = Math.floor(Math.random() * (CITY.CELLS - 1));
      const j = Math.floor(Math.random() * (CITY.CELLS - 1));
      const alongX = Math.random() < 0.5;
      const t = 0.15 + Math.random() * 0.7;
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = CITY.ROAD_HALF - 2.2;
      const x = alongX ? i * P + t * P : i * P + side * off;
      const z = alongX ? j * P + side * off : j * P + t * P;
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (d < 22 || d > this.spawnRadius * 0.85) continue;
      let clear = true;
      for (const v of allVehicles) {
        if (Math.hypot(v.pos.x - x, v.pos.z - z) < 8) { clear = false; break; }
      }
      if (!clear) continue;
      const type = CIVILIAN_TYPES[Math.floor(Math.random() * CIVILIAN_TYPES.length)];
      const v = new Vehicle(type, { x, z });
      v.yaw = alongX ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? Math.PI : 0);
      v.attach(this.scene);
      v.parked = true;
      this.parked.push(v);
      return v;
    }
    return null;
  }

  update(dt, clock, playerPos, colliders, extraVehicles, wetness) {
    const all = this.vehicles.concat(this.parked, extraVehicles || []);
    for (const v of all) v.wet = wetness;

    // Recycle anything too far away.
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      if (Math.hypot(c.pos.x - playerPos.x, c.pos.z - playerPos.z) > this.despawnRadius) {
        c.vehicle.detach(this.scene);
        this.cars.splice(k, 1);
      }
    }
    for (let k = this.parked.length - 1; k >= 0; k--) {
      const v = this.parked[k];
      if (v.driver) { this.parked.splice(k, 1); continue; }   // player took it
      if (Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z) > this.despawnRadius) {
        v.detach(this.scene);
        this.parked.splice(k, 1);
      }
    }

    const want = this.desiredCount();
    if (this.cars.length < want) this.spawnNear(playerPos, all);
    if (this.cars.length < want - 4) this.spawnNear(playerPos, all);
    if (this.parked.length < this.desiredParked()) this.spawnParked(playerPos, all);

    for (const c of this.cars) c.update(dt, clock, colliders, all, playerPos);
    for (const v of this.parked) { v.syncMesh(dt); }
  }

  takeVehicle(vehicle) {
    const parked = this.parked.indexOf(vehicle);
    if (parked >= 0) this.parked.splice(parked, 1);
    const moving = this.cars.findIndex(car => car.vehicle === vehicle);
    if (moving >= 0) this.cars.splice(moving, 1);
  }

  clear() {
    for (const c of this.cars) c.vehicle.detach(this.scene);
    for (const v of this.parked) v.detach(this.scene);
    this.cars.length = 0;
    this.parked.length = 0;
  }
}
