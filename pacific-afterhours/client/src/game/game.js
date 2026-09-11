// The orchestrator. Owns the renderer, every system, and the frame loop.

import * as THREE from 'three';
import { World } from '../world/world.js';
import { Sky } from '../world/sky.js';
import { Player, WEAPONS } from '../entities/player.js';
import { Vehicle, VEHICLES, PAINTS } from '../entities/vehicle.js';
import { TrafficSystem } from '../entities/traffic.js';
import { PedSystem } from '../entities/peds.js';
import { Economy } from './economy.js';
import { JobSystem, Marker } from './jobs.js';
import { MissionSystem, CHARACTERS } from './missions.js';
import { PoliceSystem } from './police.js';
import { HUD } from '../ui/hud.js';
import { Overlay } from '../ui/overlay.js';
import { ShopUI, sellPrice } from '../ui/shop.js';
import { Net } from '../net/net.js';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { settings, preset, effectivePixelRatio, saveSettings } from '../core/settings.js';
import { writeSave, readSave, storageAvailable } from '../core/save.js';
import { loadCharacterAsset, OUTFITS } from '../entities/character.js';
import { clamp, damp, fmtMoney } from '../core/util.js';
import { poi, POIS, isOnRoad, CITY } from '../world/citymap.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = preset().shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 2600);
    this.camera.position.set(6, 4, 10);

    this.clock = new THREE.Clock();
    this.running = false;
    this.paused = false;
    this.mode = 'story';          // story | freeroam | online
    this.waypoint = null;
    this.missionVehicles = [];
    this.ownedVehicles = [];       // vehicles the player has physically out in the world
    this.ownedOutfits = new Set(['homecoming']);
    this.unlockedJobs = new Set();
    this.markers = [];
    this.lastJobResult = null;
    this.autoSaveTimer = 0;
    this.playtime = 0;
    this.frameStats = { fps: 60, ms: 16 };
    this.audio = audio;

    addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------------- boot
  async boot(onProgress = () => {}) {
    onProgress(0.02, 'Loading characters');
    await loadCharacterAsset('assets/characters/citizen.gltf', (p) => onProgress(0.02 + p * 0.08, 'Loading characters'));

    this.world = new World(this.scene);
    await this.world.build((p, msg) => onProgress(0.10 + p * 0.72, msg));

    onProgress(0.84, 'Raising the sky');
    this.sky = new Sky(this.scene, this.renderer, this.camera);

    onProgress(0.88, 'Waking the city');
    this.economy = new Economy();
    this.player = new Player(this.scene, this.world);
    this.traffic = new TrafficSystem(this.scene, this.world);
    this.peds = new PedSystem(this.scene, this.world);
    this.police = new PoliceSystem(this.scene, this.world);
    this.jobs = new JobSystem(this.scene, this.world, this.economy);
    this.missions = new MissionSystem(this);
    this.hud = new HUD(this);
    this.overlay = new Overlay(this);
    this.shop = new ShopUI(this);
    this.net = new Net(this);

    this.wireEvents();
    onProgress(0.96, 'Almost there');
    this.jobs.spawnCollectibles([]);
    this.resize();
    onProgress(1, 'Ready');
  }

  wireEvents() {
    this.jobs.onEvent = (e) => this.handleGameEvent(e);
    this.missions.onEvent = (e) => this.handleGameEvent(e);

    this.police.onLevelChange = (level, label) => {
      if (level > 0 && label) this.hud.toast(`${label} — wanted level ${level}`, 'bad');
      if (level === 0) this.hud.toast('You lost them.', 'good');
      audio.setSiren(level > 0);
      if (level > 0) audio.ui('alert');
    };

    this.player.onDeath = () => this.onPlayerDown('wasted');
    this.player.onFootstep = (s) => audio.footstep(s);
    this.player.onDryFire = () => audio.dryFire();
    this.player.onHorn = () => audio.horn();
    this.player.onRecover = () => this.hud.toast('Vehicle recovered to the road.', 'info');
    this.player.onDamaged = (d) => { if (d > 6) this.player.shake = Math.min(1, this.player.shake + d * 0.01); };
    this.player.onEnterVehicle = (v) => {
      if (!this.economy.ownsVehicle(v.id) && !v.missionVehicle) {
        this.police.reportCrime('stealCar', this.player.pos);
      }
    };
  }

  handleGameEvent(e) {
    switch (e.type) {
      case 'toast':
      case 'collectible':
        this.hud.toast(e.text, e.tone || 'info');
        audio.ui(e.tone === 'bad' ? 'bad' : 'cash');
        break;
      case 'job-start':
        this.hud.toast(e.text, 'info');
        this.hud.setObjective(this.jobs.active ? this.jobs.active.title : '', this.jobs.active ? this.jobs.active.objective : '');
        break;
      case 'job-complete':
        this.lastJobResult = { success: true };
        this.hud.toast(e.text, 'good');
        this.hud.setObjective('', '');
        audio.ui('cash');
        this.syncOnlineClaim(e);
        break;
      case 'job-failed':
        this.lastJobResult = { success: false };
        this.hud.toast(e.text, 'bad');
        this.hud.setObjective('', '');
        audio.ui('bad');
        break;
      case 'dialogue': {
        const c = CHARACTERS[e.speaker];
        this.hud.subtitle(c ? c.name : e.speaker, e.text, e.seconds || 3);
        break;
      }
      case 'objective':
        this.hud.setObjective(e.title, e.text, e.hint);
        break;
      case 'timer':
        this.hud.setTimer(e.seconds, e.limit);
        break;
      case 'mission-start':
        this.hud.bigMessage(e.mission.title, `Mission ${e.mission.number}`, 2.6);
        break;
      case 'mission-complete':
        this.hud.bigMessage('Mission complete', e.text, 3.4);
        this.hud.setObjective('', '');
        if (e.mission.onComplete && e.mission.onComplete.unlockJobs) {
          for (const j of e.mission.onComplete.unlockJobs) this.unlockedJobs.add(j);
        }
        if (e.note) setTimeout(() => this.hud.toast(e.note, 'good'), 2500);
        audio.ui('cash');
        this.saveGame('auto');
        break;
      case 'mission-failed':
        this.hud.bigMessage('Mission failed', e.text, 3.2);
        this.hud.setObjective('', '');
        audio.ui('bad');
        break;
    }
  }

  /** In online mode the server is the authority on payouts. */
  syncOnlineClaim(e) {
    if (this.mode !== 'online' || !this.net.connected) return;
    const job = e.job || null;
    if (!job) return;
    this.net.claim(job.id, job.kind, e.payout);
  }

  // ---------------------------------------------------------------- lifecycle
  start(mode = 'story', saveSlot = null) {
    this.mode = mode;
    this.running = true;
    this.paused = false;
    this.hud.show();
    audio.init();
    audio.resume();

    if (saveSlot) {
      this.loadGame(saveSlot);
    } else {
      this.newGame(mode);
    }
    input.requestLock();
    this.clock.getDelta();
    this.loop();
  }

  newGame(mode) {
    const shop = poi('vega_shop');
    this.economy = new Economy({ money: mode === 'freeroam' ? 25000 : 500 });
    this.jobs.economy = this.economy;
    this.missions.completed.clear();
    this.unlockedJobs = mode === 'freeroam'
      ? new Set(['delivery', 'taxi', 'race'])
      : new Set();
    this.ownedOutfits = new Set(['homecoming']);
    this.player.restore(null);
    this.player.teleport(shop.doorX ?? shop.x, 0.16, (shop.doorZ ?? shop.z) + 6, Math.PI);
    this.player.health = 100;
    this.sky.setTime(mode === 'freeroam' ? 13 : 8.5);
    this.clearWorldVehicles();

    if (mode === 'freeroam') {
      this.grantStarterCar('sports', 0xb02c22);
      this.player.giveWeapon('pistol', 60);
    } else {
      this.hud.bigMessage('San Aurelio', 'Four years is a long time', 3.4);
      setTimeout(() => {
        if (this.missions.canStart('homecoming')) this.missions.start('homecoming');
      }, 3200);
    }
  }

  grantStarterCar(specId, colour) {
    const shop = poi('vega_shop');
    const v = new Vehicle(specId, {
      colour, owned: true,
      x: (shop.doorX ?? shop.x) + 5, z: (shop.doorZ ?? shop.z) + 5,
    });
    v.attach(this.scene);
    this.ownedVehicles.push(v);
    this.economy.addVehicle(v.serialise());
    return v;
  }

  quitToMenu() {
    this.running = false;
    this.hud.hide();
    this.overlay.hide();
    this.shop.close();
    input.releaseLock();
    audio.setEngine(false);
    audio.setSiren(false);
    if (this.net.connected) this.net.disconnect();
    document.getElementById('menu').classList.remove('hidden');
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(effectivePixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.far = Math.max(900, preset().drawDistance * 1.6);
    this.camera.updateProjectionMatrix();
  }

  applyGraphics() {
    this.renderer.shadowMap.enabled = preset().shadows;
    this.resize();
  }

  // ---------------------------------------------------------------- helpers
  allVehicles() {
    const out = this.traffic.vehicles.concat(this.traffic.parked, this.ownedVehicles, this.missionVehicles);
    for (const u of this.police.units) out.push(u.vehicle);
    return out;
  }

  activeMarkers() {
    const out = this.jobs.markers.slice();
    if (this.missions.marker) out.push(this.missions.marker);
    if (this.waypoint) out.push(this.waypoint);
    return out;
  }

  makeMarker(x, z, colour, radius) {
    return new Marker(this.scene, x, z, colour, radius);
  }

  setWaypoint(w) {
    if (this.waypointMarker) { this.waypointMarker.dispose(); this.waypointMarker = null; }
    this.waypoint = w;
    if (w) this.waypointMarker = new Marker(this.scene, w.x, w.z, 0x7fe3cd, 4);
  }

  weaponName(id) { return WEAPONS[id] ? WEAPONS[id].name : id; }

  spawnMissionVehicle(step) {
    const p = poi(step.near || 'vega_shop');
    const angle = Math.random() * Math.PI * 2;
    const v = new Vehicle(step.spec, {
      colour: step.colour ?? PAINTS[0].hex,
      x: (p.doorX ?? p.x) + Math.cos(angle) * 7,
      z: (p.doorZ ?? p.z) + Math.sin(angle) * 7,
    });
    v.missionVehicle = true;
    v.attach(this.scene);
    this.missionVehicles.push(v);
    return v;
  }

  clearWorldVehicles() {
    for (const v of this.ownedVehicles) v.detach(this.scene);
    for (const v of this.missionVehicles) v.detach(this.scene);
    this.ownedVehicles.length = 0;
    this.missionVehicles.length = 0;
    this.traffic.clear();
    this.peds.clear();
    this.police.despawnAll();
  }

  // ---------------------------------------------------------------- shops & doors
  onShopOpened() { this.paused = true; input.releaseLock(); }
  onShopClosed() { this.paused = false; input.requestLock(); }

  enterInterior(id) {
    const it = this.world.interiors.get(id);
    if (!it) return;
    this.fade(() => {
      it.group.visible = true;
      this.player.interior = id;
      this.player.teleport(it.spawn.x, it.spawn.y, it.spawn.z, Math.PI);
      this.hud.toast('Press E at the door to leave.', 'info');
    });
  }

  exitInterior() {
    const id = this.player.interior;
    if (!id) return;
    const it = this.world.interiors.get(id);
    const p = poi(id);
    this.fade(() => {
      it.group.visible = false;
      this.player.interior = null;
      this.player.teleport(p.doorX ?? p.x, 0.16, (p.doorZ ?? p.z) + 1.5, (p.ry || 0) + Math.PI);
    });
  }

  fade(mid) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:#04090d;opacity:0;z-index:60;transition:opacity .28s;pointer-events:none';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      mid();
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, 300);
  }

  /** What can the player interact with right now? */
  findInteraction() {
    const p = this.player;
    if (p.interior) {
      const it = this.world.interiors.get(p.interior);
      const d = Math.hypot(p.pos.x - it.exit.x, p.pos.z - it.exit.z);
      if (d < 2.6) return { kind: 'exit-interior', label: 'Leave' };
      return null;
    }
    if (p.vehicle) return { kind: 'exit-vehicle', label: 'Get out' };

    // Nearest enterable vehicle.
    let best = null, bestD = 3.4;
    for (const v of this.allVehicles()) {
      if (v.driver) continue;
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best) {
      return {
        kind: 'enter-vehicle', vehicle: best,
        label: this.economy.ownsVehicle(best.id) ? `Get in — ${best.displayName}` : `Take the ${best.displayName}`,
      };
    }

    const door = this.world.doorAt(p.pos.x, p.pos.z);
    if (door) return { kind: 'door', poi: door.poi, label: door.poi.name };
    return null;
  }

  // ---------------------------------------------------------------- economy actions
  buyVehicle(specId) {
    const spec = VEHICLES[specId];
    if (!spec) return { ok: false, message: 'Unknown vehicle.' };
    if (this.economy.vehicleList.length >= this.economy.garageCapacity()) {
      return { ok: false, message: 'No garage space. Buy property or sell something.' };
    }
    const r = this.economy.spend(spec.price, 'vehicle');
    if (!r.ok) return { ok: false, message: 'Not enough money.' };
    const dealer = poi('dealer');
    const v = new Vehicle(specId, {
      owned: true, x: (dealer.doorX ?? dealer.x) + 6, z: (dealer.doorZ ?? dealer.z) + 4,
    });
    v.attach(this.scene);
    this.ownedVehicles.push(v);
    this.economy.addVehicle(v.serialise());
    if (this.mode === 'online' && this.net.connected) {
      this.net.buyVehicle(v.id, specId, v.colour, spec.price);
    }
    this.hud.toast(`${spec.name} purchased. It is out front.`, 'good');
    return { ok: true, vehicle: v };
  }

  sellVehicle(id) {
    const data = this.economy.vehicles.get(id);
    if (!data) return { ok: false };
    const price = sellPrice(data);
    this.economy.removeVehicle(id);
    this.economy.credit(price, 'sell-vehicle');
    const idx = this.ownedVehicles.findIndex((v) => v.id === id);
    if (idx >= 0) {
      if (this.player.vehicle === this.ownedVehicles[idx]) this.player.exitVehicle(true);
      this.ownedVehicles[idx].detach(this.scene);
      this.ownedVehicles.splice(idx, 1);
    }
    return { ok: true, price };
  }

  retrieveVehicle(id) {
    const data = this.economy.vehicles.get(id);
    if (!data) return { ok: false, message: 'Not in your garage.' };
    if (this.ownedVehicles.some((v) => v.id === id)) return { ok: false, message: 'Already out.' };
    const p = this.player.pos;
    const v = Vehicle.deserialise(Object.assign({}, data, {
      x: p.x + Math.sin(this.player.yaw) * 7,
      z: p.z + Math.cos(this.player.yaw) * 7,
      yaw: this.player.yaw,
    }));
    v.attach(this.scene);
    this.ownedVehicles.push(v);
    return { ok: true, vehicle: v };
  }

  // ---------------------------------------------------------------- death & arrest
  onPlayerDown(reason) {
    const consequences = reason === 'busted'
      ? this.police.bustConsequences(this.economy)
      : this.police.hospitalConsequences(this.economy);
    this.jobs.cancel(reason === 'busted' ? 'you were arrested' : 'you were hospitalised');
    if (this.missions.active) this.missions.fail(reason === 'busted' ? 'Arrested.' : 'You did not make it.');

    this.hud.bigMessage(reason === 'busted' ? 'Busted' : 'Wasted',
      reason === 'busted'
        ? `Fine: ${fmtMoney(consequences.fine)}`
        : `Medical bill: ${fmtMoney(consequences.fee)}`, 3.4);
    audio.ui('bad');

    setTimeout(() => {
      const s = consequences.spawn;
      this.player.revive(s.x, s.z + 4);
      this.player.dead = false;
      this.sky.hours = (this.sky.hours + 1.5) % 24;
      this.saveGame('auto');
    }, 3400);
  }

  // ---------------------------------------------------------------- save/load
  saveGame(slot = 'auto') {
    if (this.mode === 'online') {
      return { ok: false, error: 'Online progress is stored on the server, not locally.' };
    }
    if (!storageAvailable()) return { ok: false, error: 'Browser storage is unavailable.' };
    // Keep garage records in step with what is physically parked in the world.
    for (const v of this.ownedVehicles) this.economy.updateVehicle(v.serialise());
    const data = {
      mode: this.mode,
      playtime: Math.round(this.playtime),
      economy: this.economy.serialise(),
      player: this.player.serialise(),
      missions: this.missions.serialise(),
      jobs: this.jobs.serialise(),
      police: this.police.serialise(),
      world: { hours: this.sky.hours, weather: this.sky.weather },
      unlockedJobs: [...this.unlockedJobs],
      outfits: [...this.ownedOutfits],
    };
    return writeSave(slot, data);
  }

  loadGame(slot) {
    const d = readSave(slot);
    if (!d) { this.hud.toast('That save could not be read.', 'bad'); return false; }

    this.clearWorldVehicles();
    this.economy = Economy.deserialise(d.economy);
    this.jobs.economy = this.economy;
    this.missions.restore(d.missions);
    this.unlockedJobs = new Set(d.unlockedJobs || []);
    this.ownedOutfits = new Set(d.outfits || ['homecoming']);
    this.playtime = d.playtime || 0;

    this.player.restore(d.player);
    this.player.interior = null;
    this.sky.setTime(d.world?.hours ?? 9);
    if (d.world?.weather) this.sky.setWeather(d.world.weather, true);

    // Collectibles already picked up stay picked up.
    for (const c of this.jobs.collectibles) { this.scene.remove(c.mesh); }
    this.jobs.collectibles.length = 0;
    this.jobs.spawnCollectibles(d.jobs?.collected || []);
    this.jobs.jobCounter = d.jobs?.jobCounter || 0;

    // Put one owned vehicle out front so the player is not stranded.
    const first = this.economy.vehicleList[0];
    if (first) {
      const v = Vehicle.deserialise(Object.assign({}, first, {
        x: this.player.pos.x + 6, z: this.player.pos.z + 3, yaw: this.player.yaw,
      }));
      v.attach(this.scene);
      this.ownedVehicles.push(v);
    }

    this.police.heat = 0;
    this.police.level = 0;
    this.hud.toast('Loaded.', 'good');
    this.mode = d.mode === 'online' ? 'story' : (d.mode || 'story');
    return true;
  }

  // ---------------------------------------------------------------- crime watch
  updateCrime(dt) {
    const p = this.player;
    // Speeding past police.
    if (p.vehicle && Math.abs(p.vehicle.speed) > 33) {
      for (const u of this.police.units) {
        if (Math.hypot(u.vehicle.pos.x - p.pos.x, u.vehicle.pos.z - p.pos.z) < 45) {
          this.police.reportCrime('speeding', p.pos);
          break;
        }
      }
    }
    // Running people over.
    if (p.vehicle && Math.abs(p.vehicle.speed) > 3) {
      const hit = this.peds.nearest(p.vehicle.pos.x, p.vehicle.pos.z, p.vehicle.spec.length * 0.5);
      if (hit) {
        const force = Math.abs(p.vehicle.speed);
        const killed = hit.hurt(force * 3.5, p.vehicle.pos.x, p.vehicle.pos.z);
        this.peds.scareNear(p.pos.x, p.pos.z, 26, 7);
        this.police.reportCrime(killed ? 'killPed' : 'hitPed', p.pos);
        audio.impact(1.4);
        p.vehicle.speed *= 0.82;
      }
    }
    // Crashing into other cars while police are watching.
    if (p.vehicle && p.vehicle.lastImpact > 10) {
      this.police.reportCrime('hitCar', p.pos);
    }
    // Getting arrested on foot.
    if (this.police.checkBust(p.pos, !!p.vehicle)) this.onPlayerDown('busted');
  }

  onShot(player, weapon, origin, dir) {
    audio.gunshot(weapon.id === 'smg');
    this.peds.scareNear(player.pos.x, player.pos.z, 30, 8);
    this.police.reportCrime('fireWeapon', player.pos);

    // Hit detection against pedestrians and police units.
    const end = origin.clone().addScaledVector(dir, weapon.range);
    let bestT = 1, hit = null;
    for (const ped of this.peds.peds) {
      const t = raySegmentHit(origin, dir, weapon.range, ped.pos, 0.45);
      if (t !== null && t < bestT) { bestT = t; hit = { kind: 'ped', ref: ped }; }
    }
    for (const u of this.police.units) {
      const t = raySegmentHit(origin, dir, weapon.range, u.vehicle.pos, 1.4);
      if (t !== null && t < bestT) { bestT = t; hit = { kind: 'police', ref: u }; }
    }
    if (!hit) return;
    if (hit.kind === 'ped') {
      const killed = hit.ref.hurt(weapon.damage, origin.x, origin.z);
      this.police.reportCrime(killed ? 'killPed' : 'hitPed', player.pos);
    } else {
      hit.ref.vehicle.health = Math.max(0, hit.ref.vehicle.health - weapon.damage * 0.7);
      hit.ref.vehicle.dent(dir.x, dir.z, weapon.damage);
      this.police.reportCrime('assaultPolice', player.pos);
    }
  }

  onMelee(player, weapon) {
    audio.punch();
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const tx = player.pos.x + fx * 1.1, tz = player.pos.z + fz * 1.1;
    const ped = this.peds.nearest(tx, tz, 1.3);
    if (ped) {
      const killed = ped.hurt(weapon.damage, player.pos.x, player.pos.z);
      this.peds.scareNear(player.pos.x, player.pos.z, 14, 6);
      this.police.reportCrime(killed ? 'killPed' : 'hitPed', player.pos);
    }
  }

  // ---------------------------------------------------------------- frame
  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.step(dt);
  }

  step(dt) {
    const t0 = performance.now();
    input.update(dt, this.player.vehicle ? 'vehicle' : 'foot');
    const menuInput = this.controllerUI?.update(dt) || false;

    // Global keys work even while paused.
    if (!menuInput && input.pressed('pause')) {
      if (this.shop.open) this.shop.close();
      else if (this.overlay.open) { this.overlay.hide(); this.paused = false; input.requestLock(); }
      else { this.overlay.show('map'); this.paused = true; input.releaseLock(); }
      audio.ui('cancel');
    }
    if (!menuInput && !this.shop.open) {
      if (input.pressed('map')) { this.overlay.toggle('map'); this.paused = this.overlay.open; this.paused ? input.releaseLock() : input.requestLock(); }
      if (input.pressed('journal')) { this.overlay.toggle('journal'); this.paused = this.overlay.open; this.paused ? input.releaseLock() : input.requestLock(); }
      if (input.pressed('phone')) { this.overlay.toggle('stats'); this.paused = this.overlay.open; this.paused ? input.releaseLock() : input.requestLock(); }
    }

    if (!this.paused && !menuInput) this.simulate(dt);

    this.net.update(dt);
    this.hud.update(dt, this);
    if (this.mode === 'online') {
      const lines = [`room <span class="code">${this.net.code || '—'}</span>`, `ping ${this.net.ping}ms`]
        .concat(this.net.roster.map((r) => `<b>${r.name}</b>${r.host ? ' (host)' : ''}`));
      this.hud.setRoster(lines);
    }

    this.renderer.render(this.scene, this.camera);
    input.endFrame();

    const ms = performance.now() - t0;
    this.frameStats.ms = damp(this.frameStats.ms, ms, 3, dt);
    this.frameStats.fps = damp(this.frameStats.fps, 1 / Math.max(dt, 0.0001), 3, dt);
  }

  simulate(dt) {
    this.playtime += dt;
    const p = this.player;
    const prevHours = this.sky.hours;

    // --- world ---
    const skyState = this.sky.update(dt, this.camera.position);
    this.world.setNightAmount(skyState.night);
    this.world.setWetness(skyState.wetness);
    this.world.updateLightPool(p.pos, skyState.night);
    this.world.updateStreaming(p.pos);
    this.world.animateOcean(this.playtime);
    this.world.updateSignals(this.playtime);
    audio.setRain(skyState.wetness);

    let hoursElapsed = this.sky.hours - prevHours;
    if (hoursElapsed < 0) hoursElapsed += 24;
    this.economy.tickBusinesses(hoursElapsed);

    // --- entities ---
    const others = this.allVehicles();
    p.update(dt, input, this.camera, this.world.colliders, {
      colliders: this.world.colliders,
      otherVehicles: others.filter((v) => v !== p.vehicle),
      input,
      onShot: (pl, w, o, d) => this.onShot(pl, w, o, d),
      onMelee: (pl, w) => this.onMelee(pl, w),
    });

    if (!p.interior) {
      this.traffic.update(dt, this.playtime, p.pos, this.world.colliders, this.ownedVehicles.concat(this.missionVehicles), skyState.wetness);
      this.peds.update(dt, p.pos, { vehicles: others });
      this.police.update(dt, p.pos, p.vehicle, this.world.colliders, others);
      this.updateCrime(dt);
    }

    for (const v of this.ownedVehicles.concat(this.missionVehicles)) {
      if (v.driver === 'player') continue;
      v.syncMesh(dt);
    }

    // Headlights come on automatically at dusk.
    if (p.vehicle && !p.vehicle._manualLights) p.vehicle.headlights = skyState.night > 0.35;

    // --- systems ---
    this.jobs.update(dt, p, this);
    this.missions.update(dt);
    if (this.jobs.active) this.hud.setTimer(this.jobs.active.timeLeft, this.jobs.active.timeLimit);

    // --- interaction ---
    this.updateInteraction();

    // --- audio ---
    if (p.vehicle) {
      audio.setEngine(true, p.vehicle.rpm, Math.abs(input.axes.throttle));
      audio.setSkid(p.vehicle.skid * clamp(Math.abs(p.vehicle.speed) / 8, 0, 1));
      if (p.vehicle.lastImpact > 3) { audio.impact(clamp(p.vehicle.lastImpact / 12, 0.2, 2)); p.vehicle.lastImpact = 0; }
    } else {
      audio.setEngine(false);
      audio.setSkid(0);
    }

    // --- autosave ---
    if (this.mode !== 'online' && settings.autoSaveMinutes > 0) {
      this.autoSaveTimer += dt;
      if (this.autoSaveTimer > settings.autoSaveMinutes * 60) {
        this.autoSaveTimer = 0;
        const r = this.saveGame('auto');
        if (r.ok) this.hud.toast('Autosaved.', 'info');
      }
    }
  }

  updateInteraction() {
    const act = this.findInteraction();
    if (!act) { this.hud.setPrompt(null); return; }
    this.hud.setPrompt(`<key>${input.glyph('interact')}</key>${act.label}`);
    if (!input.pressed('interact')) return;

    switch (act.kind) {
      case 'exit-vehicle': this.player.exitVehicle(); break;
      case 'enter-vehicle':
        if (this.player.enterVehicle(act.vehicle)) audio.ui('accept');
        break;
      case 'exit-interior': this.exitInterior(); break;
      case 'door': {
        const p = act.poi;
        if (p.kind === 'landmark') { this.hud.toast(p.name, 'info'); break; }
        this.shop.show(p);
        audio.ui('accept');
        break;
      }
    }
  }
}

/** Distance along a ray at which it passes within `radius` of a point, or null. */
function raySegmentHit(origin, dir, maxDist, point, radius) {
  const ox = point.x - origin.x, oy = (point.y ?? 0) + 0.9 - origin.y, oz = point.z - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0 || t > maxDist) return null;
  const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
  if (cx * cx + cy * cy + cz * cz > radius * radius) return null;
  return t / maxDist;
}
