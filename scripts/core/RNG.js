/**
 * Seeded deterministic random number generation + value noise.
 * Everything world-related (terrain, foliage, loot, spawns) is derived from a
 * single run seed so a given seed always produces the same Hollow.
 */

/** mulberry32 — small, fast, good enough distribution for gameplay. */
export function makeRNG(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (lo, hi) => lo + fn() * (hi - lo);
  fn.int = (lo, hi) => Math.floor(lo + fn() * (hi - lo + 1));
  fn.pick = (arr) => arr[Math.floor(fn() * arr.length)];
  fn.chance = (p) => fn() < p;
  fn.sign = () => (fn() < 0.5 ? -1 : 1);
  /** Weighted pick: entries [[value, weight], ...] */
  fn.weighted = (entries) => {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = fn() * total;
    for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  };
  /** Random point on a disc of given radius. */
  fn.disc = (radius) => {
    const t = fn() * Math.PI * 2, r = Math.sqrt(fn()) * radius;
    return { x: Math.cos(t) * r, z: Math.sin(t) * r };
  };
  return fn;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Value noise — used for terrain height, moisture, foliage masks.      */
/* ------------------------------------------------------------------ */

function hash2(x, y, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** 2D value noise in [-1,1]. */
export function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}

/** Fractal Brownian motion over value noise. */
export function fbm(x, y, seed, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise — sharper crests, good for rocky spines. */
export function ridge(x, y, seed, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq, seed + i * 7717));
    sum += n * n * amp; norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
