// Persistent settings. Graphics presets drive renderer, streaming and population density.

const KEY = 'pa_settings_v1';

export const PRESETS = {
  low: {
    label: 'Low',
    shadows: false, shadowSize: 1024, pixelRatio: 0.72, anisotropy: 1,
    drawDistance: 420, streamRadius: 3, traffic: 10, peds: 6, streetLights: 3,
    rainParticles: 900, reflections: false, fogQuality: 'cheap',
  },
  medium: {
    label: 'Medium',
    shadows: true, shadowSize: 1024, pixelRatio: 0.9, anisotropy: 4,
    drawDistance: 620, streamRadius: 4, traffic: 18, peds: 12, streetLights: 5,
    rainParticles: 2200, reflections: false, fogQuality: 'normal',
  },
  high: {
    label: 'High',
    shadows: true, shadowSize: 2048, pixelRatio: 1.0, anisotropy: 8,
    drawDistance: 900, streamRadius: 5, traffic: 28, peds: 20, streetLights: 7,
    rainParticles: 4200, reflections: true, fogQuality: 'normal',
  },
  ultra: {
    label: 'Ultra',
    shadows: true, shadowSize: 4096, pixelRatio: 1.0, anisotropy: 16,
    drawDistance: 1300, streamRadius: 7, traffic: 40, peds: 30, streetLights: 9,
    rainParticles: 7000, reflections: true, fogQuality: 'normal',
  },
};

const DEFAULTS = {
  preset: 'medium',
  resolutionScale: 1.0,     // multiplies the preset pixel ratio
  fov: 68,
  motionBlurAmount: 0,      // reserved
  // input
  mouseSensitivity: 1.0,
  padSensitivity: 1.0,
  invertY: false,
  stickDeadzone: 0.18,
  triggerDeadzone: 0.06,
  padType: 'auto',          // auto | xbox | playstation
  bindings: null,           // filled by input.js defaults
  // gameplay
  difficulty: 'normal',     // relaxed | normal | hard
  trafficDensity: 1.0,
  autoSaveMinutes: 3,
  // accessibility
  subtitles: true,
  subtitleSize: 1.0,
  reducedCameraShake: false,
  reducedFlashing: false,
  holdToSprint: true,
  aimAssist: true,
  colourBlindMode: 'off',   // off | protan | deutan | tritan
  // audio
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
};

export const DIFFICULTY = {
  relaxed: { damageTaken: 0.55, wantedGain: 0.7, payout: 1.15, jobTime: 1.3, label: 'Relaxed' },
  normal: { damageTaken: 1.0, wantedGain: 1.0, payout: 1.0, jobTime: 1.0, label: 'Normal' },
  hard: { damageTaken: 1.6, wantedGain: 1.35, payout: 0.85, jobTime: 0.82, label: 'Hard' },
};

function safeStore() {
  try {
    const t = '__pa_probe__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return localStorage;
  } catch (e) {
    // Sandboxed iframes / private modes: fall back to a session-only shim so the
    // game still runs; the player is told saving is unavailable.
    const mem = new Map();
    return {
      unavailable: true,
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }
}

export const store = safeStore();

export const settings = Object.assign({}, DEFAULTS);

export function loadSettings() {
  try {
    const raw = store.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (e) { /* corrupt settings should never block launch */ }
  if (!PRESETS[settings.preset]) settings.preset = 'high';
  return settings;
}

export function saveSettings() {
  try { store.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function preset() { return PRESETS[settings.preset] || PRESETS.high; }
export function difficulty() { return DIFFICULTY[settings.difficulty] || DIFFICULTY.normal; }
export function effectivePixelRatio() {
  return Math.min(window.devicePixelRatio || 1, preset().pixelRatio * settings.resolutionScale);
}
