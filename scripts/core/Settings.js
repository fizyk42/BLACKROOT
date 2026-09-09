/**
 * Settings — persisted user options with quality presets.
 * Systems subscribe with onChange() and re-read only what they care about.
 */

const KEY = 'blackroot.settings.v1';

export const DEFAULTS = {
  // graphics
  renderScale: 1.0,
  fullscreen: false,
  quality: 'high',          // low | medium | high | ultra
  shadows: 'high',          // off | low | medium | high
  antialias: true,
  ao: true,                 // cheap screen-space-ish ambient darkening term
  fogQuality: 'high',       // low | high
  viewDistance: 165,        // metres
  foliage: 1.0,             // 0..1.4 density multiplier
  textureQuality: 'high',
  vsync: true,
  fpsLimit: 0,              // 0 = unlimited
  showFps: false,
  timeOfDay: 'morning',     // morning | night — night is the original grade
  brightness: 1.8,          // 0.6 = the original moonless grade, 3.0 = "I can see"
  ambientFill: 0.75,          // a floor of light so shapes read even unlit
  guide: true,               // the lantern that leads you to the objective
  waypoints: true,           // objective markers in the world and on the HUD
  waypointDistance: true,

  // audio
  volMaster: 0.85,
  volSfx: 1.0,
  volAmbient: 0.85,
  volMusic: 0.55,
  subtitles: true,

  // controls
  sensitivity: 1.0,
  adsSensitivity: 0.65,
  lookMode: 'auto',         // auto | lock | cursor — see Input.js
  trackpad: 'auto',         // auto | on | off — boosts a trackpad's tiny deltas
  edgeTurn: 1.0,            // cursor look: turn rate when the pointer is at an edge
  invertY: false,
  toggleSprint: false,
  toggleCrouch: false,
  toggleAds: false,
  headBob: 1.0,

  // controller
  padSensitivity: 1.0,
  padAdsSensitivity: 0.75,
  padDeadzoneLeft: 0.12,
  padDeadzoneRight: 0.10,
  padCurve: 'standard',        // standard | linear | dynamic
  padButtonLayout: 'default',  // default | tactical | bumperJumper
  padStickLayout: 'default',   // default | southpaw
  padRumble: true,
  padAimAssist: 1.0,           // 0 = off
  padGlyphs: 'auto',           // auto | playstation | xbox

  // gameplay
  difficulty: 'normal',     // story | normal | harsh | brutal
  crosshair: true,
  compass: true,
  hitmarkers: true,
  thirstEnabled: true,
  directorEnabled: true,
};

export const QUALITY_PRESETS = {
  low:    { renderScale: 0.72, shadows: 'off',    antialias: false, ao: false, fogQuality: 'low',  viewDistance: 95,  foliage: 0.45, textureQuality: 'low' },
  medium: { renderScale: 0.88, shadows: 'low',    antialias: false, ao: true,  fogQuality: 'high', viewDistance: 130, foliage: 0.75, textureQuality: 'medium' },
  high:   { renderScale: 1.0,  shadows: 'medium', antialias: true,  ao: true,  fogQuality: 'high', viewDistance: 165, foliage: 1.0,  textureQuality: 'high' },
  ultra:  { renderScale: 1.0,  shadows: 'high',   antialias: true,  ao: true,  fogQuality: 'high', viewDistance: 210, foliage: 1.3,  textureQuality: 'high' },
};

/**
 * Difficulty.
 *
 * The old NORMAL was, in practice, a hard mode: full incoming damage, no
 * health recovery of any kind, hunger and thirst running the whole time, and
 * a forest full of things faster than you. It asked for the play of someone
 * who already knew the game, from someone who by definition did not.
 *
 * So the ladder moved down a rung. What used to be NORMAL is now HARSH and
 * what used to be HARSH is BRUTAL, both still there, unchanged, for anyone
 * who wants them. The new default is genuinely forgiving: you take a bit over
 * half the damage, hit harder, find more, and — the big one — you heal back up
 * between fights instead of carrying every scratch to the end of the run.
 *
 * `regen` is health per second once you have been out of trouble for
 * `regenDelay` seconds, capped at `regenCap` of your maximum so that a bad
 * fight still costs you something you have to treat with a bandage.
 */
export const DIFFICULTY = {
  story: {
    dmgTaken: 0.28, dmgDealt: 1.7, hungerRate: 0.3, thirstRate: 0.3,
    enemyDensity: 0.45, lootMul: 1.8,
    regen: 7.0, regenDelay: 2.5, regenCap: 1.0, iFrames: 0.9, bleedMul: 0.3,
  },
  normal: {
    dmgTaken: 0.58, dmgDealt: 1.32, hungerRate: 0.55, thirstRate: 0.55,
    enemyDensity: 0.72, lootMul: 1.4,
    regen: 4.2, regenDelay: 4.5, regenCap: 0.85, iFrames: 0.6, bleedMul: 0.55,
  },
  harsh: {
    dmgTaken: 1.0, dmgDealt: 1.0, hungerRate: 1.0, thirstRate: 1.0,
    enemyDensity: 1.0, lootMul: 1.0,
    regen: 1.6, regenDelay: 9, regenCap: 0.5, iFrames: 0.35, bleedMul: 1.0,
  },
  brutal: {
    dmgTaken: 1.6, dmgDealt: 0.85, hungerRate: 1.45, thirstRate: 1.45,
    enemyDensity: 1.45, lootMul: 0.72,
    regen: 0, regenDelay: 999, regenCap: 0, iFrames: 0.2, bleedMul: 1.25,
  },
};

class SettingsStore {
  constructor() {
    this.data = { ...DEFAULTS };
    this._subs = [];
    this.load();
  }

  get(k) { return this.data[k]; }

  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    this.save();
    this._emit(k, v);
  }

  applyPreset(name) {
    const p = QUALITY_PRESETS[name];
    if (!p) return;
    this.data.quality = name;
    Object.assign(this.data, p);
    this.save();
    for (const k of Object.keys(p)) this._emit(k, this.data[k]);
    this._emit('quality', name);
  }

  difficulty() { return DIFFICULTY[this.data.difficulty] || DIFFICULTY.normal; }

  reset() {
    this.data = { ...DEFAULTS };
    this.save();
    for (const k of Object.keys(this.data)) this._emit(k, this.data[k]);
  }

  onChange(fn) { this._subs.push(fn); return () => { const i = this._subs.indexOf(fn); if (i >= 0) this._subs.splice(i, 1); }; }
  _emit(k, v) { for (const fn of this._subs) { try { fn(k, v); } catch (e) { console.warn('settings sub failed', e); } } }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* ignore corrupt settings */ }
  }
}

export const Settings = new SettingsStore();
