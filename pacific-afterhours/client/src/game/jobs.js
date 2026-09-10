// Freelance work — the money loop that exists outside the story.
// Every payout goes through economy.claim() with a unique id, so a job can never
// be banked twice, whatever the player does with saves or reconnects.

import * as THREE from 'three';
import { CITY, POIS, poi, collectibleSpots } from '../world/citymap.js';
import { clamp, fmtMoney, makeRng } from '../core/util.js';
import { difficulty } from '../core/settings.js';

// ------------------------------------------------------------------ markers

export class Marker {
  constructor(scene, x, z, colour = 0xffb347, radius = 3.2, height = 6) {
    this.scene = scene;
    const geo = new THREE.CylinderGeometry(radius, radius, height, 22, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.24,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, height / 2, z);
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);

    const ringGeo = new THREE.RingGeometry(radius * 0.82, radius, 30);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.ring.position.set(x, 0.22, z);
    scene.add(this.ring);

    this.x = x; this.z = z; this.radius = radius;
    this.t = 0;
  }
  move(x, z) {
    this.x = x; this.z = z;
    this.mesh.position.x = x; this.mesh.position.z = z;
    this.ring.position.x = x; this.ring.position.z = z;
  }
  update(dt) {
    this.t += dt;
    this.ring.rotation.y += dt * 0.8;
    this.mesh.material.opacity = 0.18 + Math.sin(this.t * 2.2) * 0.07;
    this.ring.scale.setScalar(1 + Math.sin(this.t * 2.2) * 0.04);
  }
  contains(x, z, extra = 0) {
    return (x - this.x) ** 2 + (z - this.z) ** 2 < (this.radius + extra) ** 2;
  }
  dispose() {
    this.scene.remove(this.mesh, this.ring);
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.ring.geometry.dispose(); this.ring.material.dispose();
  }
}

// ------------------------------------------------------------------ job system

const DELIVERY_NAMES = [
  'a sealed document tube', 'two boxes of engine parts', 'a catering order',
  'somebody\'s forgotten laptop', 'a crate of vinyl records', 'refrigerated medical samples',
  'a wedding cake, do not brake hard', 'three bags of laundry',
];

const PASSENGER_LINES = [
  'Quick as you can, I am already late.',
  'Take the coast road if you can, I like the water.',
  'No talking, no radio, thanks.',
  'You know a shortcut? Ten dollars says you do not.',
];

export class JobSystem {
  constructor(scene, world, economy) {
    this.scene = scene;
    this.world = world;
    this.economy = economy;
    this.active = null;
    this.markers = [];
    this.collectibles = [];
    this.collected = new Set();
    this.jobCounter = 0;
    this.races = buildRaces(world.graph);
    this.onEvent = () => {};
  }

  // -------------------------------------------------------------- collectibles
  spawnCollectibles(alreadyCollected = []) {
    this.collected = new Set(alreadyCollected);
    const spots = collectibleSpots(20);
    for (const s of spots) {
      if (this.collected.has(s.id)) continue;
      const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 14);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd8d2c6, emissive: 0x7fe3cd, emissiveIntensity: 1.1, metalness: 0.7, roughness: 0.3,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, 1.1, s.z);
      m.rotation.x = Math.PI / 2;
      this.scene.add(m);
      this.collectibles.push({ id: s.id, mesh: m, x: s.x, z: s.z, index: s.index });
    }
  }

  updateCollectibles(dt, playerPos) {
    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const c = this.collectibles[i];
      c.mesh.rotation.z += dt * 1.6;
      c.mesh.position.y = 1.1 + Math.sin(performance.now() * 0.002 + c.index) * 0.12;
      if ((c.x - playerPos.x) ** 2 + (c.z - playerPos.z) ** 2 < 2.6 * 2.6) {
        const r = this.economy.claim('collectible_' + c.id, 250, { kind: 'collectible' });
        this.collected.add(c.id);
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose(); c.mesh.material.dispose();
        this.collectibles.splice(i, 1);
        if (r.ok) {
          this.onEvent({
            type: 'collectible',
            text: `Film reel ${this.collected.size} of 20 — ${fmtMoney(250)}`,
            tone: 'good',
          });
          if (this.collected.size === 20) {
            const bonus = this.economy.claim('collectible_all', 12000, { kind: 'collectible-bonus' });
            if (bonus.ok) this.onEvent({ type: 'collectible', text: `All twenty reels found — ${fmtMoney(12000)} bonus`, tone: 'good' });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- job control
  clearMarkers() {
    for (const m of this.markers) m.dispose();
    this.markers.length = 0;
  }

  cancel(reason = 'Cancelled') {
    if (!this.active) return;
    const job = this.active;
    this.active = null;
    this.clearMarkers();
    this.onEvent({ type: 'job-failed', text: `${job.title}: ${reason}`, tone: 'bad' });
  }

  randomFarPoint(fromX, fromZ, minDist = 220) {
    const P = CITY.PITCH;
    for (let a = 0; a < 40; a++) {
      const i = Math.floor(Math.random() * CITY.CELLS);
      const j = Math.floor(Math.random() * CITY.CELLS);
      const x = i * P + (Math.random() - 0.5) * 20;
      const z = j * P + (Math.random() - 0.5) * 20;
      if (Math.hypot(x - fromX, z - fromZ) > minDist) return { x, z };
    }
    return { x: fromX + minDist, z: fromZ };
  }

  /** Courier run: collect at the depot, deliver across town against the clock. */
  startDelivery(playerPos) {
    if (this.active) return { ok: false, reason: 'busy' };
    this.jobCounter++;
    const dest = this.randomFarPoint(playerPos.x, playerPos.z, 260);
    const dist = Math.hypot(dest.x - playerPos.x, dest.z - playerPos.z);
    const base = Math.round(120 + dist * 1.35);
    const limit = (dist / 13 + 30) * difficulty().jobTime;
    const id = `job_delivery_${Date.now()}_${this.jobCounter}`;
    this.active = {
      id, kind: 'delivery', title: 'Courier run',
      cargo: DELIVERY_NAMES[Math.floor(Math.random() * DELIVERY_NAMES.length)],
      objective: 'Deliver the parcel',
      timeLeft: limit, timeLimit: limit,
      reward: base, bonus: Math.round(base * 0.35),
      needsVehicle: true, stage: 'deliver',
    };
    this.markers.push(new Marker(this.scene, dest.x, dest.z, 0xffb347, 4.5));
    this.onEvent({
      type: 'job-start',
      text: `Courier run — ${this.active.cargo}. ${fmtMoney(base)} on delivery.`,
      tone: 'info',
    });
    return { ok: true, job: this.active };
  }

  /** Taxi: drive to the fare, then to where they are going. */
  startTaxi(playerPos) {
    if (this.active) return { ok: false, reason: 'busy' };
    this.jobCounter++;
    const pickup = this.randomFarPoint(playerPos.x, playerPos.z, 90);
    const drop = this.randomFarPoint(pickup.x, pickup.z, 240);
    const dist = Math.hypot(drop.x - pickup.x, drop.z - pickup.z);
    const id = `job_taxi_${Date.now()}_${this.jobCounter}`;
    this.active = {
      id, kind: 'taxi', title: 'Fare',
      objective: 'Pick up the fare',
      pickup, drop,
      line: PASSENGER_LINES[Math.floor(Math.random() * PASSENGER_LINES.length)],
      timeLeft: 0, timeLimit: 0,
      reward: Math.round(90 + dist * 1.1), bonus: 0,
      needsVehicle: true, stage: 'pickup',
    };
    this.markers.push(new Marker(this.scene, pickup.x, pickup.z, 0x7fe3cd, 4.0));
    this.onEvent({ type: 'job-start', text: 'Fare waiting. Marker on the map.', tone: 'info' });
    return { ok: true, job: this.active };
  }

  /** Street race around a fixed circuit of checkpoints. */
  startRace(raceId, playerPos) {
    if (this.active) return { ok: false, reason: 'busy' };
    const race = this.races.find((r) => r.id === raceId) || this.races[0];
    this.jobCounter++;
    const id = `job_race_${race.id}_${Date.now()}`;
    this.active = {
      id, kind: 'race', title: race.name,
      objective: `Checkpoint 1 of ${race.checkpoints.length}`,
      race, checkpointIndex: 0, lap: 1, laps: race.laps,
      timeLeft: race.parTime * difficulty().jobTime, timeLimit: race.parTime * difficulty().jobTime,
      reward: race.prize, bonus: Math.round(race.prize * 0.5),
      needsVehicle: true, stage: 'race', bestSplit: 0,
    };
    const c = race.checkpoints[0];
    this.markers.push(new Marker(this.scene, c.x, c.z, 0xff5145, 6.5, 9));
    this.onEvent({ type: 'job-start', text: `${race.name} — ${race.laps} lap${race.laps > 1 ? 's' : ''}, ${fmtMoney(race.prize)}`, tone: 'info' });
    return { ok: true, job: this.active };
  }

  /** Repossession: find a specific vehicle in the city and bring it to the shop. */
  startRecovery(vehicleRef, dropPoiId = 'vega_shop') {
    if (this.active) return { ok: false, reason: 'busy' };
    this.jobCounter++;
    const drop = poi(dropPoiId);
    const id = `job_recovery_${Date.now()}_${this.jobCounter}`;
    this.active = {
      id, kind: 'recovery', title: 'Repossession',
      objective: 'Find the vehicle',
      targetVehicle: vehicleRef,
      dropX: drop.doorX ?? drop.x, dropZ: drop.doorZ ?? drop.z,
      timeLeft: 0, timeLimit: 0,
      reward: 900, bonus: 400,
      needsVehicle: false, stage: 'find',
    };
    this.markers.push(new Marker(this.scene, vehicleRef.pos.x, vehicleRef.pos.z, 0xffb347, 4.0));
    this.onEvent({ type: 'job-start', text: 'Repossession job. The car is marked.', tone: 'info' });
    return { ok: true, job: this.active };
  }

  // -------------------------------------------------------------- per-frame
  update(dt, player, ctx) {
    for (const m of this.markers) m.update(dt);
    this.updateCollectibles(dt, player.pos);

    const job = this.active;
    if (!job) return;

    if (job.timeLimit > 0) {
      job.timeLeft -= dt;
      if (job.timeLeft <= 0) {
        this.finish(false, 'out of time');
        return;
      }
    }

    const px = player.pos.x, pz = player.pos.z;
    const inCar = !!player.vehicle;

    if (job.kind === 'delivery') {
      const m = this.markers[0];
      if (m && m.contains(px, pz, 1.5)) this.finish(true);
      return;
    }

    if (job.kind === 'taxi') {
      const m = this.markers[0];
      if (!m) return;
      if (job.stage === 'pickup') {
        if (m.contains(px, pz, 1.5) && inCar && Math.abs(player.vehicle.speed) < 3) {
          job.stage = 'drop';
          job.objective = 'Drop the fare off';
          m.dispose();
          this.markers[0] = new Marker(this.scene, job.drop.x, job.drop.z, 0x7fe3cd, 4.0);
          this.onEvent({ type: 'dialogue', speaker: 'Passenger', text: job.line });
        }
      } else if (m.contains(px, pz, 1.5) && inCar && Math.abs(player.vehicle.speed) < 3) {
        this.finish(true);
      }
      return;
    }

    if (job.kind === 'race') {
      const m = this.markers[0];
      if (!m) return;
      if (!inCar) {
        job.onFootTimer = (job.onFootTimer || 0) + dt;
        if (job.onFootTimer > 12) { this.finish(false, 'you left the car'); return; }
      } else job.onFootTimer = 0;

      if (m.contains(px, pz, 2.5)) {
        job.checkpointIndex++;
        if (job.checkpointIndex >= job.race.checkpoints.length) {
          job.checkpointIndex = 0;
          job.lap++;
          if (job.lap > job.laps) { this.finish(true); return; }
          this.onEvent({ type: 'toast', text: `Lap ${job.lap} of ${job.laps}`, tone: 'info' });
        }
        const c = job.race.checkpoints[job.checkpointIndex];
        m.move(c.x, c.z);
        job.objective = `Checkpoint ${job.checkpointIndex + 1} of ${job.race.checkpoints.length} — lap ${job.lap}/${job.laps}`;
        job.timeLeft = Math.min(job.timeLimit, job.timeLeft + job.race.checkpointBonus);
      }
      return;
    }

    if (job.kind === 'recovery') {
      const target = job.targetVehicle;
      const m = this.markers[0];
      if (job.stage === 'find') {
        if (m) m.move(target.pos.x, target.pos.z);
        if (player.vehicle === target) {
          job.stage = 'return';
          job.objective = 'Return it to the shop';
          if (m) m.move(job.dropX, job.dropZ);
        }
      } else if (m && m.contains(px, pz, 3) && player.vehicle === target && Math.abs(target.speed) < 2) {
        job.bonus = target.health > 85 ? job.bonus : 0;
        this.finish(true);
      }
      return;
    }
  }

  finish(success, reason = '') {
    const job = this.active;
    if (!job) return;
    this.active = null;
    this.clearMarkers();

    if (!success) {
      this.onEvent({ type: 'job-failed', text: `${job.title} failed — ${reason}.`, tone: 'bad' });
      return;
    }

    let payout = job.reward;
    let bonusEarned = false;
    if (job.bonus > 0 && (job.timeLimit === 0 || job.timeLeft > job.timeLimit * 0.35)) {
      payout += job.bonus;
      bonusEarned = true;
    }
    payout = Math.round(payout * difficulty().payout);

    const res = this.economy.claim(job.id, payout, { kind: job.kind });
    if (!res.ok) {
      // Should be impossible in normal play; surfaced rather than silently swallowed.
      this.onEvent({ type: 'toast', text: 'That job was already paid out.', tone: 'bad' });
      return;
    }
    this.economy.stats.jobs++;
    this.onEvent({
      type: 'job-complete',
      text: `${job.title} complete — ${fmtMoney(payout)}${bonusEarned ? ' (on time bonus)' : ''}`,
      tone: 'good',
      payout,
      job,
    });
  }

  serialise() {
    return { collected: [...this.collected], jobCounter: this.jobCounter };
  }
}

// ------------------------------------------------------------------ race routes

function buildRaces(graph) {
  const P = CITY.PITCH;
  const ring = (cells, laps, name, id, prize, par) => ({
    id, name, laps, prize, parTime: par, checkpointBonus: 6,
    checkpoints: cells.map(([i, j]) => ({ x: i * P, z: j * P })),
  });
  return [
    ring([[1, 8], [1, 10], [4, 10], [4, 8]], 2, 'Pier Lot Sprint', 'race_pier', 2200, 95),
    ring([[3, 3], [3, 7], [6, 7], [6, 3]], 2, 'Downtown Loop', 'race_downtown', 3800, 130),
    ring([[8, 1], [10, 1], [10, 5], [8, 5], [8, 3]], 3, 'Docks Circuit', 'race_docks', 5600, 210),
    ring([[6, 8], [9, 8], [10, 10], [6, 10]], 2, 'Ridge Line Run', 'race_ridge', 4400, 150),
  ];
}
