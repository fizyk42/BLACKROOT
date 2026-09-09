/**
 * CamoGenerator — every weapon finish in the game, drawn from a number.
 *
 * A camo is fully described by a 32-bit seed. The seed picks a pattern family,
 * a palette, and every parameter that family takes, so the same seed always
 * produces the same finish on every machine and nothing has to be stored or
 * downloaded. There are 18 families and 2^32 seeds, which is why the browser
 * can offer billions of finishes inside a 750 KB build: the art is a function,
 * not a folder.
 *
 * Rarity is derived from the seed too, so a "rare" camo is genuinely rare
 * rather than a flag somebody set.
 */
import * as THREE from 'three';
import { makeRNG, fbm, noise2 } from '../core/RNG.js';

/* ------------------------------------------------------------------ */
/* palettes                                                            */
/* ------------------------------------------------------------------ */

export const PALETTES = [
  { name: 'Woodland',  cols: ['#3d4531', '#5b6344', '#2b2f24', '#7c7a5a', '#1d201a'] },
  { name: 'Desert',    cols: ['#b09a6d', '#8a7247', '#d6c69b', '#5f5236', '#2f2a1e'] },
  { name: 'Arctic',    cols: ['#dfe6ec', '#a9b7c4', '#7d8b98', '#f2f6fa', '#4a5560'] },
  { name: 'Urban',     cols: ['#4a4d52', '#6d7178', '#2a2c30', '#8f949b', '#17181b'] },
  { name: 'Tigerstripe', cols: ['#6b6340', '#2c2a1c', '#8f8558', '#3e3a26', '#141309'] },
  { name: 'Nebula',    cols: ['#2a1b4d', '#5b2f8a', '#8f4fd1', '#1a0f2e', '#d3a6ff'] },
  { name: 'Abyssal',   cols: ['#0d2d38', '#14505f', '#1f7f8c', '#061a20', '#7fd4d9'] },
  { name: 'Cinder',    cols: ['#3a1310', '#7a2318', '#c1471f', '#1a0b09', '#ff8c3a'] },
  { name: 'Toxic',     cols: ['#2c3a12', '#5f8318', '#9ecf2b', '#161e0a', '#d9ff5c'] },
  { name: 'Blood',     cols: ['#3d0e10', '#6e161a', '#a52228', '#1a0708', '#d95a5e'] },
  { name: 'Gilded',    cols: ['#6b5218', '#a8842c', '#d9b455', '#3a2c0d', '#ffe9a8'] },
  { name: 'Chrome',    cols: ['#6f7681', '#9aa3ae', '#c8d0d9', '#454a52', '#eef3f7'] },
  { name: 'Void',      cols: ['#121216', '#1e1e26', '#2c2c38', '#08080a', '#4a4a5e'] },
  { name: 'Rust',      cols: ['#4a2a16', '#7a4522', '#a8642f', '#2a1810', '#c98b4e'] },
  { name: 'Glacier',   cols: ['#7fb3c9', '#4d8299', '#a8d4e6', '#2c5468', '#dff2fa'] },
  { name: 'Bloom',     cols: ['#3a1f4a', '#6b3a7a', '#a05fb0', '#1e0f28', '#e0a8f0'] },
  { name: 'Ranger',    cols: ['#4a4a3a', '#6b6a52', '#2c2c22', '#8a8a70', '#16160f'] },
  { name: 'Ember',     cols: ['#1a1a1c', '#3a2018', '#8f3a12', '#0d0d0e', '#ffb45c'] },
];

export const FAMILIES = [
  'blotch', 'digital', 'tiger', 'splinter', 'fractal', 'hex', 'fluid',
  'dazzle', 'scale', 'circuit', 'topo', 'spray', 'damascus', 'gradient',
  'shatter', 'weave', 'drip', 'starfield',
];

const FAMILY_LABEL = {
  blotch: 'Blotch', digital: 'Digital', tiger: 'Tigerstripe', splinter: 'Splinter',
  fractal: 'Fractal', hex: 'Hexcell', fluid: 'Fluid', dazzle: 'Dazzle',
  scale: 'Scale', circuit: 'Circuit', topo: 'Contour', spray: 'Stencil',
  damascus: 'Damascus', gradient: 'Fade', shatter: 'Shatter', weave: 'Weave',
  drip: 'Corrosion', starfield: 'Starfield',
};

/** Total distinct finishes this generator can produce. */
export const CAMO_SPACE = 4294967296;   // 2^32 seeds

/* ------------------------------------------------------------------ */
/* naming                                                              */
/* ------------------------------------------------------------------ */

const ADJ = ['Ashen', 'Hollow', 'Silent', 'Drowned', 'Burnt', 'Pale', 'Iron', 'Wretched',
  'Frozen', 'Rotting', 'Gilded', 'Feral', 'Broken', 'Starless', 'Bitter', 'Second',
  'Long', 'Low', 'Quiet', 'Black', 'Hungry', 'Split', 'Grave', 'Salt'];
const NOUN = ['Drift', 'Hymn', 'Vigil', 'Choir', 'Tide', 'Bloom', 'Cinder', 'Vein',
  'Wake', 'Husk', 'Lantern', 'Thaw', 'Harrow', 'Grain', 'Fathom', 'Ledger',
  'Cradle', 'Lure', 'Spine', 'Bell', 'Root', 'Frost', 'Static', 'Verse'];

export function camoName(seed) {
  const r = makeRNG((seed ^ 0x9E3779B9) >>> 0);
  const a = ADJ[Math.floor(r() * ADJ.length)];
  const n = NOUN[Math.floor(r() * NOUN.length)];
  const num = 1 + Math.floor(r() * 99);
  return `${a} ${n} ${String(num).padStart(2, '0')}`;
}

export const RARITIES = [
  { id: 'standard', label: 'Standard', color: '#8e8c84', weight: 0.58 },
  { id: 'refined', label: 'Refined', color: '#6f9a72', weight: 0.24 },
  { id: 'rare', label: 'Rare', color: '#5b8fc9', weight: 0.12 },
  { id: 'exotic', label: 'Exotic', color: '#ad6bf0', weight: 0.05 },
  { id: 'mythic', label: 'Mythic', color: '#d9a441', weight: 0.01 },
];

export function camoRarity(seed) {
  const r = makeRNG((seed ^ 0x51ED270B) >>> 0);
  let v = r(), acc = 0;
  for (const tier of RARITIES) { acc += tier.weight; if (v <= acc) return tier; }
  return RARITIES[0];
}

/** Everything about a camo, without drawing it. */
export function camoInfo(seed) {
  seed = seed >>> 0;
  const r = makeRNG((seed ^ 0x2545F491) >>> 0);
  const family = FAMILIES[Math.floor(r() * FAMILIES.length)];
  const palette = PALETTES[Math.floor(r() * PALETTES.length)];
  const rarity = camoRarity(seed);
  return {
    seed, family, familyLabel: FAMILY_LABEL[family], palette, rarity,
    name: camoName(seed),
    metal: rarity.id === 'mythic' ? 0.85 : rarity.id === 'exotic' ? 0.55 : 0.18,
    rough: rarity.id === 'mythic' ? 0.24 : rarity.id === 'exotic' ? 0.38 : 0.62,
  };
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

const cache = new Map();
const MAX_CACHE = 60;

export function makeCamoTexture(seed, size = 512) {
  const key = seed + ':' + size;
  if (cache.has(key)) return cache.get(key);

  const info = camoInfo(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rand = makeRNG((seed ^ 0xB5297A4D) >>> 0);
  const P = info.palette.cols;

  ctx.fillStyle = P[0];
  ctx.fillRect(0, 0, size, size);
  DRAW[info.family](ctx, size, P, rand, seed);
  addWear(ctx, size, rand, info);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData.camo = info;

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.get(oldest)?.dispose?.();
    cache.delete(oldest);
  }
  cache.set(key, tex);
  return tex;
}

/** Small preview swatch for the camo grid, as a data URL. */
export function camoSwatch(seed, size = 64) {
  const info = camoInfo(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rand = makeRNG((seed ^ 0xB5297A4D) >>> 0);
  ctx.fillStyle = info.palette.cols[0];
  ctx.fillRect(0, 0, size, size);
  DRAW[info.family](ctx, size, info.palette.cols, rand, seed);
  return c.toDataURL('image/png');
}

/* ---- shared helpers ---- */

function blob(ctx, x, y, r, rand, wobble = 0.45) {
  const pts = 9 + Math.floor(rand() * 5);
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + rand() * wobble);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.8;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** Every pattern wraps, so the texture tiles on a weapon without a seam. */
function wrapped(ctx, size, fn) {
  for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
    ctx.save(); ctx.translate(ox, oy); fn(); ctx.restore();
  }
}

const DRAW = {
  blotch(ctx, size, P, rand) {
    for (let layer = 1; layer < 4; layer++) {
      ctx.fillStyle = P[layer];
      const n = 8 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) {
        const x = rand() * size, y = rand() * size;
        const r = size * (0.07 + rand() * 0.16) / layer * 1.4;
        wrapped(ctx, size, () => blob(ctx, x, y, r, rand));
      }
    }
  },

  digital(ctx, size, P, rand) {
    const cell = Math.max(4, Math.floor(size / (12 + Math.floor(rand() * 22))));
    const cells = Math.ceil(size / cell);
    const grid = [];
    for (let y = 0; y < cells; y++) {
      grid[y] = [];
      for (let x = 0; x < cells; x++) grid[y][x] = Math.floor(rand() * P.length);
    }
    // cluster: each cell tends toward its neighbours, which is what makes
    // digital camo read as blocks rather than static
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
        if (rand() < 0.55) grid[y][x] = grid[(y + 1) % cells][x];
        else if (rand() < 0.5) grid[y][x] = grid[y][(x + 1) % cells];
      }
    }
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      ctx.fillStyle = P[grid[y][x]];
      ctx.fillRect(x * cell, y * cell, cell + 1, cell + 1);
    }
  },

  tiger(ctx, size, P, rand) {
    const bands = 5 + Math.floor(rand() * 7);
    for (let b = 0; b < bands; b++) {
      ctx.fillStyle = P[1 + (b % (P.length - 1))];
      const y0 = (b / bands) * size + rand() * 10;
      const h = size / bands * (0.25 + rand() * 0.5);
      ctx.beginPath();
      ctx.moveTo(-10, y0);
      for (let x = -10; x <= size + 10; x += 12) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.035 + b) * 9 + Math.sin(x * 0.11 + b * 2) * 4);
      }
      for (let x = size + 10; x >= -10; x -= 12) {
        ctx.lineTo(x, y0 + h + Math.sin(x * 0.04 + b * 1.7) * 11);
      }
      ctx.closePath();
      ctx.fill();
    }
  },

  splinter(ctx, size, P, rand) {
    const n = 14 + Math.floor(rand() * 18);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = P[1 + Math.floor(rand() * (P.length - 1))];
      const cx = rand() * size, cy = rand() * size;
      const verts = 3 + Math.floor(rand() * 3);
      const rad = size * (0.08 + rand() * 0.28);
      const rot = rand() * Math.PI * 2;
      ctx.beginPath();
      for (let v = 0; v <= verts; v++) {
        const a = rot + (v / verts) * Math.PI * 2;
        const rr = rad * (0.5 + rand() * 0.9);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  },

  fractal(ctx, size, P, rand, seed) {
    const img = ctx.createImageData(size, size);
    const sc = 0.006 + rand() * 0.02;
    const bands = 3 + Math.floor(rand() * 3);
    const cols = P.map(hexToRgb);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * sc, y * sc, seed, 5) * 0.5 + 0.5;
        const band = Math.min(bands - 1, Math.floor(n * bands));
        const col = cols[band % cols.length];
        const i = (y * size + x) * 4;
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  hex(ctx, size, P, rand) {
    const r = size / (7 + Math.floor(rand() * 10));
    const h = r * Math.sqrt(3);
    for (let row = -1; row * h * 0.5 < size + h; row++) {
      for (let col = -1; col * r * 1.5 < size + r; col++) {
        const x = col * r * 1.5;
        const y = row * h + (col % 2 ? h / 2 : 0);
        ctx.fillStyle = P[Math.floor(rand() * P.length)];
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const px = x + Math.cos(a) * r * 0.94, py = y + Math.sin(a) * r * 0.94;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
    }
  },

  fluid(ctx, size, P, rand, seed) {
    const img = ctx.createImageData(size, size);
    const sc = 0.004 + rand() * 0.01;
    const warp = 40 + rand() * 120;
    const cols = P.map(hexToRgb);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // domain warping is what turns noise into marble
        const wx = x + noise2(x * sc * 2, y * sc * 2, seed + 7) * warp;
        const wy = y + noise2(x * sc * 2 + 5.3, y * sc * 2 + 1.7, seed + 13) * warp;
        const n = fbm(wx * sc, wy * sc, seed, 4) * 0.5 + 0.5;
        const t = n * (cols.length - 1);
        const a = cols[Math.floor(t) % cols.length];
        const b = cols[(Math.floor(t) + 1) % cols.length];
        const f = t - Math.floor(t);
        const i = (y * size + x) * 4;
        img.data[i] = a[0] + (b[0] - a[0]) * f;
        img.data[i + 1] = a[1] + (b[1] - a[1]) * f;
        img.data[i + 2] = a[2] + (b[2] - a[2]) * f;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  dazzle(ctx, size, P, rand) {
    const n = 10 + Math.floor(rand() * 14);
    const ang = rand() * Math.PI;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(ang);
    ctx.translate(-size, -size);
    for (let i = 0; i < n * 2; i++) {
      ctx.fillStyle = P[i % P.length];
      const w = (size * 2) / n * (0.4 + rand() * 1.2);
      ctx.fillRect(i * ((size * 2) / n), 0, w, size * 3);
    }
    ctx.restore();
  },

  scale(ctx, size, P, rand) {
    const r = size / (8 + Math.floor(rand() * 10));
    for (let row = -1; row * r * 0.6 < size + r; row++) {
      for (let col = -1; col * r < size + r; col++) {
        const x = col * r + (row % 2 ? r / 2 : 0);
        const y = row * r * 0.6;
        ctx.fillStyle = P[Math.floor(rand() * P.length)];
        ctx.beginPath();
        ctx.arc(x, y, r * 0.62, Math.PI, 0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  },

  circuit(ctx, size, P, rand) {
    ctx.fillStyle = P[1]; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = P[4]; ctx.lineWidth = Math.max(1, size / 220);
    const traces = 26 + Math.floor(rand() * 30);
    for (let i = 0; i < traces; i++) {
      let x = Math.floor(rand() * size), y = Math.floor(rand() * size);
      ctx.beginPath(); ctx.moveTo(x, y);
      const segs = 3 + Math.floor(rand() * 6);
      for (let s = 0; s < segs; s++) {
        if (rand() < 0.5) x += (rand() - 0.5) * size * 0.3;
        else y += (rand() - 0.5) * size * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = P[3];
      ctx.fillRect(x - size / 120, y - size / 120, size / 60, size / 60);
    }
  },

  topo(ctx, size, P, rand, seed) {
    ctx.fillStyle = P[0]; ctx.fillRect(0, 0, size, size);
    const sc = 0.008 + rand() * 0.012;
    const levels = 7 + Math.floor(rand() * 8);
    const step = Math.max(1, Math.floor(size / 220));
    for (let l = 0; l < levels; l++) {
      const thr = l / levels;
      ctx.fillStyle = P[1 + (l % (P.length - 1))];
      ctx.globalAlpha = 0.55;
      for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
          const n = fbm(x * sc, y * sc, seed, 4) * 0.5 + 0.5;
          if (n > thr && n < thr + 0.035) ctx.fillRect(x, y, step + 1, step + 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  },

  spray(ctx, size, P, rand) {
    ctx.fillStyle = P[1];
    for (let i = 0; i < 10; i++) {
      const x = rand() * size, y = rand() * size;
      wrapped(ctx, size, () => blob(ctx, x, y, size * (0.1 + rand() * 0.2), rand, 0.8));
    }
    for (let i = 0; i < size * 26; i++) {
      ctx.fillStyle = P[2 + Math.floor(rand() * (P.length - 2))];
      ctx.globalAlpha = 0.1 + rand() * 0.5;
      const r = rand() * (size / 200) + 0.4;
      ctx.beginPath(); ctx.arc(rand() * size, rand() * size, r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  damascus(ctx, size, P, rand, seed) {
    const img = ctx.createImageData(size, size);
    const sc = 0.010 + rand() * 0.01;
    const freq = 6 + rand() * 14;
    const cols = P.map(hexToRgb);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * sc, y * sc * 0.35, seed, 4);
        const band = Math.sin((y * 0.05 + n * freq)) * 0.5 + 0.5;
        const t = Math.pow(band, 1.6) * (cols.length - 1);
        const a = cols[Math.floor(t) % cols.length];
        const b = cols[(Math.floor(t) + 1) % cols.length];
        const f = t - Math.floor(t);
        const i = (y * size + x) * 4;
        img.data[i] = a[0] + (b[0] - a[0]) * f;
        img.data[i + 1] = a[1] + (b[1] - a[1]) * f;
        img.data[i + 2] = a[2] + (b[2] - a[2]) * f;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  gradient(ctx, size, P, rand) {
    const ang = rand() * Math.PI * 2;
    const g = ctx.createLinearGradient(
      size / 2 - Math.cos(ang) * size / 2, size / 2 - Math.sin(ang) * size / 2,
      size / 2 + Math.cos(ang) * size / 2, size / 2 + Math.sin(ang) * size / 2);
    const stops = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < stops; i++) g.addColorStop(i / (stops - 1), P[Math.floor(rand() * P.length)]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < size * 12; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
      ctx.fillRect(rand() * size, rand() * size, 1.4, 1.4);
    }
  },

  shatter(ctx, size, P, rand) {
    // Voronoi-ish: scatter sites, fill each pixel block with its nearest.
    const n = 12 + Math.floor(rand() * 22);
    const sites = [];
    for (let i = 0; i < n; i++) sites.push({ x: rand() * size, y: rand() * size, c: P[Math.floor(rand() * P.length)] });
    const step = Math.max(2, Math.floor(size / 160));
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        let best = null, bd = Infinity;
        for (const s of sites) {
          const d = (s.x - x) ** 2 + (s.y - y) ** 2;
          if (d < bd) { bd = d; best = s; }
        }
        ctx.fillStyle = best.c;
        ctx.fillRect(x, y, step + 1, step + 1);
      }
    }
  },

  weave(ctx, size, P, rand) {
    const w = Math.max(3, Math.floor(size / (14 + rand() * 24)));
    for (let y = 0; y < size; y += w * 2) {
      for (let x = 0; x < size; x += w * 2) {
        ctx.fillStyle = P[1]; ctx.fillRect(x, y, w * 2, w);
        ctx.fillStyle = P[2]; ctx.fillRect(x, y + w, w * 2, w);
        ctx.fillStyle = P[3]; ctx.fillRect(x, y, w, w * 2);
        ctx.fillStyle = P[Math.min(4, P.length - 1)]; ctx.fillRect(x + w, y + w, w, w);
      }
    }
  },

  drip(ctx, size, P, rand) {
    ctx.fillStyle = P[1]; ctx.fillRect(0, 0, size, size);
    const n = 16 + Math.floor(rand() * 26);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = P[2 + Math.floor(rand() * (P.length - 2))];
      const x = rand() * size;
      let y = rand() * size * 0.5;
      let w = size * (0.01 + rand() * 0.035);
      const len = size * (0.1 + rand() * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        ctx.lineTo(x + Math.sin(t * 7 + i) * w * 1.6 + w * (1 - t), y + len * t);
      }
      for (let s = steps; s >= 0; s--) {
        const t = s / steps;
        ctx.lineTo(x + Math.sin(t * 7 + i) * w * 1.6 - w * (1 - t), y + len * t);
      }
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y + len, w * 1.1, 0, 6.283); ctx.fill();
    }
  },

  starfield(ctx, size, P, rand, seed) {
    const g = ctx.createRadialGradient(size * 0.4, size * 0.35, 0, size * 0.5, size * 0.5, size * 0.75);
    g.addColorStop(0, P[2]); g.addColorStop(0.5, P[1]); g.addColorStop(1, P[0]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    // nebula wisps
    for (let i = 0; i < 26; i++) {
      ctx.globalAlpha = 0.05 + rand() * 0.14;
      ctx.fillStyle = P[Math.min(4, P.length - 1)];
      blob(ctx, rand() * size, rand() * size, size * (0.08 + rand() * 0.26), rand, 0.9);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < size * 2.2; i++) {
      const b = rand();
      ctx.fillStyle = `rgba(255,255,255,${(0.25 + b * 0.75).toFixed(2)})`;
      const r = b * (size / 340) + 0.3;
      ctx.beginPath(); ctx.arc(rand() * size, rand() * size, r, 0, 6.283); ctx.fill();
    }
  },
};

/** Edge wear and grime — the thing that stops a finish looking like wallpaper. */
function addWear(ctx, size, rand, info) {
  const amount = info.rarity.id === 'mythic' ? 0.25 : 1;
  ctx.globalAlpha = 0.10 * amount;
  ctx.fillStyle = '#000';
  for (let i = 0; i < 120 * amount; i++) {
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, rand() * size * 0.05, rand() * size * 0.02, rand() * 6.28, 0, 6.28);
    ctx.fill();
  }
  ctx.globalAlpha = 0.09 * amount;
  ctx.fillStyle = '#cfc6b2';
  for (let i = 0; i < 60 * amount; i++) {
    ctx.fillRect(rand() * size, rand() * size, rand() * size * 0.03 + 1, 1.2);
  }
  ctx.globalAlpha = 1;
}

function hexToRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Deterministic list of camo seeds for the browse grid. */
export function camoPage(page, perPage = 48, salt = 0) {
  const out = [];
  const r = makeRNG(((page * 7919) ^ (salt * 104729) ^ 0xA5A5) >>> 0);
  for (let i = 0; i < perPage; i++) out.push((r() * 4294967296) >>> 0);
  return out;
}

export function disposeCamoCache() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}
