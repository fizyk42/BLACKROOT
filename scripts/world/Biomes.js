/**
 * Biomes — the places the Hollow opens onto.
 *
 * A biome is a *descriptor*, not a second world generator. Terrain, foliage,
 * sky, water, audio and creature rosters all read their numbers from here, so
 * adding a place is a data change rather than a parallel code path that can
 * drift out of step with the one the game was actually tested on.
 *
 * The first biome is always the Hollow — the player has to learn one set of
 * rules before the game is allowed to break them. Everything after it is a
 * seeded shuffle, so no two runs walk the same road.
 */
import { makeRNG } from '../core/RNG.js';

export const BIOMES = {

  /* ================================================================ */
  hollow: {
    id: 'hollow', name: 'THE HOLLOW', sub: 'NIGHTFALL IN THE HOLLOW',
    blurb: 'Black pine, wet leaf litter, and something that has learnt the shape of a person.',
    first: true,

    terrain: {
      relief: 1.0, ridge: 1.0, detail: 1.0,
      water: 'creek',                 // creek + lake
      floor: 0,                       // flood level offset, unused for 'creek'
      palette: {
        base: [0.115, 0.108, 0.078],
        litter: [0.075, 0.050, 0.016],
        moss: [-0.030, 0.022, -0.012],
        rock: [0.148, 0.146, 0.138],
        mud: [0.085, 0.070, 0.052],
      },
    },

    sky: {
      top: 0x05080f, horizon: 0x141c22, bottom: 0x0b0f12,
      fog: 0x05070a, fogDensity: 0.0122,
      stars: 1400, starTint: [1.0, 0.92, 1.0], nebula: 0,
      moon: 0xcfd8e8, moonLight: 0x9fb6d8, moonIntensity: 0.55, moonSize: 120,
      hemiSky: 0x2a3a4e, hemiGround: 0x0a0c08, hemiIntensity: 0.22,
      exposure: 1.15,
    },

    flora: {
      canopyA: 'conifer', canopyB: 'broadleaf', trunk: 'bark',
      under: 'bush', ground: 'fern', carpet: 'grass', debris: 'log', stone: 'boulder',
      colors: {
        trunk: 0x8a7a68, canopyA: 0x2c3a26, canopyB: 0x37401f,
        under: 0x9aa48a, ground: 0x8fa07e, carpet: 0xa9b295, stone: 0x9a988f,
      },
      counts: { tree: 1.0, bush: 1.0, fern: 1.0, grass: 1.0, rock: 1.0, log: 1.0 },
      leafHue: 102,
    },

    physics: { gravity: 1.0, drag: 1.0, moveMul: 1.0, jumpMul: 1.0 },
    fx: { moteColor: 0xb9c4d0, moteRate: 1.0, fall: null },
    audio: { ambience: 'forest', dreadBase: 0.0 },
    creatures: { mutants: ['stalker', 'crawler', 'screamer', 'brute'], wildlife: true, density: 1.0 },
    boss: 'warden',
  },

  /* ================================================================ */
  void: {
    id: 'void', name: 'THE LONG DARK', sub: 'WHERE THE SKY CAME APART',
    blurb: 'The ground still holds you. Nothing else here agrees to.',

    terrain: {
      relief: 1.45, ridge: 1.7, detail: 0.7,
      water: 'none',
      palette: {
        base: [0.055, 0.048, 0.086],
        litter: [0.030, 0.010, 0.075],
        moss: [0.020, -0.005, 0.050],
        rock: [0.088, 0.082, 0.120],
        mud: [0.040, 0.030, 0.070],
      },
    },

    sky: {
      top: 0x05000e, horizon: 0x1a0a34, bottom: 0x0a0418,
      fog: 0x0a0618, fogDensity: 0.0068,
      stars: 5200, starTint: [1.0, 0.95, 1.15], nebula: 1,
      moon: 0xb18cff, moonLight: 0x8f6cff, moonIntensity: 0.42, moonSize: 210,
      hemiSky: 0x2a1a52, hemiGround: 0x0a0616, hemiIntensity: 0.30,
      exposure: 1.22,
    },

    flora: {
      canopyA: 'shard', canopyB: 'shard', trunk: 'obsidian',
      under: 'crystal', ground: 'crystal', carpet: 'ashgrass', debris: 'monolith', stone: 'floatstone',
      colors: {
        trunk: 0x161426, canopyA: 0x9d7bff, canopyB: 0x6f5bd6,
        under: 0x7b6ad8, ground: 0x5f57b0, carpet: 0x39355c, stone: 0x2a2740,
      },
      counts: { tree: 0.42, bush: 0.5, fern: 0.3, grass: 0.5, rock: 1.6, log: 0.5 },
      emissive: { canopyA: 0.9, under: 0.7, ground: 0.5 },
      leafHue: 268,
    },

    physics: { gravity: 0.42, drag: 1.0, moveMul: 1.06, jumpMul: 1.55 },
    fx: { moteColor: 0xa88cff, moteRate: 2.2, fall: null },
    audio: { ambience: 'void', dreadBase: 0.18 },
    creatures: { mutants: ['choir', 'stalker', 'screamer'], wildlife: false, density: 0.85 },
    boss: 'chorister',
  },

  /* ================================================================ */
  abyss: {
    id: 'abyss', name: 'THE DROWNED SHELF', sub: 'BELOW THE LAST LIGHT',
    blurb: 'Everything down here is patient, and everything down here is listening.',

    terrain: {
      relief: 0.75, ridge: 0.5, detail: 1.3,
      water: 'flood', floor: 26,      // the whole map sits under a water plane
      palette: {
        base: [0.055, 0.082, 0.086],
        litter: [0.020, 0.055, 0.045],
        moss: [-0.010, 0.030, 0.020],
        rock: [0.078, 0.098, 0.108],
        mud: [0.048, 0.062, 0.062],
      },
    },

    sky: {
      top: 0x04202c, horizon: 0x062a34, bottom: 0x010a10,
      fog: 0x04222c, fogDensity: 0.030,
      stars: 320, starTint: [0.7, 1.0, 1.0], nebula: 0,
      moon: 0x8fe8ff, moonLight: 0x62c0d8, moonIntensity: 0.30, moonSize: 260,
      hemiSky: 0x14586a, hemiGround: 0x03161c, hemiIntensity: 0.34,
      exposure: 1.30,
    },

    flora: {
      canopyA: 'kelp', canopyB: 'coral', trunk: 'kelpstalk',
      under: 'coralfan', ground: 'anemone', carpet: 'seagrass', debris: 'driftwood', stone: 'boulder',
      colors: {
        trunk: 0x3f4a3a, canopyA: 0x40624a, canopyB: 0xa8586a,
        under: 0xc06a7a, ground: 0x8f6ab0, carpet: 0x3e6a58, stone: 0x5c6a6e,
      },
      counts: { tree: 0.75, bush: 1.3, fern: 1.4, grass: 1.5, rock: 1.2, log: 0.4 },
      emissive: { under: 0.55, ground: 0.8 },
      leafHue: 158,
    },

    physics: { gravity: 0.30, drag: 2.6, moveMul: 0.62, jumpMul: 1.25 },
    fx: { moteColor: 0xbfe8ff, moteRate: 3.0, fall: 'bubbles' },
    audio: { ambience: 'abyss', dreadBase: 0.22 },
    creatures: { mutants: ['drowned', 'crawler', 'screamer'], wildlife: false, density: 0.8 },
    boss: 'gillfather',
  },

  /* ================================================================ */
  cinder: {
    id: 'cinder', name: 'THE CINDER REACH', sub: 'IT IS STILL BURNING',
    blurb: 'The fire went through here a long time ago. It has not finished.',

    terrain: {
      relief: 1.1, ridge: 1.25, detail: 1.1,
      water: 'none',
      palette: {
        base: [0.062, 0.052, 0.046],
        litter: [0.055, 0.026, 0.008],
        moss: [0.030, 0.006, -0.010],
        rock: [0.098, 0.086, 0.078],
        mud: [0.038, 0.028, 0.024],
      },
    },

    sky: {
      top: 0x160806, horizon: 0x4a1408, bottom: 0x0e0604,
      fog: 0x1c0a06, fogDensity: 0.0165,
      stars: 260, starTint: [1.0, 0.7, 0.5], nebula: 0,
      moon: 0xff7a3a, moonLight: 0xff8a4a, moonIntensity: 0.48, moonSize: 150,
      hemiSky: 0x4e2010, hemiGround: 0x160a06, hemiIntensity: 0.30,
      exposure: 1.10,
    },

    flora: {
      canopyA: 'burnt', canopyB: 'burnt', trunk: 'charwood',
      under: 'emberbush', ground: 'ashfern', carpet: 'ashgrass', debris: 'log', stone: 'boulder',
      colors: {
        trunk: 0x2e2723, canopyA: 0x3a2a20, canopyB: 0x33251c,
        under: 0x5c3020, ground: 0x4a3a2c, carpet: 0x5a5148, stone: 0x6a5f56,
      },
      counts: { tree: 0.85, bush: 0.5, fern: 0.4, grass: 0.7, rock: 1.3, log: 2.2 },
      emissive: { under: 0.6 },
      leafHue: 22,
    },

    physics: { gravity: 1.0, drag: 1.0, moveMul: 1.0, jumpMul: 1.0 },
    fx: { moteColor: 0xff8848, moteRate: 3.4, fall: 'embers' },
    audio: { ambience: 'cinder', dreadBase: 0.20 },
    creatures: { mutants: ['ashwalker', 'brute', 'crawler'], wildlife: false, density: 1.1 },
    boss: 'pyreking',
  },

  /* ================================================================ */
  permafrost: {
    id: 'permafrost', name: 'THE STILL WHITE', sub: 'NOTHING HERE HAS MOVED IN YEARS',
    blurb: 'Cold enough that the things in it stopped rotting and started waiting.',

    terrain: {
      relief: 1.25, ridge: 1.4, detail: 0.85,
      water: 'none',
      palette: {
        base: [0.190, 0.205, 0.225],
        litter: [-0.020, -0.010, 0.010],
        moss: [-0.030, -0.015, 0.010],
        rock: [0.140, 0.148, 0.166],
        mud: [0.120, 0.135, 0.155],
      },
    },

    sky: {
      top: 0x0a1420, horizon: 0x24435c, bottom: 0x0c1620,
      fog: 0x152836, fogDensity: 0.0210,
      stars: 2200, starTint: [0.85, 0.95, 1.15], nebula: 0,
      moon: 0xdfeeff, moonLight: 0xbcd8f0, moonIntensity: 0.72, moonSize: 165,
      hemiSky: 0x39607e, hemiGround: 0x1a2630, hemiIntensity: 0.34,
      exposure: 1.05,
    },

    flora: {
      canopyA: 'frozenconifer', canopyB: 'icecrown', trunk: 'frostbark',
      under: 'icebush', ground: 'frostfern', carpet: 'snowgrass', debris: 'log', stone: 'icerock',
      colors: {
        trunk: 0x6a6e74, canopyA: 0x33484a, canopyB: 0x7fa8bc,
        under: 0x8fb0c0, ground: 0x9cb8c6, carpet: 0xc8d8e2, stone: 0xa8bccc,
      },
      counts: { tree: 0.9, bush: 0.6, fern: 0.5, grass: 0.9, rock: 1.4, log: 0.8 },
      leafHue: 190,
    },

    physics: { gravity: 1.0, drag: 1.0, moveMul: 0.88, jumpMul: 0.95, slip: 0.55 },
    fx: { moteColor: 0xdff0ff, moteRate: 2.6, fall: 'snow' },
    audio: { ambience: 'permafrost', dreadBase: 0.16 },
    creatures: { mutants: ['rimewretch', 'stalker', 'brute'], wildlife: false, density: 0.9 },
    boss: 'hoarmother',
  },

  /* ================================================================ */
  bloom: {
    id: 'bloom', name: 'THE BLOOM', sub: 'IT GOT INTO EVERYTHING',
    blurb: 'The forest is still here. It is simply not the one in charge any more.',

    terrain: {
      relief: 0.9, ridge: 0.8, detail: 1.2,
      water: 'creek',
      palette: {
        base: [0.085, 0.072, 0.098],
        litter: [0.045, 0.070, 0.020],
        moss: [-0.020, 0.045, 0.010],
        rock: [0.110, 0.100, 0.120],
        mud: [0.060, 0.055, 0.070],
      },
    },

    sky: {
      top: 0x0c0616, horizon: 0x2a1440, bottom: 0x0a0812,
      fog: 0x130a1e, fogDensity: 0.0250,
      stars: 700, starTint: [1.0, 0.9, 1.1], nebula: 0,
      moon: 0xc8ff9a, moonLight: 0x9fd07a, moonIntensity: 0.50, moonSize: 135,
      hemiSky: 0x3a2a5a, hemiGround: 0x141018, hemiIntensity: 0.30,
      exposure: 1.18,
    },

    flora: {
      canopyA: 'sporecap', canopyB: 'sporecap', trunk: 'myceliumstalk',
      under: 'puffball', ground: 'gillfern', carpet: 'mossgrass', debris: 'log', stone: 'boulder',
      colors: {
        trunk: 0x7d7259, canopyA: 0x7d4a63, canopyB: 0x5c6a3a,
        under: 0x9a6a80, ground: 0x6f8a4a, carpet: 0x6d8452, stone: 0x77707e,
      },
      counts: { tree: 1.1, bush: 1.5, fern: 1.6, grass: 1.3, rock: 0.8, log: 1.4 },
      emissive: { canopyA: 0.45, under: 0.8, ground: 0.35 },
      leafHue: 84,
    },

    physics: { gravity: 1.0, drag: 1.0, moveMul: 0.94, jumpMul: 1.0 },
    fx: { moteColor: 0xc9ff8a, moteRate: 4.0, fall: 'spores' },
    audio: { ambience: 'bloom', dreadBase: 0.24 },
    creatures: { mutants: ['sporebearer', 'crawler', 'screamer'], wildlife: false, density: 1.05 },
    boss: 'motherstalk',
  },

  /* ================================================================ */
  /**
   * The sandbox plain. Deliberately not one of the six: it is flat, bright,
   * empty and endless-feeling, because a sandbox is a place to try things in,
   * and every feature of a horror biome — the dark, the fog, the things in it
   * — is a feature that gets in the way of trying things.
   */
  sandbox: {
    id: 'sandbox', name: 'THE PLAIN', sub: 'SANDBOX',
    blurb: 'Flat, lit, and nothing here wants anything from you. Open the mod menu and break it.',
    sandbox: true,

    terrain: {
      relief: 0.035, ridge: 0.0, detail: 0.05,
      water: 'none',
      palette: {
        base: [0.150, 0.158, 0.140],
        litter: [0.030, 0.034, 0.018],
        moss: [-0.010, 0.020, -0.006],
        rock: [0.180, 0.180, 0.176],
        mud: [0.120, 0.120, 0.110],
      },
    },

    sky: {
      top: 0x14243a, horizon: 0x51617a, bottom: 0x1a2430,
      fog: 0x33404f, fogDensity: 0.0026,
      stars: 900, starTint: [1.0, 1.0, 1.0], nebula: 0,
      moon: 0xffffff, moonLight: 0xdfe8f5, moonIntensity: 1.5, moonSize: 150,
      hemiSky: 0x8fa8c4, hemiGround: 0x50524a, hemiIntensity: 0.85,
      exposure: 1.25,
    },

    flora: {
      canopyA: 'conifer', canopyB: 'broadleaf', trunk: 'bark',
      under: 'bush', ground: 'fern', carpet: 'grass', debris: 'log', stone: 'boulder',
      colors: {
        trunk: 0x8a7a68, canopyA: 0x3c5030, canopyB: 0x47552a,
        under: 0x9aa48a, ground: 0x8fa07e, carpet: 0xa9b295, stone: 0x9a988f,
      },
      counts: { tree: 0.10, bush: 0.10, fern: 0.10, grass: 0.35, rock: 0.12, log: 0.05 },
      leafHue: 102,
    },

    physics: { gravity: 1.0, drag: 1.0, moveMul: 1.0, jumpMul: 1.0 },
    fx: { moteColor: 0xcfe0f0, moteRate: 0.6, fall: null },
    audio: { ambience: 'forest', dreadBase: 0.0 },
    creatures: { mutants: ['stalker', 'brute', 'crawler', 'screamer'], wildlife: false, density: 0.0 },
    boss: null,
  },
};

/** The six places a real run visits. The sandbox is not one of them. */
/* ================= time of day ================= */

/** Blend two packed hex colours. */
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t);
}

/**
 * The morning grade.
 *
 * Rather than hand-authoring a second sky for all six places — which would be
 * six more palettes to keep in step with the first six — each biome's night
 * colours are blended *towards* a common early-morning light. The blend keeps
 * every biome's own hue: the Hollow comes up cold and blue-green, Cinder Reach
 * comes up through smoke, the Void's sky is still torn open. They just come up.
 *
 * The moon becomes the sun, low and to the side the way it is an hour after
 * first light, the stars go out, and the fog thins to about a third — which is
 * most of what actually makes the place readable, more than the light does.
 */
const DAWN = {
  top: 0x9dc2e8, horizon: 0xf7d7ae, bottom: 0xb9c6d2,
  fog: 0xcfdae3, hemiSky: 0xbcd8f0, hemiGround: 0x8a7f68,
  sun: 0xfff6e2, sunLight: 0xfff0d6,
};

export function morningSky(K) {
  return {
    ...K,
    top: mixHex(K.top, DAWN.top, 0.92),
    horizon: mixHex(K.horizon, DAWN.horizon, 0.86),
    bottom: mixHex(K.bottom, DAWN.bottom, 0.84),
    fog: mixHex(K.fog, DAWN.fog, 0.88),
    // Distance haze is what a dark forest hides behind. Thinning it is worth
    // more to a lost player than any amount of extra lamp.
    fogDensity: K.fogDensity * 0.38,
    // Most places lose their stars at dawn. The Long Dark does not have a sun
    // to lose them to — its sky is torn open — so it keeps a thinned field.
    stars: K.nebula ? Math.round(K.stars * 0.55) : 0,
    nebula: (K.nebula || 0) * 0.35,
    moon: mixHex(K.moon, DAWN.sun, 0.85),
    moonLight: mixHex(K.moonLight, DAWN.sunLight, 0.88),
    moonIntensity: 3.1,
    moonSize: Math.max(38, K.moonSize * 0.34),
    hemiSky: mixHex(K.hemiSky, DAWN.hemiSky, 0.92),
    hemiGround: mixHex(K.hemiGround, DAWN.hemiGround, 0.82),
    hemiIntensity: 1.85,
    exposure: 1.06,
    // Daylight carries its own fill; the night grade's floor-of-light hack is
    // not needed and would only flatten it.
    fillMul: 3.6,
    // Low and off to one side: a sun overhead flattens everything and throws
    // no shadows worth having.
    sunDir: [0.66, 0.30, -0.69],
    daylight: true,
  };
}

/** The sky a biome should be built with, given the time of day. */
export function skyFor(biome, timeOfDay = 'morning') {
  return timeOfDay === 'night' ? biome.sky : morningSky(biome.sky);
}

export const BIOME_IDS = Object.keys(BIOMES).filter((id) => !BIOMES[id].sandbox);
export const FIRST_BIOME = 'hollow';

export function getBiome(id) { return BIOMES[id] || BIOMES[FIRST_BIOME]; }

/**
 * The order a run visits its biomes: the Hollow first, then everything else
 * shuffled from the run seed. Two saves with the same seed take the same road.
 */
export function biomeOrder(seed) {
  const rest = BIOME_IDS.filter((id) => id !== FIRST_BIOME);
  const r = makeRNG((seed ^ 0x51F0A7ED) >>> 0);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [FIRST_BIOME, ...rest];
}

/** Difficulty ramps with depth, not with which place you happened to draw. */
export function depthScaling(depth) {
  return {
    health: 1 + depth * 0.30,
    damage: 1 + depth * 0.18,
    density: 1 + depth * 0.12,
    loot: 1 + depth * 0.10,
  };
}
