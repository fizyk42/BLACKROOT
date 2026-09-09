/**
 * Sandbox — the plain, and the mod menu you break it with.
 *
 * The whole thing is **declarative**: every switch, slider and button in the
 * menu is an entry in `MODS` with an `apply` or `run` function. The UI is
 * generated from that list, the save file is generated from that list, the
 * tutorial points at entries in that list, and the automated test walks that
 * list and exercises every single entry. Adding a new toy is one object; there
 * is nowhere else to remember to update, which is the only way a menu this
 * size stays honest.
 *
 * Sandbox state is applied every frame rather than at the moment you flip a
 * switch, because half of it (god mode, infinite ammo, frozen AI) has to fight
 * the game continuously re-deciding otherwise.
 */
import * as THREE from 'three';
import { Settings } from '../core/Settings.js';
import { Audio } from '../core/AudioManager.js';
import { MUTANT_CONFIG } from '../entities/MutantAI.js';
import { BOSSES } from '../entities/Bosses.js';
import { ANIMAL_CONFIG } from '../entities/AnimalAI.js';
import { WEAPONS } from './ItemDatabase.js';
import { forgeWeapon, FORGE_SPACE } from './WeaponForge.js';
import { BIOMES, BIOME_IDS } from '../world/Biomes.js';

const creatureIds = () => Object.keys(MUTANT_CONFIG);
const animalIds = () => Object.keys(ANIMAL_CONFIG);
const bossIds = () => Object.keys(BOSSES);
const weaponIds = () => Object.keys(WEAPONS);

/* ------------------------------------------------------------------ */
/* the mods                                                            */
/* ------------------------------------------------------------------ */

/**
 * type:
 *   toggle  — boolean, `apply(game, on)` runs every frame while sandbox is on
 *   slider  — number,  `apply(game, value)` runs every frame
 *   action  — button,  `run(game, sandbox)` runs once when pressed
 *   pick    — a chooser that sets `sandbox.pick[id]`, used by actions
 */
export const MODS = [
  /* ---------------- player ---------------- */
  {
    id: 'god', group: 'Player', type: 'toggle', label: 'God mode', def: false,
    help: 'Nothing can hurt you. Bleeding, hunger and thirst stop mattering too.',
    apply: (g, on) => { if (on) { g.stats.health = g.stats.maxHealth; g.stats.bleeding = 0; g.stats.poison = 0; } },
  },
  {
    id: 'infStamina', group: 'Player', type: 'toggle', label: 'Infinite stamina', def: false,
    help: 'Sprint forever.',
    apply: (g, on) => { if (on) g.stats.stamina = g.stats.maxStamina; },
  },
  {
    id: 'noNeeds', group: 'Player', type: 'toggle', label: 'No hunger or thirst', def: true,
    help: 'The survival clocks stop. On by default — the sandbox is not a survival run.',
    apply: (g, on) => { if (on) { g.stats.hunger = 100; g.stats.thirst = 100; } },
  },
  {
    id: 'noclip', group: 'Player', type: 'toggle', label: 'Noclip', def: false,
    help: 'Walk through everything and fly. Space rises, C sinks.',
    apply: (g, on) => { g.player.noclip = on; },
  },
  {
    id: 'speed', group: 'Player', type: 'slider', label: 'Move speed', def: 1,
    min: 0.1, max: 8, step: 0.1, fmt: (v) => v.toFixed(1) + '×',
    apply: (g, v) => { g.player.env.moveMul = v; },
  },
  {
    id: 'jump', group: 'Player', type: 'slider', label: 'Jump height', def: 1,
    min: 0.2, max: 6, step: 0.1, fmt: (v) => v.toFixed(1) + '×',
    apply: (g, v) => { g.player.env.jumpMul = v; },
  },
  {
    id: 'gravity', group: 'Player', type: 'slider', label: 'Gravity', def: 1,
    min: 0, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×',
    apply: (g, v) => { g.player.env.gravity = v; },
  },
  {
    id: 'heal', group: 'Player', type: 'action', label: 'Full heal',
    run: (g) => {
      g.stats.health = g.stats.maxHealth; g.stats.stamina = g.stats.maxStamina;
      g.stats.hunger = 100; g.stats.thirst = 100; g.stats.bleeding = 0; g.stats.poison = 0;
      Audio.heal();
      return 'Patched up';
    },
  },

  /* ---------------- weapons ---------------- */
  {
    id: 'infAmmo', group: 'Weapons', type: 'toggle', label: 'Infinite ammo', def: true,
    help: 'Magazines refill and reserves never run down.',
    apply: (g, on) => {
      if (!on || !g.weapons.current || g.weapons.current.kind !== 'gun') return;
      const w = g.weapons.current;
      if (g.weapons.magazine < w.mag) {
        g.weapons.magazine = w.mag;
        // Cancel any reload in progress: with infinite ammo there is nothing
        // to reload, and waiting behind the animation is not what was asked for.
        if (g.weapons.state === 'reloading') { g.weapons.state = 'idle'; g.weapons.reloadProgress = 0; }
      }
      if (g.inventory.count(w.ammo) < 200) g.inventory.add(w.ammo, 200 - g.inventory.count(w.ammo));
    },
  },
  {
    id: 'noRecoil', group: 'Weapons', type: 'toggle', label: 'No recoil', def: false,
    apply: (g, on) => { if (on) { g.weapons.kick = 0; g.weapons.kickVel = 0; g.player.recoilPitch = 0; } },
  },
  {
    id: 'noSpread', group: 'Weapons', type: 'toggle', label: 'Perfect accuracy', def: false,
    apply: (g, on) => { if (on) g.weapons.spreadBloom = 0; },
  },
  {
    id: 'oneShot', group: 'Weapons', type: 'toggle', label: 'One-shot kills', def: false,
    help: 'Every hit does a thousand damage. Bosses included.',
  },
  {
    id: 'explosive', group: 'Weapons', type: 'toggle', label: 'Explosive rounds', def: false,
    help: 'Every impact throws a blast that damages everything nearby.',
  },
  {
    id: 'giveAll', group: 'Weapons', type: 'action', label: 'Give every weapon',
    run: (g) => {
      let n = 0;
      for (const id of weaponIds()) {
        if (!g.inventory.has(id)) { g.inventory.add(id, 1); n++; }
        const w = WEAPONS[id];
        if (w.ammo) g.inventory.add(w.ammo, 240);
      }
      return `${n} weapons issued`;
    },
  },
  {
    id: 'forge', group: 'Weapons', type: 'action', label: 'Forge a random weapon',
    run: (g) => {
      const seed = (Math.random() * FORGE_SPACE) >>> 0;
      const def = forgeWeapon(seed);
      g.inventory.add(def.id, 1);
      g.inventory.add(def.ammo, 240);
      g.inventory.equip(def.id);
      g.weapons.equip(def.id);
      return `${def.name} — ${def.forgeInfo.tier.label}, power ${def.forgeInfo.rating}`;
    },
  },
  {
    id: 'maxOut', group: 'Weapons', type: 'action', label: 'Max out this weapon',
    run: (g) => {
      const id = g.weapons.currentId;
      if (!id) return 'Nothing in your hands';
      const up = g.armoury.upgradesFor(id);
      for (const k of Object.keys(up)) up[k] = 9;
      g.weapons.refit();
      return 'Every tuning track maxed';
    },
  },

  /* ---------------- spawning ---------------- */
  {
    id: 'creature', group: 'Spawn', type: 'pick', label: 'Creature',
    options: () => [...creatureIds(), ...animalIds()], def: 'stalker',
  },
  {
    id: 'count', group: 'Spawn', type: 'slider', label: 'How many', def: 1,
    min: 1, max: 25, step: 1, fmt: (v) => String(Math.round(v)),
  },
  {
    id: 'spawn', group: 'Spawn', type: 'action', label: 'Spawn them (ahead of you)',
    run: (g, sb) => {
      const kind = sb.get('creature');
      const n = Math.round(sb.get('count'));
      const spawned = sb.spawnAhead(kind, n, 9 + n * 0.5);
      return spawned ? `${spawned} × ${kind}` : `Could not place a ${kind}`;
    },
  },
  {
    id: 'bossPick', group: 'Spawn', type: 'pick', label: 'Boss', options: () => bossIds(), def: 'warden',
  },
  {
    id: 'spawnBoss', group: 'Spawn', type: 'action', label: 'Spawn that boss',
    run: (g, sb) => {
      const id = sb.get('bossPick');
      const p = g.player.position;
      const f = g.player.forward;
      const x = p.x + f.x * 26, z = p.z + f.z * 26;
      const boss = g.entities.spawnBoss(id, x, z, 1);
      if (!boss) return 'No such boss';
      g.boss = boss;
      boss.wake();
      return `${BOSSES[id].name} is here`;
    },
  },
  {
    id: 'freezeAi', group: 'Spawn', type: 'toggle', label: 'Freeze all AI', def: false,
    help: 'Everything stops where it stands. Useful for looking at them closely.',
  },
  {
    id: 'peaceful', group: 'Spawn', type: 'toggle', label: 'Peaceful', def: false,
    help: 'Nothing will attack you. They still wander.',
  },
  {
    id: 'killAll', group: 'Spawn', type: 'action', label: 'Kill everything',
    run: (g) => {
      let n = 0;
      for (const e of g.entities.active.slice()) {
        if (e.alive) { e.die(new THREE.Vector3(0, 1, 0), e.position, 'body'); n++; }
      }
      return `${n} killed`;
    },
  },
  {
    id: 'clearAll', group: 'Spawn', type: 'action', label: 'Remove everything',
    run: (g) => {
      const n = g.entities.active.length;
      g.entities.clear();
      g.boss = null;
      g.ui.hideBossBar();
      return `${n} removed`;
    },
  },

  /* ---------------- world ---------------- */
  {
    id: 'timeScale', group: 'World', type: 'slider', label: 'Time scale', def: 1,
    min: 0.05, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×',
    help: 'Slow motion, or fast forward. Affects everything except the menus.',
    apply: (g, v) => { g.timeScale = v; },
  },
  {
    id: 'brightness', group: 'World', type: 'slider', label: 'Brightness', def: 1.8,
    min: 0.4, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×',
    apply: (g, v) => { if (Math.abs(Settings.get('brightness') - v) > 0.001) Settings.set('brightness', v); },
  },
  {
    id: 'fog', group: 'World', type: 'slider', label: 'Fog', def: 1,
    min: 0, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) + '×',
    apply: (g, v) => {
      if (!g.scene.fog) return;
      const base = (g.world?._sky || g.biome.sky).fogDensity * (165 / Settings.get('viewDistance'));
      g.scene.fog.density = base * v;
    },
  },
  {
    id: 'weather', group: 'World', type: 'pick', label: 'Weather',
    options: () => ['none', 'snow', 'embers', 'spores', 'bubbles'], def: 'none',
  },
  {
    id: 'wind', group: 'World', type: 'slider', label: 'Wind', def: 1,
    min: 0, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) + '×',
  },
  {
    id: 'skyPick', group: 'World', type: 'pick', label: 'Sky and palette',
    options: () => Object.keys(BIOMES), def: 'sandbox',
  },
  {
    id: 'applySky', group: 'World', type: 'action', label: 'Wear that biome’s sky',
    run: (g, sb) => {
      const id = sb.get('skyPick');
      sb.applySky(id);
      return `Sky: ${BIOMES[id].name}`;
    },
  },
  {
    id: 'rebuild', group: 'World', type: 'action', label: 'Rebuild the plain',
    run: (g) => { g.startSandbox(true); return 'Regenerating'; },
  },

  /* ---------------- go somewhere ----------------
   * The mod menu is where you go to *see* things, and the six worlds are the
   * biggest things there are to see. Picking one here builds it for real —
   * its terrain, its sky, its flora, its creatures and its own landmarks —
   * with every mod you have set still on. */
  {
    id: 'worldPick', group: 'Worlds', type: 'pick', label: 'World',
    options: () => ['sandbox', ...BIOME_IDS],
    def: 'sandbox',
    help: 'Which of the six places to build. The plain is the empty one.',
  },
  {
    id: 'goWorld', group: 'Worlds', type: 'action', label: 'Go there',
    help: 'Builds that world from scratch. Your mods come with you.',
    run: (g, sb) => {
      const id = sb.get('worldPick');
      g.startSandbox(true, id);
      return `Building ${(BIOMES[id] || BIOMES.hollow).name}`;
    },
  },
  {
    id: 'rollWorld', group: 'Worlds', type: 'action', label: 'Somewhere at random',
    help: 'A new seed in a world you did not choose.',
    run: (g, sb) => {
      const id = BIOME_IDS[Math.floor(Math.random() * BIOME_IDS.length)];
      sb.set('worldPick', id);
      g.startSandbox(true, id);
      return `Building ${BIOMES[id].name}`;
    },
  },
  {
    id: 'tourWorld', group: 'Worlds', type: 'action', label: 'Take me to a landmark',
    help: 'Drops you at a random one of this world’s places.',
    run: (g) => {
      const lms = g.world?.landmarks || [];
      if (!lms.length) return 'Nothing built here';
      const lm = lms[Math.floor(Math.random() * lms.length)];
      const a = Math.random() * Math.PI * 2;
      const r = (lm.clear || 14) + 6;
      const x = lm.x + Math.cos(a) * r, z = lm.z + Math.sin(a) * r;
      g.player.position.set(x, g.world.terrain.heightAt(x, z) + 0.4, z);
      g.player.yaw = Math.atan2(-(lm.x - x), -(lm.z - z));
      g.player.velocity.set(0, 0, 0);
      lm.discovered = true;
      return lm.label;
    },
  },
  {
    id: 'listWorld', group: 'Worlds', type: 'action', label: 'What is out here?',
    help: 'Names every place in this world and how far away it is.',
    run: (g) => {
      const lms = g.world?.landmarks || [];
      if (!lms.length) return 'Nothing built here';
      const p = g.player.position;
      const near = lms
        .map((l) => ({ l, d: Math.hypot(l.x - p.x, l.z - p.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
        .map(({ l, d }) => `${l.label} ${Math.round(d)}m`);
      return `${lms.length} places · ${near.join(' · ')}`;
    },
  },

  /* ---------------- camera and fun ---------------- */
  {
    id: 'fov', group: 'Camera', type: 'slider', label: 'Field of view', def: 74,
    min: 55, max: 130, step: 1, fmt: (v) => Math.round(v) + '°',
    apply: (g, v) => { if (g.baseFov !== v) { g.baseFov = v; } },
  },
  {
    id: 'thirdPerson', group: 'Camera', type: 'slider', label: 'Third person', def: 0,
    min: 0, max: 9, step: 0.25, fmt: (v) => (v < 0.1 ? 'OFF' : v.toFixed(1) + ' m'),
    help: 'Pulls the camera back behind you. The weapon hides past two metres.',
  },
  {
    id: 'bigHeads', group: 'Fun', type: 'toggle', label: 'Big heads', def: false,
    help: 'Exactly what it says. It makes the Stalker funnier and the Crawler worse.',
  },
  {
    id: 'creatureScale', group: 'Fun', type: 'slider', label: 'Creature size', def: 1,
    min: 0.25, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) + '×',
  },
  {
    id: 'lowGravityCreatures', group: 'Fun', type: 'toggle', label: 'Launch on death', def: false,
    help: 'Anything you kill leaves at speed.',
  },
  {
    id: 'discoLamp', group: 'Fun', type: 'toggle', label: 'Colour-cycle the lamp', def: false,
  },
  {
    id: 'rain', group: 'Fun', type: 'action', label: 'Rain creatures',
    run: (g, sb) => {
      const kind = sb.get('creature');
      const n = Math.round(sb.get('count'));
      let made = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 18;
        const x = g.player.position.x + Math.cos(a) * r;
        const z = g.player.position.z + Math.sin(a) * r;
        const e = sb.spawnAt(kind, x, z);
        if (e) { e.position.y += 22 + Math.random() * 18; e.velocity.y = 0; made++; }
      }
      return `${made} falling`;
    },
  },
];

export const MOD_GROUPS = ['Player', 'Weapons', 'Spawn', 'World', 'Worlds', 'Camera', 'Fun'];

/* ------------------------------------------------------------------ */
/* the tutorial                                                        */
/* ------------------------------------------------------------------ */

export const TUTORIAL = [
  {
    title: 'This is the sandbox',
    body: 'A flat, lit, empty plain with nothing in it that wants to kill you — until you ask for '
      + 'something that does. Nothing here is saved and nothing here counts.',
    focus: null,
  },
  {
    title: 'The mod menu',
    body: 'Press ` (backquote) or F1 at any time to open and close it. The game keeps running behind '
      + 'it, so you can watch a change take effect while you make it.',
    focus: null, key: '`',
  },
  {
    title: 'Switches take effect immediately',
    body: 'Turn on God mode and nothing can hurt you from that instant. Every switch is applied every '
      + 'frame, so the game cannot quietly undo it.',
    focus: 'god',
  },
  {
    title: 'Sliders are live',
    body: 'Drag Move speed and you are moving faster before you let go. Time scale is the fun one: '
      + 'take it to 0.15 and shoot something.',
    focus: 'speed',
  },
  {
    title: 'Spawn things',
    body: 'Pick a creature, pick how many, and press the button — they appear in front of you. '
      + 'Every mutant, every animal and all six bosses are in the list.',
    focus: 'spawn',
  },
  {
    title: 'Wear another biome',
    body: 'The sky, fog, light and colour of any of the six places can be worn on the plain. Try the '
      + 'Long Dark, then set gravity to 0.3.',
    focus: 'applySky',
  },
  {
    title: 'You are done',
    body: 'F1 or ` closes the menu. Everything else works as it does in the real game: M marks a '
      + 'waypoint, Tab is your inventory, and the armoury is on the pause screen.',
    focus: null,
  },
];

/* ------------------------------------------------------------------ */
/* the sandbox itself                                                  */
/* ------------------------------------------------------------------ */

export class Sandbox {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.values = {};
    for (const m of MODS) if (m.def !== undefined) this.values[m.id] = m.def;
    this._skyId = null;
    this._weatherCol = new THREE.Color();
  }

  get(id) { return this.values[id]; }

  set(id, v) {
    this.values[id] = v;
    const mod = MODS.find((m) => m.id === id);
    if (mod && mod.apply && this.game.world) mod.apply(this.game, v);
    return v;
  }

  reset() {
    for (const m of MODS) if (m.def !== undefined) this.values[m.id] = m.def;
    const g = this.game;
    if (g.world) {
      g.timeScale = 1;
      g.player.noclip = false;
      g.player.env.moveMul = 1; g.player.env.jumpMul = 1; g.player.env.gravity = 1;
      g.baseFov = 74;
    }
  }

  /** Push every current value back into a freshly built world. */
  reapply() {
    const g = this.game;
    if (!g.world) return;
    for (const m of MODS) {
      if (!m.apply) continue;
      const v = this.values[m.id];
      if (v !== undefined) m.apply(g, v);
    }
    if (this._skyId && this._skyId !== 'sandbox') this.applySky(this._skyId);
  }

  /* ---------------- actions ---------------- */

  run(id) {
    const mod = MODS.find((m) => m.id === id);
    if (!mod || !mod.run) return null;
    const msg = mod.run(this.game, this);
    if (msg) this.game.ui.toast(msg, 'good');
    Audio.uiClick();
    return msg;
  }

  spawnAt(kind, x, z) {
    const g = this.game;
    if (MUTANT_CONFIG[kind]) return g.entities.spawnMutant(kind, x, z);
    if (ANIMAL_CONFIG[kind]) return g.entities.spawnAnimal(kind, x, z);
    return null;
  }

  /** Put `n` of `kind` in an arc in front of the player. */
  spawnAhead(kind, n, radius) {
    const g = this.game;
    const p = g.player.position;
    const f = g.player.forward;
    const base = Math.atan2(f.x, f.z);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.6;
      const a = base + spread;
      const r = radius * (0.7 + Math.random() * 0.6);
      const e = this.spawnAt(kind, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r);
      if (e) made++;
    }
    return made;
  }

  /** Wear another biome's sky, fog and light without regenerating the ground. */
  applySky(id) {
    const g = this.game;
    const B = BIOMES[id];
    if (!B || !g.world) return;
    this._skyId = id;
    const K = B.sky;
    g.biome = { ...g.biome, sky: K, fx: B.fx };
    const w = g.world;
    w.biome = g.biome;
    if (g.scene.fog) { g.scene.fog.color.setHex(K.fog); g.scene.background = g.scene.fog.color; }
    if (w.sky) {
      w.sky.material.uniforms.top.value.setHex(K.top);
      w.sky.material.uniforms.horizon.value.setHex(K.horizon);
      w.sky.material.uniforms.bottom.value.setHex(K.bottom);
      w.sky.material.uniforms.nebula.value = K.nebula || 0;
    }
    if (w.moonSprite) { w.moonSprite.material.color.setHex(K.moon); w.moonSprite.scale.set(K.moonSize, K.moonSize, 1); }
    if (w.moon) w.moon.color.setHex(K.moonLight);
    if (w.hemi) { w.hemi.color.setHex(K.hemiSky); w.hemi.groundColor.setHex(K.hemiGround); }
    if (w.fillAmbient) w.fillAmbient.color.setHex(K.hemiSky);
    w.applyGraphics();
    Audio.setMusicPalette(id === 'sandbox' ? 'menu' : id);
  }

  /* ---------------- per-frame ---------------- */

  update(dt) {
    if (!this.active || !this.game.world) return;
    const g = this.game;

    for (const m of MODS) {
      if (!m.apply) continue;
      const v = this.values[m.id];
      if (v === undefined) continue;
      if (m.type === 'toggle' && !v) continue;
      m.apply(g, v);
    }

    // things that are easier to do here than as an `apply`
    if (this.values.freezeAi) {
      for (const e of g.entities.active) { e.velocity.set(0, 0, 0); e.state = 'IDLE'; e.attackTimer = 1; }
    }
    if (this.values.peaceful) {
      for (const e of g.entities.active) {
        if (e.faction === 'mutant') { e.alertLevel = 0; e.attackTimer = Math.max(e.attackTimer, 2); }
      }
    }
    if (this.values.creatureScale !== 1 || this.values.bigHeads) {
      const s = this.values.creatureScale;
      for (const e of g.entities.active) {
        if (!e.model) continue;
        if (Math.abs(e.model.scale.x - s) > 0.001) e.model.scale.setScalar(s);
        const head = e.parts && e.parts.head;
        if (head) {
          const hs = this.values.bigHeads ? 2.6 : 1;
          if (Math.abs(head.scale.x - hs) > 0.001) head.scale.setScalar(hs);
        }
      }
    }
    if (this.values.discoLamp && g.flashlight) {
      const h = (g.time * 0.35) % 1;
      this._weatherCol.setHSL(h, 0.85, 0.6);
      g.flashlight.spot.color.copy(this._weatherCol);
    }
    if (this.values.weather && this.values.weather !== 'none' && (g.frame & 3) === 0) {
      this._weatherCol.setHex(g.biome.fx.moteColor || 0xffffff);
      g.fx.weather(this.values.weather, g.player.position, 3, 26,
        [this._weatherCol.r, this._weatherCol.g, this._weatherCol.b]);
    }
    if (this.values.wind !== undefined) {
      // read by Vegetation's wind uniform, set in WorldManager.update
      g.windScale = this.values.wind;
    }
  }

  /** Third-person offset, applied after the player has posed the camera. */
  applyCamera() {
    if (!this.active) return;
    const d = this.values.thirdPerson || 0;
    const g = this.game;
    if (d < 0.1) { if (g.weapons) g.weapons.root.visible = true; return; }
    const cam = g.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    cam.position.addScaledVector(dir, -d);
    cam.position.y += d * 0.18;
    if (g.weapons) g.weapons.root.visible = d < 2;
  }

  /** Damage hooks the weapon and damage systems ask about. */
  get damageMultiplier() { return this.active && this.values.oneShot ? 1000 : 1; }
  get explosive() { return this.active && this.values.explosive; }
  get godMode() { return this.active && this.values.god; }
  get launchOnDeath() { return this.active && this.values.lowGravityCreatures; }

  serialize() { return { values: { ...this.values }, sky: this._skyId }; }
  deserialize(d) {
    if (!d) return;
    Object.assign(this.values, d.values || {});
    if (d.sky) this._skyId = d.sky;
  }
}
