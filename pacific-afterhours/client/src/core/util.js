// Shared maths, deterministic RNG and broadphase helpers.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Shortest signed angular difference, result in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Frame-rate independent exponential approach. `rate` is roughly "per second". */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function dampAngle(current, target, rate, dt) {
  return current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));
}

/** Mulberry32 — small, fast, seedable. The whole city is generated from one seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (lo, hi) => lo + fn() * (hi - lo);
  fn.int = (lo, hi) => Math.floor(lo + fn() * (hi - lo + 1));
  fn.pick = (arr) => arr[Math.floor(fn() * arr.length)];
  fn.chance = (p) => fn() < p;
  return fn;
}

export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Uniform grid broadphase for static world colliders (axis-aligned boxes).
 * Everything the player and vehicles collide with lives in here.
 */
export class SpatialGrid {
  constructor(cell = 24) {
    this.cell = cell;
    this.map = new Map();
    this.items = [];
  }
  _key(cx, cz) {
    return cx * 73856093 ^ (cz * 19349663);
  }
  /** box = {minX,maxX,minZ,maxZ,top,tag,ref} — `top` is walkable height (for kerbs/ramps). */
  add(box) {
    const id = this.items.length;
    this.items.push(box);
    const c = this.cell;
    const x0 = Math.floor(box.minX / c), x1 = Math.floor(box.maxX / c);
    const z0 = Math.floor(box.minZ / c), z1 = Math.floor(box.maxZ / c);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this._key(x, z);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(id);
      }
    }
    return id;
  }
  /** Collects candidate boxes overlapping a query AABB into `out`. */
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const arr = this.map.get(this._key(x, z));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const id = arr[i];
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(this.items[id]);
        }
      }
    }
    return out;
  }
  get size() { return this.items.length; }
}

/**
 * Push a circle (radius r at x,z) out of any solid box it overlaps.
 * Returns {x,z,hit,nx,nz,depth} — normal points away from the box.
 */
export function resolveCircleVsBoxes(x, z, r, boxes, maxY, feetY) {
  let hit = false, nx = 0, nz = 0, depth = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.top !== undefined && feetY !== undefined && b.top <= feetY + 0.35) continue; // step over kerbs
    if (b.baseY !== undefined && maxY !== undefined && b.baseY > maxY) continue;
    const cx = clamp(x, b.minX, b.maxX);
    const cz = clamp(z, b.minZ, b.maxZ);
    let dx = x - cx, dz = z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-5) {
      // Centre is inside the box — escape along the shallowest axis.
      const toL = x - b.minX, toR = b.maxX - x, toB = z - b.minZ, toT = b.maxZ - z;
      const m = Math.min(toL, toR, toB, toT);
      dx = m === toL ? -1 : m === toR ? 1 : 0;
      dz = m === toB ? -1 : m === toT ? 1 : 0;
      d = 0.0001;
      x += dx * (m + r);
      z += dz * (m + r);
    } else {
      const push = r - d;
      x += (dx / d) * push;
      z += (dz / d) * push;
      if (push > depth) { depth = push; nx = dx / d; nz = dz / d; }
    }
    hit = true;
  }
  return { x, z, hit, nx, nz, depth };
}

/** Segment/AABB overlap test used for traffic look-ahead and bullet hits. */
export function segmentHitsBox(x0, z0, x1, z1, b, pad = 0) {
  const minX = b.minX - pad, maxX = b.maxX + pad, minZ = b.minZ - pad, maxZ = b.maxZ + pad;
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, q0, q1, o] of [[dx, minX, maxX, x0], [dz, minZ, maxZ, z0]]) {
    if (Math.abs(p) < 1e-8) { if (o < q0 || o > q1) return -1; continue; }
    let ta = (q0 - o) / p, tb = (q1 - o) / p;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}

export function fmtMoney(n) {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toLocaleString('en-US');
  return (neg ? '-$' : '$') + s;
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtClock(hours) {
  const h24 = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  const ap = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
