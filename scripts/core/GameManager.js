/**
 * GameManager — the spine. Owns the renderer, the two render passes (world and
 * viewmodel), the fixed game state machine, and the frame loop that drives
 * every other system in the right order.
 */
import * as THREE from 'three';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { Pad } from './Gamepad.js';
import { Audio } from './AudioManager.js';
import { makeRNG } from './RNG.js';
import { nightEnvironment } from '../world/Textures.js';

import { WorldManager } from '../world/WorldManager.js';
import { biomeOrder, getBiome, depthScaling } from '../world/Biomes.js';
import { bossForBiome } from '../entities/Bosses.js';
import { Waypoints } from '../systems/Waypoints.js';
import { Sandbox } from '../systems/Sandbox.js';
import { ModMenu } from '../ui/ModMenu.js';
import { PlayerController } from '../player/PlayerController.js';
import { PlayerStats } from '../player/PlayerStats.js';
import { Flashlight } from '../player/Flashlight.js';
import { Inventory } from '../systems/InventorySystem.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { DamageSystem } from '../systems/DamageSystem.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { LootSystem } from '../systems/LootSystem.js';
import { HorrorDirector } from '../systems/HorrorDirector.js';
import { SaveManager } from '../systems/SaveManager.js';
import { FXSystem } from '../systems/FX.js';
import { EntityManager } from '../entities/EntityManager.js';
import { Armoury } from '../systems/Armoury.js';
import { NetClient } from '../net/NetClient.js';
import { CoopMenu } from '../ui/CoopMenu.js';
import { UIManager } from '../ui/UIManager.js';
import { ITEMS, startingLoadout } from '../systems/ItemDatabase.js';

export const GameState = {
  BOOT: 'BOOT', MENU: 'MENU', LOADING: 'LOADING', PLAYING: 'PLAYING',
  PAUSED: 'PAUSED', DEAD: 'DEAD',
};

export class GameManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = Settings;
    this.input = Input;
    this.state = GameState.BOOT;
    this.time = 0;
    this.frame = 0;
    this._pauseReasons = new Set();
    this._accum = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;

    this.initRenderer();

    this.scene = new THREE.Scene();
    this.baseFov = 74;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.08, 1200);
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(72, 1, 0.01, 6);

    // The viewmodel gets its own light rig so it reads regardless of the world.
    const vAmbient = new THREE.AmbientLight(0x707d8e, 1.5);
    const vKey = new THREE.DirectionalLight(0xdfeaf8, 3.2);
    vKey.position.set(0.75, 0.85, 0.55);
    const vRim = new THREE.DirectionalLight(0x9ab4d6, 1.9);
    vRim.position.set(-0.8, 0.2, -0.7);
    // warm bounce from the lamp the player is holding, so the weapon reads
    // as being lit by the same light source as the world
    const vBounce = new THREE.DirectionalLight(0xffd8a8, 0.9);
    vBounce.position.set(0.2, -0.9, 0.6);
    this.viewScene.add(vAmbient, vKey, vRim, vBounce);
    this.viewLights = { vAmbient, vKey, vRim, vBounce };

    // Shared night environment: without it, metalness renders black.
    this.envMap = nightEnvironment(this.renderer);
    this.viewScene.environment = this.envMap;

    this.stats = new PlayerStats(Settings.difficulty());
    this.inventory = new Inventory();
    this.save = new SaveManager(this);
    this.ui = new UIManager(this);
    // The armoury outlives any single run: builds, finishes, tuning and the
    // operator are yours, not the world's.
    this.armoury = new Armoury(this);
    // The sandbox and its menu outlive any one run, like the armoury.
    this.sandbox = new Sandbox(this);
    this.modMenu = new ModMenu(this);
    // Co-op is a session that survives biome changes and even a world rebuild,
    // so the socket and the lobby are owned here rather than by a run.
    this.net = new NetClient(this);
    this.coop = new CoopMenu(this);
    this._bindNet();
    this.timeScale = 1;
    this.fx = null;

    Input.attach(canvas);
    Input.onKey((code, e) => this.onKeyDown(code, e));
    Input.onLockChange((locked) => {
      // A controller player never holds pointer lock, so only the mouse path
      // treats losing it as "the player alt-tabbed away" — and neither does a
      // player on cursor look, who never had the lock to lose.
      if (!locked && this.state === GameState.PLAYING && !Pad.connected && !Input.softLook) this.pause();
    });
    // The look system tells the player when it has had to change how it works;
    // silently falling back is what makes it feel broken.
    Input.onLookNotice((kind, message) => {
      this.ui?.toast(message, kind === 'failed' ? 'bad' : 'warn');
      if (kind !== 'trackpad') this.ui?.subtitle(message);
    });
    Pad.onChange((connected, brand) => {
      if (connected) this.ui.toast(`${brand === 'playstation' ? 'DualSense' : 'Controller'} connected`, 'good');
      else this.ui.toast('Controller disconnected', 'warn');
      this.ui.refreshGlyphs?.();
    });

    window.addEventListener('resize', () => this.onResize());
    Settings.onChange((k) => this.onSettingChanged(k));
    this.onResize();

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ================= renderer ================= */

  initRenderer() {
    const opts = {
      canvas: this.canvas,
      antialias: Settings.get('antialias'),
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    };
    this.renderer = new THREE.WebGLRenderer(opts);
    this.renderer.setClearColor(0x05070a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = Settings.get('shadows') !== 'off';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    // Two render passes per frame, so counters are reset manually once per
    // frame instead of at the start of every render() call.
    this.renderer.info.autoReset = false;
  }

  onResize() {
    const scale = Settings.get('renderScale');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(dpr * scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  onSettingChanged(key) {
    if (key === 'renderScale') this.onResize();
    if (key === 'shadows') {
      this.renderer.shadowMap.enabled = Settings.get('shadows') !== 'off';
      this.world?.applyGraphics();
      this.flashlight?.applyQuality();
    }
    if (key === 'viewDistance' || key === 'fogQuality' || key === 'brightness' || key === 'ambientFill') this.world?.applyGraphics();
    // The sky itself is rebuilt for a time-of-day change: the dome, the stars
    // and the sun are all geometry, not uniforms.
    if (key === 'timeOfDay') {
      this.scene.environmentIntensity = Settings.get('timeOfDay') === 'night' ? 0.55 : 1.7;
      this.world?.rebuildSky();
    }
    if (key === 'difficulty') { this.difficulty = Settings.difficulty(); if (this.stats) this.stats.diff = this.difficulty; }
    if (key === 'fullscreen') this.applyFullscreen();
  }

  applyFullscreen() {
    const want = Settings.get('fullscreen');
    if (want && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!want && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  /* ================= lifecycle ================= */

  async boot() {
    this.state = GameState.BOOT;
    await this.ui.runBootSequence();
    this.state = GameState.MENU;
  }

  async startNewGame(seedInput) {
    this.sandboxMode = false;
    this.sandbox.active = false;
    const seed = seedInput !== undefined ? seedInput : (Math.random() * 0xffffffff) >>> 0;
    // The road through the biomes is fixed by the seed: the Hollow first,
    // then a shuffle. Two players on the same seed walk the same road.
    this.runSeed = seed >>> 0;
    this.route = biomeOrder(seed);
    this.depth = 0;
    await this.buildRun(seedForDepth(this.runSeed, 0), this.route[0], 0);
    this.applyStartingLoadout();
    this.enterPlay();
    this.ui.subtitle('You come back to yourself in the dark, beside a fire that went out hours ago.');
    // Hand the player the lamp rather than leaving them to find the key in the
    // dark; the tutorial line still tells them which key turns it off.
    setTimeout(() => {
      if (this.state === GameState.PLAYING && this.flashlight && !this.flashlight.on) this.flashlight.toggle();
      this.ui.toast('Lamp on — F toggles it, M marks a spot, N hides waypoints', 'warn');
    }, 2400);
  }

  /**
   * The sandbox: a flat lit plain with nothing in it, and a menu to break it
   * with. It is a separate entry point rather than a mode flag on a run,
   * because everything about it — the map, the population, the survival
   * clocks — wants to be different.
   */
  async startSandbox(keepMods = false, biomeId = 'sandbox') {
    this.sandboxMode = true;
    this.route = [biomeId];
    this.depth = 0;
    this.runSeed = (Math.random() * 0xffffffff) >>> 0;
    await this.buildRun(this.runSeed, biomeId, 0);
    this.applyStartingLoadout();
    this.sandbox.active = true;
    // Regenerating the ground should not throw away the switches you set.
    if (!keepMods) this.sandbox.reset();
    else this.sandbox.reapply();
    this.enterPlay();
    if (this.flashlight && !this.flashlight.on) this.flashlight.toggle();
    this.ui.subtitle(biomeId === 'sandbox'
      ? 'The plain. Nothing here wants anything from you — yet.'
      : `${this.biome.name}. Everything here is real; nothing here can hurt you unless you let it.`);
    setTimeout(() => {
      if (!ModMenu.seen()) this.modMenu.startTutorial();
      else this.ui.toast('Press ` or F1 for the mod menu', 'good');
    }, 1400);
  }

  /** The road a given seed takes. Exposed so the lobby can declare it. */
  routeFor(seed) { return biomeOrder(seed); }

  /* ================= co-op ================= */

  _bindNet() {
    const net = this.net;

    // A world rebuild throws the scene away, and with it every avatar in it.
    net.on('state', (s) => { if (s === 'OFFLINE' || s === 'FAILED') this.ui.el.hud.querySelector('#squad')?.classList.add('hidden'); });

    // The host says where the party is; a guest that is somewhere else follows.
    net.on('rift', (world) => { this._followParty(world); });
    net.on('world', (world) => {
      if (net.isHost || !world) return;
      if (this.state !== GameState.PLAYING) return;
      if (world.biome !== this.biomeId || (world.depth | 0) !== (this.depth | 0)) this._followParty(world);
      else if (world.riftOpen && !this.riftOpen) this.riftOpen = true;
    });

    // Boss health is arbitrated by the server so eight players shooting the
    // same thing cannot kill it eight times over.
    net.on('boss', (m) => {
      if (!this.boss || !m.b) return;
      this.boss.health = m.b.health;
      this.ui.updateBossBar?.(this.boss);
    });
    net.on('bossdown', () => {
      if (this.boss && this.boss.alive) { this.boss.health = 0; this.boss.alive = false; }
      this.riftOpen = true;
    });

    net.on('down', () => { /* the squad readout and the toast are enough */ });
    net.on('revived', (m) => {
      if (this.state !== GameState.DEAD) return;
      // Somebody picked you up. Come back where you fell, not at the menu —
      // and without whatever was still killing you when you went down, or you
      // bleed straight back out in their arms.
      this.stats.dead = false;
      this.stats.causeOfDeath = '';
      this.stats.bleeding = 0;
      this.stats.poison = 0;
      this.stats.effects.length = 0;
      this.stats.health = m.hp || 35;
      Input.enabled = true;
      this.state = GameState.PLAYING;
      this.ui.showHUD();
      this.input.requestLock();
      this.ui.toast('Back on your feet', 'good');
    });
  }

  /** Follow the party into whatever biome the host says they are in. */
  async _followParty(world) {
    if (!world || this._transitioning) return;
    if (world.biome === this.biomeId && (world.depth | 0) === (this.depth | 0)) return;
    this._transitioning = true;
    const carriedInv = this.inventory.serialize();
    const carriedMags = this.weapons.serialize();
    const equipped = this.weapons.currentId;
    this.route = world.route || this.route;
    this.depth = world.depth | 0;
    this.runSeed = world.seed >>> 0;
    await this.buildRun(seedForDepth(this.runSeed, this.depth), world.biome, this.depth);
    this.inventory.deserialize(carriedInv);
    this.weapons.deserialize(carriedMags);
    if (equipped) this.weapons.equip(equipped);
    this.net.rebindScene();
    this.enterPlay();
    this._transitioning = false;
  }

  /**
   * Enter (or re-enter) the shared world. Everyone in the room generates the
   * same forest from the same seed, so the only thing that has to cross the
   * wire is where everybody is standing.
   */
  async startCoop() {
    const w = this.net.world;
    if (!w) { this.ui.toast('Not in a co-op game', 'bad'); return; }
    this.sandboxMode = false;
    this.sandbox.active = false;
    this.route = w.route && w.route.length ? w.route.slice() : biomeOrder(w.seed);
    this.depth = w.depth | 0;
    this.runSeed = w.seed >>> 0;
    await this.buildRun(seedForDepth(this.runSeed, this.depth), w.biome || this.route[0], this.depth);
    this.applyStartingLoadout();
    this.net.rebindScene();
    this.enterPlay();
    if (this.net.isHost) this.net.publishWorld();
    this.ui.subtitle(this.net.count > 1
      ? 'You are not alone out here. That is the only good news.'
      : `Code ${this.net.code}. Waiting for anyone else who wants to come.`);
    setTimeout(() => {
      if (this.state === GameState.PLAYING && this.flashlight && !this.flashlight.on) this.flashlight.toggle();
      this.ui.toast(`Co-op · code ${this.net.code} · ENTER to talk, V to ping`, 'good');
    }, 2000);
  }

  async loadGame() {
    const data = this.save.load();
    if (!data) { this.ui.toast('No save found', 'bad'); return; }
    if (data.difficulty) Settings.set('difficulty', data.difficulty);
    this.runSeed = (data.runSeed ?? data.seed) >>> 0;
    this.route = data.route || biomeOrder(this.runSeed);
    await this.buildRun(data.seed, data.biome || 'hollow', data.depth || 0);
    this.save.apply(data);
    this.weapons.equip(this.inventory.equipped);
    this.enterPlay();
    this.ui.toast('Progress restored', 'good');
  }

  async restart() {
    const seed = this.runSeed ?? this.seed;
    this.runSeed = seed >>> 0;
    this.route = biomeOrder(seed);
    this.depth = 0;
    await this.buildRun(seedForDepth(seed, 0), this.route[0], 0);
    this.applyStartingLoadout();
    this.enterPlay();
  }

  /* ================= biome progression ================= */

  /**
   * Step through the rift into the next place. Everything you are carrying
   * comes with you; everything you left behind does not.
   */
  async enterRift() {
    if (!this.riftOpen || this._transitioning) return;
    // In co-op the party moves together. A guest stepping through asks the
    // host to take everyone; the host announces it and the rest follow.
    if (this.net.online && !this.net.isHost) {
      this.net.send({ t: 'rift' });
      this.ui.toast('Waiting for the host to take the party through', 'warn');
      return;
    }
    this._transitioning = true;
    const carriedInv = this.inventory.serialize();
    const carriedStats = this.stats.serialize();
    const carriedMags = this.weapons.serialize();
    const equipped = this.weapons.currentId;

    this.depth = (this.depth || 0) + 1;
    if (!this.route) this.route = biomeOrder(this.seed);
    if (this.depth >= this.route.length) { this.onRunComplete(); this._transitioning = false; return; }

    const nextBiome = this.route[this.depth];
    // Tell the room before the world goes away, so everybody starts loading
    // the same place at roughly the same moment.
    if (this.net.online && this.net.isHost) this.net.descend(nextBiome, this.depth);
    // A new seed per biome, derived from the run seed, so each place is its
    // own world but the whole run still reproduces from one number — and so
    // that two people in the same co-op room generate the same next biome
    // without having to compare notes about how they got there.
    await this.buildRun(seedForDepth(this.runSeed ?? this.seed, this.depth), nextBiome, this.depth);
    this.inventory.deserialize(carriedInv);
    this.stats.deserialize(carriedStats);
    this.stats.health = Math.max(this.stats.health, this.stats.maxHealth * 0.55);
    this.weapons.deserialize(carriedMags);
    if (equipped) this.weapons.equip(equipped);
    // Every avatar belonged to the scene that was just thrown away.
    if (this.net.online) { this.net.rebindScene(); this.net.publishWorld(); }
    this.enterPlay();
    this._transitioning = false;
  }

  onRunComplete() {
    this.ui.toast('There is nothing deeper than this', 'good');
    this.ui.subtitle('The last rift closes behind you. Whatever this place was, it is finished with you.');
    this.riftOpen = false;
  }

  /** Called by a boss when it dies: the way out opens where it fell. */
  onBossDefeated(boss) {
    this.riftOpen = true;
    this.boss = null;
    const p = boss.position;
    this.rift = this.spawnRift(p.x, p.z);
    this.ui.toast('A rift has opened where it fell', 'good');
    this.ui.subtitle('The air where it stood will not close again. Something on the other side is waiting its turn.');
    Audio.mutantScream(p);
  }

  /** Reopen the rift for a save taken after the boss was already dead. */
  restoreRift() {
    if (this.riftOpen) return;
    const b = this.boss;
    if (b) {
      b.alive = false;
      b.corpse = true;
      b.model.visible = false;
      this.ui.hideBossBar();
    }
    const p = b ? b.position : { x: this.world.spawnPoint.x + 60, z: this.world.spawnPoint.z + 60 };
    this.riftOpen = true;
    this.boss = null;
    this.rift = this.spawnRift(p.x, p.z);
  }

  /** The doorway itself: a torn ring of light you can walk into. */
  spawnRift(x, z) {
    const y = this.world.terrain.heightAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y + 1.9, z);
    const col = new THREE.Color((this.world?._sky || this.biome.sky).moon);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.13, 8, 40),
      new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, opacity: 0.9 })
    );
    g.add(ring);
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(1.66, 40),
      new THREE.MeshBasicMaterial({ color: 0x05060a, toneMapped: false, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
    );
    g.add(core);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.10 + (i % 3) * 0.05, 0),
        new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      sh.position.set(Math.cos(a) * 1.95, Math.sin(a * 2) * 0.35, Math.sin(a) * 1.95);
      g.add(sh);
    }
    this.scene.add(g);

    const light = new THREE.PointLight(col, 6, 26, 2);
    light.position.set(x, y + 2.2, z);
    this.scene.add(light);

    const it = {
      x, y: y + 1.2, z, label: 'Step through the rift', kind: 'rift',
      radius: 3.2, group: g, light,
      activate: () => this.enterRift(),
    };
    this.world.registerInteractable(it);
    this.riftObject = it;
    return it;
  }

  /** Tear down and rebuild the whole run for `seed` in `biomeId`. */
  async buildRun(seed, biomeId = 'hollow', depth = 0) {
    this.state = GameState.LOADING;
    this._pauseReasons.clear();
    this.biomeId = biomeId;
    this.biome = getBiome(biomeId);
    this.depth = depth;
    this.scaling = depthScaling(depth);
    this.riftOpen = false;
    this.riftObject = null;
    this.boss = null;
    this.ui.resetRunHud();
    this.ui.showLoading('Opening ' + this.biome.name.toLowerCase());
    Input.exitLock();
    await frame();

    this.teardown();

    this.seed = seed >>> 0;
    this.seedLabel = this.seed.toString(16).toUpperCase().padStart(8, '0');
    this.rng = makeRNG(this.seed ^ 0xA11CE);
    this.difficulty = Settings.difficulty();

    this.scene = new THREE.Scene();
    this.scene.environment = this.envMap;
    // Physically-based materials get most of their fill from the environment
    // map, so daylight has to raise it — cranking the ambient light instead
    // lifts everything by a flat amount and reads as fog rather than as sun.
    this.scene.environmentIntensity = Settings.get('timeOfDay') === 'night' ? 0.55 : 1.7;
    this.fx = new FXSystem(this.scene, this.viewScene);

    this.stats = new PlayerStats(this.difficulty);
    this.inventory = new Inventory();
    this.inventory.onChange(() => this.ui.updateQuickbar());

    this.world = new WorldManager(this, this.seed, this.biomeId);
    await this.world.build((p, label) => this.ui.setLoadProgress(p * 0.8, label));

    this.flashlight = new Flashlight(this.scene);
    this.player = new PlayerController(this.camera, this.world, this.stats);
    // Biome physics: a third of the gravity in the Long Dark, near-neutral
    // buoyancy and heavy drag on the Drowned Shelf.
    const ph = this.biome.physics;
    this.player.env = {
      gravity: ph.gravity, drag: ph.drag, moveMul: ph.moveMul, jumpMul: ph.jumpMul,
      freeSwim: this.biome.terrain.water === 'flood', slip: ph.slip || 0,
    };
    this.entities = new EntityManager(this);
    this.damage = new DamageSystem(this);
    this.weapons = new WeaponSystem(this);
    this.interaction = new InteractionSystem(this);
    this.loot = new LootSystem(this);
    this.loot.attach(this.scene);
    this.waypoints = new Waypoints(this);
    this.waypoints.attach(this.scene);
    this.director = new HorrorDirector(this);

    this.ui.setLoadProgress(0.84, 'Distributing supplies');
    await frame();
    const lootRng = makeRNG(this.seed ^ 0x10077);
    for (const lm of this.world.landmarks) {
      // A landmark whose builder bailed out has no loot to place. Skipping it
      // is right; taking the whole world build down with it is not.
      if (!lm.built) continue;
      this.loot.populateLandmark(lm, lm.built.lootSpots, lm.built.interactables, lootRng, this.difficulty.lootMul);
    }
    this.loot.scatterForage(lootRng, this.world.terrain, Math.round(430 * Settings.get('foliage')));
    this.loot.scatterBodies(lootRng, this.world.terrain, 14, this.difficulty.lootMul);
    this.loot.freezeScatter();

    this.ui.setLoadProgress(0.92, 'Waking ' + this.biome.name.toLowerCase());
    await frame();
    this.entities.populate(this.world.landmarks, makeRNG(this.seed ^ 0xBEEF),
      this.difficulty.enemyDensity * this.biome.creatures.density * this.scaling.density, this.biome);

    // The plain stays empty until you ask for something, and has no boss.
    if (!this.biome.sandbox) {
      // The boss stands at the most threatening landmark that is not the one
      // you wake up next to — far enough that you have to go looking.
      this.spawnBiomeBoss(makeRNG(this.seed ^ 0xB055));
    }

    this.ui.setLoadProgress(0.98, 'Compiling shaders');
    await frame();
    // Compile every program the world needs *now*, while a loading bar is on
    // screen, rather than the first time each material comes into view. An
    // uncompiled program costs several milliseconds at the moment it is first
    // drawn, which lands as a hitch exactly when something new walks out of
    // the trees at you — the worst possible moment, and the one players
    // remember as "the game stutters".
    try {
      // three's compile() walks only *visible* objects, and the things that
      // hitch are precisely the ones that are hidden until they are needed —
      // the muzzle flash, blood, the scope overlay, a creature that has not
      // been seen yet. So everything is shown for the length of the call and
      // put back exactly as it was.
      const hidden = [];
      for (const root of [this.scene, this.viewScene]) {
        root.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      }
      this.renderer.compile(this.scene, this.camera);
      this.renderer.compile(this.viewScene, this.viewCamera);
      for (const o of hidden) o.visible = false;

      // compile() builds the colour programs. The *depth* variants a material
      // needs when it is drawn into the shadow map are only built when the
      // renderer actually draws that pass, so a frame has to happen — but a
      // full-resolution one costs real milliseconds of blocked main thread on
      // a slow machine, which is enough to lose a co-op socket mid-rift. Into
      // a 64x64 target instead: the same programs get built, and the pixels
      // nobody will ever see cost nothing.
      const warm = new THREE.WebGLRenderTarget(64, 64);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(warm);
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
      this.renderer.render(this.viewScene, this.viewCamera);
      this.renderer.setRenderTarget(prev);
      warm.dispose();
    } catch (e) { console.warn('[precompile]', e); }

    this.ui.setLoadProgress(0.99, 'Final checks');
    await frame();

    // spawn beside the starting campsite
    const sp = this.world.spawnPoint;
    const spot = this.world.terrain.findWalkable(sp.x, sp.z, this.rng, 20, 7);
    this.player.spawn(spot.x, spot.z);
    this.player.yaw = Math.atan2(-(sp.x - spot.x), -(sp.z - spot.z));
    // Everyone in a co-op room generates the same world and therefore the same
    // walkable spawn tile, so without this the whole squad materialises inside
    // one another. Spread them around the campfire by their player id, which
    // is stable and unique and needs no agreement with anybody.
    if (this.net.online && this.net.selfId) {
      const a = (this.net.selfId * 2.39996) % (Math.PI * 2);   // golden-angle ring
      const r = 2.2 + ((this.net.selfId * 7) % 5) * 0.6;
      const off = this.world.terrain.findWalkable(spot.x + Math.cos(a) * r, spot.z + Math.sin(a) * r, this.rng, 8, 3);
      this.player.spawn(off.x, off.z);
      this.player.yaw = Math.atan2(-(sp.x - off.x), -(sp.z - off.z));
    }
    const camp = this.world.landmarks.find((l) => l.type === 'camp');
    if (camp) { camp.discovered = true; this.stats.landmarksFound = 1; }

    Audio.init();
    Audio.resume();
    Audio._menuMusic = false;
    Audio.stopMusic();
    Audio.startAmbience();
    // Each place gets its own palette; the director crossfades between them.
    Audio.startMusic(this.biomeId);
    Audio.setMusicPalette(this.biomeId);

    this.ui.setLoadProgress(1, 'Ready');
    await frame();
  }

  /** Put the biome's boss in its arena. */
  spawnBiomeBoss(rng) {
    const def = bossForBiome(this.biomeId);
    const sp = this.world.spawnPoint;
    let best = null, bestScore = -Infinity;
    for (const lm of this.world.landmarks) {
      const d = Math.hypot(lm.x - sp.x, lm.z - sp.z);
      if (d < 150) continue;
      const score = (lm.threat || 0) * 60 + d * 0.4 + (lm.clear || 0);
      if (score > bestScore) { bestScore = score; best = lm; }
    }
    if (!best) {
      const a = rng() * Math.PI * 2;
      best = { x: Math.cos(a) * 260, z: Math.sin(a) * 260, clear: 30 };
    }
    const spot = this.world.terrain.findWalkable(best.x, best.z, rng, 30, Math.max(14, (best.clear || 20)));
    this.boss = this.entities.spawnBoss(def.id, spot.x, spot.z, this.scaling.health);
    this.bossLandmark = best;
    // The host registers the boss with the room so its health is one number
    // shared by everybody rather than eight private ones.
    if (this.net?.online && this.net.isHost) {
      this.net.publishWorld({
        boss: { id: def.id, name: def.name, health: this.boss.health, maxHealth: this.boss.maxHealth, phase: 1 },
      });
    }
    return this.boss;
  }

  get bossAlive() { return !!(this.boss && this.boss.alive); }

  bossDistance() {
    if (!this.bossAlive) return 0;
    return Math.hypot(this.boss.position.x - this.player.position.x, this.boss.position.z - this.player.position.z);
  }

  applyStartingLoadout() {
    for (const it of startingLoadout()) this.inventory.add(it.id, it.qty);
    this.inventory.equip('pistol9');
    this.weapons.equip('pistol9');
    this.weapons.mags.set('pistol9', 15);
    this.inventory.remove('ammo9', 15);
    this.inventory.assignQuick(0, 'pistol9');
    this.inventory.assignQuick(2, 'knife');
    this.inventory.assignQuick(3, 'bandage');
    this.inventory.assignQuick(4, 'berries');
    // whatever the player built in the armoury before starting
    this.armoury.applyToRun();
  }

  /**
   * Compile the handful of materials that only came into existence after the
   * world did — the weapon you were issued, with its finish and its optic.
   *
   * Deliberately only the viewmodel scene. Recompiling the *world* here would
   * mean another pass over eight thousand objects with the main thread already
   * blocked, and a main thread blocked for long enough is how a co-op socket
   * dies during a rift.
   */
  _warmShaders() {
    if (!this.renderer || !this.viewScene) return;
    try {
      const hidden = [];
      this.viewScene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      this.renderer.compile(this.viewScene, this.viewCamera);
      for (const o of hidden) o.visible = false;
    } catch (e) { console.warn('[warm]', e); }
  }

  enterPlay() {
    // The loadout is issued after the world is built, so the weapon in your
    // hands — with its finish, its optic and its attachments — brings
    // materials the first compile never saw.
    this._warmShaders();
    this.state = GameState.PLAYING;
    this._pauseReasons.clear();
    this.ui.showHUD();
    this.ui.showBiomeCard(this.biome, this.depth || 0);
    Input.enabled = true;
    Input.clear();
    Input.requestLock();
    Audio.resume();
  }

  teardown() {
    if (!this.world) return;
    this.waypoints?.dispose();
    this.waypoints = null;
    Audio.stopAll();
    this.entities?.clear();
    this.world.dispose();
    this.weapons?.dispose();
    this.weapons = null;
    this.fx?.dispose();
    disposeScene(this.scene);
    this.scene = new THREE.Scene();
    // The view scene outlives every run, so anything a run put in it that is
    // not part of the permanent light rig is a leak — and a visible one, since
    // it is drawn in front of everything. Sweep it rather than trusting each
    // system to have cleaned up after itself.
    for (const o of this.viewScene.children.slice()) {
      if (o.isLight) continue;
      this.viewScene.remove(o);
    }
  }

  toMainMenu() {
    Input.enabled = false;
    Input.exitLock();
    this.state = GameState.MENU;
    Audio.stopMusic();
    this.ui.showMainMenu();
  }

  quit() {
    Input.exitLock();
    this.teardown();
    this.state = GameState.MENU;
    // A browser tab cannot close itself unless it opened itself, so leave the
    // player on a clean, explicit exit screen instead of silently failing.
    document.body.innerHTML =
      '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#000;color:#7d7768;font-family:ui-monospace,monospace;letter-spacing:.4em;' +
      'font-size:12px;text-align:center;line-height:2.4">THANK YOU FOR PLAYING<br>' +
      '<span style="font-size:9px;letter-spacing:.3em;color:#4a4844">BLACKROOT — NINEFOLD LANTERN STUDIOS<br>' +
      'CLOSE THIS TAB OR RELOAD TO PLAY AGAIN</span></div>';
    window.close();
  }

  /* ================= pause ================= */

  setPaused(on, reason) {
    if (on) this._pauseReasons.add(reason); else this._pauseReasons.delete(reason);
    const paused = this._pauseReasons.size > 0;
    if (paused) Input.exitLock();
    else if (this.state === GameState.PLAYING) Input.requestLock();
  }

  get paused() { return this._pauseReasons.size > 0 || this.state !== GameState.PLAYING; }

  pause() {
    if (this.state !== GameState.PLAYING) return;
    if (this._pauseReasons.has('menu')) return;
    this._pauseReasons.add('menu');
    Input.exitLock();
    this.ui.showPause();
    Audio.suspend();
  }

  resume() {
    this._pauseReasons.delete('menu');
    this.ui.hidePause();
    this.ui.el.settings.classList.add('hidden');
    if (this._pauseReasons.size === 0) {
      Audio.resume();
      Input.clear();
      Input.requestLock();
    }
  }

  /* ================= input actions ================= */

  onKeyDown(code, e) {
    if (this.armoury && this.armoury.isOpen) {
      if (code === 'Escape' || code === 'Tab') this.armoury.close();
      return;
    }
    // The mod menu is available whenever the sandbox is running.
    if (this.sandbox.active && (code === 'Backquote' || code === 'F1')) {
      e.preventDefault?.();
      this.modMenu.toggle();
      return;
    }
    if (this.modMenu.open && code === 'Escape') { this.modMenu.toggle(false); return; }

    // global
    if (code === 'F11') { e.preventDefault(); Settings.set('fullscreen', !Settings.get('fullscreen')); return; }
    if (code === 'F3') { Settings.set('showFps', !Settings.get('showFps')); return; }

    if (this.state !== GameState.PLAYING) {
      if (code === 'Escape') {
        if (!this.ui.el.reader.classList.contains('hidden')) this.ui.closeNote();
        else if (!this.ui.el.settings.classList.contains('hidden')) {
          this.ui.el.settings.classList.add('hidden');
          if (this.ui._settingsReturn === 'pause') this.ui.showPause();
        } else if (this.coop.open) this.coop.hide();
        else if (!this.ui.el.credits.classList.contains('hidden')) this.ui.el.credits.classList.add('hidden');
      }
      return;
    }

    // Chat is a single line over the HUD; it never pauses the world, because
    // the thing chasing you does not wait for you to finish typing.
    if (this.coop.chatOpen) { if (code === 'Escape') this.coop.closeChat(); return; }
    if ((code === 'Enter' || code === 'NumpadEnter') && this.net.online) {
      e.preventDefault?.();
      this.coop.openChat();
      return;
    }

    if (code === 'Escape') {
      if (this.ui.inventoryOpen) { this.ui.toggleInventory(false); this.setPaused(false, 'inventory'); return; }
      if (!this.ui.el.reader.classList.contains('hidden')) { this.ui.closeNote(); return; }
      if (this._pauseReasons.has('menu')) this.resume(); else this.pause();
      return;
    }

    if (this._pauseReasons.size > 0 && !this.ui.inventoryOpen) return;

    switch (code) {
      case 'Tab': {
        const open = this.ui.toggleInventory();
        this.setPaused(open, 'inventory');
        Audio.uiClick();
        break;
      }
      case 'KeyE':
        if (!this.ui.inventoryOpen) this.interaction.activate();
        break;
      case 'KeyF':
        if (!this.ui.inventoryOpen) {
          const on = this.flashlight.toggle();
          if (on) this.ui.toast('Lamp on', ''); else this.ui.toast('Lamp off', '');
        }
        break;
      case 'KeyR':
        if (!this.ui.inventoryOpen) this.weapons.startReload();
        break;
      case 'KeyQ':
        if (!this.ui.inventoryOpen) this.useBestMedical();
        break;
      case 'KeyV':
        if (!this.ui.inventoryOpen) this.weapons.punch();
        break;
      case 'KeyM':
        if (!this.ui.inventoryOpen) {
          // Mark what you are looking at, or clear the mark if you have one.
          const wp = this.waypoints.togglePinAhead();
          if (wp) {
            this.ui.toast(this.net.online ? 'Marked for the squad' : 'Position marked — follow the beacon', 'good');
            // In co-op a mark is a call: everyone else sees it where you put it.
            if (this.net.online) this.net.ping({ x: wp.x, y: wp.y, z: wp.z }, `${this.net.name}'s mark`);
          } else this.ui.toast('Marker cleared', '');
        }
        break;
      case 'KeyN':
        if (!this.ui.inventoryOpen) {
          Settings.set('waypoints', !Settings.get('waypoints'));
          this.ui.toast(Settings.get('waypoints') ? 'Waypoints on' : 'Waypoints off', '');
        }
        break;
      case 'ShiftLeft': case 'ShiftRight':
        if (Settings.get('toggleSprint')) this.player._sprintToggle = !this.player._sprintToggle;
        break;
      case 'KeyC': case 'ControlLeft': case 'ControlRight':
        if (Settings.get('toggleCrouch')) this.player._crouchToggle = !this.player._crouchToggle;
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': {
        const idx = parseInt(code.slice(5), 10) - 1;
        if (this.ui.inventoryOpen) {
          if (this.ui.selectedItem) {
            this.inventory.assignQuick(idx, this.ui.selectedItem);
            this.ui.renderInventory();
            Audio.uiClick();
          }
        } else {
          const id = this.inventory.quick[idx];
          if (id) this.useItem(id); else Audio.denied();
        }
        break;
      }
      default: break;
    }
  }

  /* ================= armoury ================= */

  openArmoury(from) {
    if (from === 'pause') this.ui.el.pause.classList.add('hidden');
    else this.ui.el.menu.classList.add('hidden');
    this.ui.el.settings.classList.add('hidden');
    this.armoury.open(from);
  }

  /* ================= item use ================= */

  useItem(id) {
    const item = ITEMS[id];
    if (!item || !this.inventory.has(id)) { Audio.denied(); return false; }
    if (item.cat === 'weapon') {
      this.inventory.equip(id);
      this.weapons.equip(id);
      this.ui.toast(`Equipped ${item.name}`);
      return true;
    }
    if (item.id === 'battery') {
      if (this.flashlight.battery > 96) { this.ui.toast('The cell in the lamp is still good', 'warn'); Audio.denied(); return false; }
      this.startUse({ useTime: item.useTime, label: 'Changing cell', onComplete: () => {
        this.inventory.remove(id, 1);
        this.flashlight.addBattery(item.battery);
        this.ui.toast('Lamp cell replaced', 'good');
        Audio.reloadStep('magIn');
      } });
      return true;
    }
    if (item.cat === 'food' || item.cat === 'medical') {
      if (item.cat === 'medical' && this.stats.health >= this.stats.maxHealth && !this.stats.bleeding && !item.damageResist) {
        this.ui.toast('You are not injured', 'warn'); Audio.denied(); return false;
      }
      this.startUse({
        useTime: item.useTime || 2,
        label: item.cat === 'food' ? `Eating ${item.name}` : `Using ${item.name}`,
        onComplete: () => {
          this.inventory.remove(id, 1);
          this.stats.eat(item);
          if (item.cat === 'food') { if (item.id === 'water') Audio.drink(); else Audio.eat(); }
          else Audio.heal();
          this.ui.toast(`Used ${item.name}`, 'good');
        },
      });
      return true;
    }
    Audio.denied();
    return false;
  }

  useBestMedical() {
    const order = this.stats.bleeding > 0 ? ['bandage', 'medkit', 'herb', 'painkillers'] : ['herb', 'bandage', 'medkit', 'painkillers'];
    for (const id of order) if (this.inventory.has(id)) return this.useItem(id);
    this.ui.toast('No medical supplies', 'bad');
    Audio.denied();
    return false;
  }

  dropItem(id) {
    if (!id || !this.inventory.has(id)) return;
    const removed = this.inventory.remove(id, 1);
    if (!removed) return;
    const p = this.player.position;
    const f = this.player.forward;
    const x = p.x + f.x * 1.2, z = p.z + f.z * 1.2;
    this.loot.dropPickup(id, 1, x, this.world.terrain.heightAt(x, z), z).spawned = true;
    this.ui.toast(`Dropped ${ITEMS[id].name}`);
  }

  startUse(action) {
    if (this._using) return false;
    this._using = { ...action, elapsed: 0 };
    return true;
  }

  cancelUse() { this._using = null; }

  /* ================= death ================= */

  onPlayerDeath(cause) {
    if (this.state === GameState.DEAD) return;
    this.state = GameState.DEAD;
    Input.enabled = false;
    Input.exitLock();
    Audio.setDread(0);
    Audio.stopMusic();
    this._using = null;
    // In co-op you go down rather than out: the squad is told where you fell,
    // and the death screen waits in case somebody reaches you.
    if (this.net.online) {
      this.net.reportDown(cause || '');
      setTimeout(() => { if (this.state === GameState.DEAD) this.ui.showDeath(cause); }, 12000);
      this.ui.subtitle('You are down. Someone has to reach you.');
      return;
    }
    setTimeout(() => this.ui.showDeath(cause), 1400);
  }

  saveGame() { return this.save.save(); }

  /** Read-only controller state, used by the automated controller test. */
  get padDebug() {
    return {
      connected: Pad.connected, brand: Pad.brand, id: Pad.id,
      move: { ...Pad.move }, look: { ...Pad.look }, triggers: { ...Pad.triggers },
      layout: Pad.opts.buttonLayout, usingGamepad: Input.usingGamepad,
      pointerLocked: Input.locked,
      glyphFor: (a) => Pad.glyphFor(a),
    };
  }

  /* ================= frame ================= */

  _loop(now) {
    requestAnimationFrame(this._loop);
    // Always-advancing frame counter (the simulation counter stops while
    // paused). Diagnostics and the automated tests key off this.
    this.rafCount = (this.rafCount || 0) + 1;
    const t = now * 0.001;
    if (this._last === undefined) this._last = t;
    let dt = t - this._last;
    this._last = t;
    if (dt > 0.35) dt = 0.35;       // never let a long stall teleport anything

    // frame limiter
    const limit = Settings.get('fpsLimit');
    if (limit > 0) {
      this._limitAccum = (this._limitAccum || 0) + dt;
      if (this._limitAccum < 1 / limit) return;
      dt = this._limitAccum;
      this._limitAccum = 0;
    }

    this._fpsAccum += dt; this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this._fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0; this._fpsFrames = 0;
    }

    try {
      // The controller is polled once per rendered frame (not per sub-step) so
      // button edges fire exactly once and stick look is scaled by the real
      // frame time.
      const gameplayInput = this.state === GameState.PLAYING && this._pauseReasons.size === 0 && !this._using;
      Input.interactAvailable = !!(this.interaction && this.interaction.current);
      Input.update(dt, this.weapons ? this.weapons.ads : 0, gameplayInput);
      if (gameplayInput) this.applyAimAssist(dt);
      else if (this.ui) this.ui.padMenuTick(dt);
      if (this.armoury && this.armoury.isOpen) this.armoury.update(dt);

      // The socket is driven by the real frame time, not the simulation step:
      // it has to keep reconnecting and keep the lobby alive while the game is
      // paused, in a menu, or on the death screen.
      this.net.update(dt);
      this.coop.update(dt);

      // Fixed sub-stepping: on a slow machine the simulation still advances at
      // the right rate instead of running in slow motion, and physics never
      // integrates a huge timestep.
      // The sandbox's time scale multiplies the simulation, never the menus.
      if (this.timeScale !== 1) dt *= this.timeScale;

      const MAX_STEP = 1 / 30;
      let remaining = dt;
      let steps = 0;
      while (remaining > 1e-4 && steps < 12) {
        const step = Math.min(MAX_STEP, remaining);
        this.update(step);
        remaining -= step;
        steps++;
      }
      this.render();
    } catch (err) {
      console.error(err);
      if (!this._errored) {
        this._errored = true;
        this.ui.fatal(String(err && err.stack ? err.stack : err));
      }
    }
  }


  /* ================= aim assist ================= */

  /**
   * Controller aim assist, in the two parts console shooters actually use:
   *
   *  - **slowdown**: sensitivity drops while the reticle is near a target, so
   *    the stick stops overshooting. Applies whether or not the player moves.
   *  - **rotation**: the camera is pulled toward the target, scaled by how much
   *    the player is already turning. It helps you track; it will not aim for
   *    a player who isn't trying.
   *
   * Both are off for mouse input, and both are gated behind line of sight so
   * the reticle never sticks to something through a tree.
   */
  applyAimAssist(dt) {
    const strength = Settings.get('padAimAssist');
    if (!Input.usingGamepad || strength <= 0 || !this.entities || !this.player) return;

    const cam = this.camera;
    const origin = cam.getWorldPosition(_aaOrigin);
    const fwd = cam.getWorldDirection(_aaFwd);

    const ads = this.weapons ? this.weapons.ads : 0;
    const maxRange = 20 + 55 * ads + 25;
    const outerCone = (0.150 - 0.055 * ads);     // radians; tighter while aiming
    const innerCone = outerCone * 0.45;

    let best = null, bestAngle = outerCone;
    for (const e of this.entities.active) {
      if (!e.alive) continue;
      const dx = e.position.x - origin.x;
      const dy = (e.position.y + e.height * 0.6) - origin.y;
      const dz = e.position.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > maxRange || dist < 0.6) continue;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dist;
      if (dot <= 0) continue;
      const angle = Math.acos(Math.min(1, dot));
      // A larger target is easier to stick to, exactly as it should be.
      const sizeBonus = 1 + Math.min(1.2, e.radius * 1.1);
      const effective = angle / sizeBonus;
      if (effective < bestAngle) {
        if (!this.world.hasLineOfSight(origin, _aaTarget.set(e.position.x, e.position.y + e.height * 0.6, e.position.z), dist)) continue;
        bestAngle = effective;
        best = { e, dx, dy, dz, dist, angle, effective };
      }
    }

    this.aimTarget = best ? best.e : null;
    if (!best) { Input.applyAimAssist(1, 0, 0); return; }

    // --- slowdown ---
    const closeness = 1 - Math.min(1, best.angle / outerCone);
    const slowdown = 1 - 0.55 * strength * closeness * closeness;

    // --- rotation, scaled by how hard the player is already turning ---
    const inputMag = Math.min(1, Input.padLookMagnitude / (0.02 * Math.max(0.2, dt / 0.016)));
    let addX = 0, addY = 0;
    if (best.effective < innerCone * 2.4) {
      const targetYaw = Math.atan2(-best.dx, -best.dz);
      let yawErr = targetYaw - this.player.yaw;
      while (yawErr > Math.PI) yawErr -= Math.PI * 2;
      while (yawErr < -Math.PI) yawErr += Math.PI * 2;
      const targetPitch = Math.asin(Math.max(-1, Math.min(1, best.dy / best.dist)));
      const pitchErr = targetPitch - this.player.pitch;

      // cap the pull so it can never snap
      const cap = 1.15 * strength * dt * (0.35 + 0.65 * inputMag);
      addX = -clampMag(yawErr * 3.2 * strength * dt * (0.25 + 0.75 * inputMag), cap);
      addY = -clampMag(pitchErr * 3.2 * strength * dt * (0.25 + 0.75 * inputMag), cap);
    }
    Input.applyAimAssist(slowdown, addX, addY);
  }

  update(dt) {
    if (this.state === GameState.BOOT || this.state === GameState.MENU || this.state === GameState.LOADING) return;
    if (!this.world) return;

    const active = this.state === GameState.PLAYING && this._pauseReasons.size === 0;
    const allowInput = active && !this._using;

    if (!active && this.state !== GameState.DEAD) {
      // still render, but freeze simulation
      this.world.update(0, this.time, this.camera.position);
      return;
    }

    this.time += dt;
    this.frame++;

    if (this.state === GameState.DEAD) {
      // brief death camera settle
      this.player.landDip += (0.6 - this.player.landDip) * Math.min(1, dt * 2.4);
      this.player.applyCamera(dt);
      this.world.update(dt, this.time, this.camera.position);
      this.fx.update(dt);
      this.entities.update(dt, this.player.position, Settings.get('viewDistance'));
      return;
    }

    // --- player ---
    this.player.overloaded = this.inventory.overloaded;
    this.player.update(dt, allowInput);
    this.stats.update(dt, {
      sprinting: this.player.sprinting,
      crouching: this.player.crouching,
      moving: this.player.moving,
      overloaded: this.inventory.overloaded,
      thirstEnabled: Settings.get('thirstEnabled'),
    });
    if (this.stats.dead) { this.onPlayerDeath(this.stats.causeOfDeath); return; }

    // --- held action (eating, bandaging, drinking) ---
    if (this._using) {
      this._using.elapsed += dt;
      this.ui.showPrompt(`${this._using.label}…  ${Math.round((this._using.elapsed / this._using.useTime) * 100)}%`);
      if (this.player.sprinting) { this._using = null; this.ui.toast('Interrupted', 'warn'); }
      else if (this._using.elapsed >= this._using.useTime) {
        const done = this._using.onComplete;
        this._using = null;
        done?.();
      }
    }

    // --- flashlight ---
    this.flashlight.update(dt, this.player.eyePosition, this.player.forward, this.player.moving);

    // --- weapons & interaction ---
    this.weapons.update(dt, allowInput);
    if (allowInput) {
      const wheel = Input.takeWheel();
      if (wheel !== 0) {
        const id = this.inventory.cycleWeapon(wheel);
        if (id) { this.weapons.equip(id); this.ui.toast(ITEMS[id].name); }
      }
    }
    if (!this._using) this.interaction.update(dt, allowInput);

    // --- world & AI ---
    this.world.update(dt, this.time, this.camera.position);
    this.world.updateProps(this.time);
    this.entities.update(dt, this.player.position, Settings.get('viewDistance'));
    this.loot.update(dt, this.player.position);
    this.director.update(dt);
    this.director.updateSilhouette(dt);
    this.waypoints.update(dt);
    this.sandbox.update(dt);
    this.world.checkDiscovery(this.player.position);
    this.fx.update(dt);

    // ambient motes near the player, plus whatever this biome is dropping,
    // rising or drifting through the air
    if ((this.frame & 15) === 0) this.fx.spawnMotes(this.player.position, 2, 22);
    const wx = this.biome.fx;
    if (wx.fall && (this.frame & 3) === 0) {
      this._moteCol = this._moteCol || new THREE.Color();
      this._moteCol.setHex(wx.moteColor);
      this.fx.weather(wx.fall, this.player.position, Math.max(1, Math.round(wx.moteRate)), 26,
        [this._moteCol.r, this._moteCol.g, this._moteCol.b]);
    }
    if (this.riftObject) {
      const g = this.riftObject.group;
      g.rotation.z = this.time * 0.4;
      g.rotation.y = Math.sin(this.time * 0.3) * 0.4;
      this.riftObject.light.intensity = 5 + Math.sin(this.time * 2.2) * 2;
    }

    // --- audio listener ---
    const f = this.player.forward;
    Audio.updateListener(this.camera.position, f, _up);

    // --- UI ---
    this.ui.updateHUD(dt);
    if ((this.frame & 31) === 0) {
      this.ui.setFps(this._fps, Settings.get('showFps')
        ? `draws ${this.renderer.info.render.calls}  tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k\n` +
          `ents ${this.entities.active.length}  dread ${(this.director.dread * 100).toFixed(0)}%`
        : '');
    }

    // autosave every two minutes of play
    this._autosave = (this._autosave || 0) + dt;
    if (this._autosave > 120) { this._autosave = 0; this.save.save(); }
  }

  render() {
    // Third person is a camera offset applied after the player has posed it.
    this.sandbox.applyCamera();
    // The armoury takes the whole frame: its preview is drawn by this renderer
    // rather than a second WebGL context.
    if (this.armoury && this.armoury.isOpen) { this.armoury.renderPreview(this.renderer); return; }
    if (this.state === GameState.BOOT || this.state === GameState.MENU || !this.world) {
      this.renderer.clear();
      return;
    }
    const r = this.renderer;
    r.info.reset();
    // Magnified optics render the world a second time through a narrow camera
    // into the scope's lens texture, before the main pass draws the frame.
    if (this.weapons) this.weapons.renderScope(r, this.scene);
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.viewScene, this.viewCamera);
  }
}

/**
 * The seed for one stop on the road. It is a pure function of the run seed and
 * the depth — never a chain from the previous biome — because in co-op two
 * clients that took different paths into the same room still have to generate
 * the identical world.
 */
export function seedForDepth(runSeed, depth) {
  const s = runSeed >>> 0;
  return depth <= 0 ? s : (s ^ Math.imul(0x9E3779B9, depth + 1)) >>> 0;
}

function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    }
  });
  while (scene.children.length) scene.remove(scene.children[0]);
}

const _up = new THREE.Vector3(0, 1, 0);
const _aaOrigin = new THREE.Vector3();
const _aaFwd = new THREE.Vector3();
const _aaTarget = new THREE.Vector3();

function clampMag(v, m) { return v > m ? m : v < -m ? -m : v; }
