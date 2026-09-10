// Every surface texture in San Aurelio is generated at runtime on a 2D canvas.
// No image downloads, no licence questions, and facades can be re-rolled per building.

import * as THREE from 'three';
import { makeRng, clamp } from '../core/util.js';

const cache = new Map();
const anisotropyRef = { value: 4 };
export function setTextureAnisotropy(v) { anisotropyRef.value = v; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTex(c, repeatX = 1, repeatY = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = anisotropyRef.value;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Value noise splat — cheap grain used by almost every material. */
function grain(ctx, w, h, amount, tint = [0, 0, 0]) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = clamp(d[i] + n + tint[0], 0, 255);
    d[i + 1] = clamp(d[i + 1] + n + tint[1], 0, 255);
    d[i + 2] = clamp(d[i + 2] + n + tint[2], 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

function blobs(ctx, w, h, n, rng, color, rMin, rMax, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h, r = rng.range(rMin, rMax);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.5, 1.4), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- ground

export function asphalt() {
  if (cache.has('asphalt')) return cache.get('asphalt');
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
  const rng = makeRng(9001);
  ctx.fillStyle = '#2b2d30'; ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, 130, rng, '#37393d', 12, 46, 0.5);
  blobs(ctx, S, S, 90, rng, '#232528', 8, 34, 0.55);
  // aggregate
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(210,210,215,0.10)' : 'rgba(10,10,12,0.16)';
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 1.6, 1 + rng() * 1.6);
  }
  // tar-sealed cracks
  ctx.strokeStyle = 'rgba(18,18,20,0.75)';
  for (let i = 0; i < 14; i++) {
    ctx.lineWidth = rng.range(1, 3.4);
    ctx.beginPath();
    let x = rng() * S, y = rng() * S;
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) { x += rng.range(-52, 52); y += rng.range(-52, 52); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  grain(ctx, S, S, 20);
  const out = { map: toTex(c, 1, 1), rough: null };
  // roughness map: darker = smoother. Worn wheel tracks are polished.
  const rc = canvas(S, S), rx = rc.getContext('2d');
  rx.fillStyle = '#c8c8c8'; rx.fillRect(0, 0, S, S);
  blobs(rx, S, S, 60, makeRng(4242), '#8a8a8a', 20, 70, 0.5);
  grain(rx, S, S, 26);
  out.rough = toTex(rc, 1, 1, false);
  cache.set('asphalt', out);
  return out;
}

export function concrete(shade = 0.78) {
  const key = 'concrete' + shade;
  if (cache.has(key)) return cache.get(key);
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
  const rng = makeRng(4711);
  const base = Math.round(150 * shade + 40);
  ctx.fillStyle = `rgb(${base},${base + 2},${base + 4})`;
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, 120, rng, 'rgba(120,122,126,0.35)', 10, 48, 0.5);
  blobs(ctx, S, S, 60, rng, 'rgba(200,202,205,0.30)', 14, 60, 0.5);
  // slab joints — one 4x4 grid of pavement slabs per tile
  ctx.strokeStyle = 'rgba(70,72,76,0.85)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    const p = (i * S) / 4;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  // stains near joints
  blobs(ctx, S, S, 40, rng, 'rgba(90,88,84,0.25)', 6, 22, 0.6);
  grain(ctx, S, S, 16);
  const t = toTex(c, 1, 1);
  cache.set(key, t);
  return t;
}

export function sand() {
  if (cache.has('sand')) return cache.get('sand');
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  const rng = makeRng(777);
  ctx.fillStyle = '#d8c8a4'; ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, 90, rng, '#e6d8b8', 6, 30, 0.5);
  blobs(ctx, S, S, 70, rng, '#c4b391', 6, 26, 0.5);
  grain(ctx, S, S, 26);
  const t = toTex(c, 1, 1);
  cache.set('sand', t);
  return t;
}

export function grass() {
  if (cache.has('grass')) return cache.get('grass');
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  const rng = makeRng(313);
  ctx.fillStyle = '#4c6b39'; ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, 120, rng, '#5c7d44', 5, 24, 0.55);
  blobs(ctx, S, S, 80, rng, '#3d5730', 5, 20, 0.55);
  for (let i = 0; i < 2600; i++) {
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(120,150,80,0.35)' : 'rgba(50,72,40,0.4)';
    ctx.lineWidth = 1;
    const x = rng() * S, y = rng() * S;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-2, 2), y - rng.range(2, 5)); ctx.stroke();
  }
  grain(ctx, S, S, 14);
  const t = toTex(c, 1, 1);
  cache.set('grass', t);
  return t;
}

export function dirt() {
  if (cache.has('dirt')) return cache.get('dirt');
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  const rng = makeRng(1717);
  ctx.fillStyle = '#8a7355'; ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, 100, rng, '#9c8362', 6, 30, 0.5);
  blobs(ctx, S, S, 70, rng, '#6f5c44', 6, 24, 0.5);
  grain(ctx, S, S, 24);
  const t = toTex(c, 1, 1);
  cache.set('dirt', t);
  return t;
}

// ---------------------------------------------------------------- buildings

/**
 * Facade tile. One tile = `floors` storeys tall and `bays` windows wide;
 * the caller sets texture.repeat so windows keep a real-world size.
 * Returns { map, emissive, rough } — emissive lights a random subset of windows at night.
 */
export function facade(style, seed, floors = 4, bays = 5) {
  const key = `f:${style}:${seed}:${floors}:${bays}`;
  if (cache.has(key)) return cache.get(key);
  const rng = makeRng(seed);
  const W = 512, H = 512;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const ec = canvas(W, H), ex = ec.getContext('2d');
  const rc = canvas(W, H), rx = rc.getContext('2d');

  const palettes = {
    tower: ['#5a6570', '#49525c', '#6d7883', '#3f4750'],
    office: ['#7d8288', '#6a7076', '#8d9299'],
    stucco: ['#cfc0a8', '#d9cbb2', '#c2ae92', '#e0d6c2', '#bda98d'],
    brick: ['#8c4f3f', '#7a4335', '#9a5c46'],
    warehouse: ['#8f9599', '#7c8286', '#9aa0a4'],
    shop: ['#d8d2c6', '#c9c2b4', '#e2ddd2'],
  };
  const wall = rng.pick(palettes[style] || palettes.stucco);
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  rx.fillStyle = style === 'tower' ? '#3a3a3a' : '#b4b4b4'; rx.fillRect(0, 0, W, H);

  if (style === 'brick') {
    const bh = 11, bw = 26;
    for (let y = 0; y < H; y += bh) {
      const off = ((y / bh) % 2) * (bw / 2);
      for (let x = -bw; x < W; x += bw) {
        ctx.fillStyle = `rgba(${140 + rng() * 40 | 0},${70 + rng() * 30 | 0},${55 + rng() * 25 | 0},0.55)`;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  } else if (style === 'warehouse') {
    // corrugated ribs
    for (let x = 0; x < W; x += 16) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x, 0, 7, H);
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(x + 8, 0, 6, H);
    }
  } else {
    blobs(ctx, W, H, 40, rng, 'rgba(0,0,0,0.06)', 20, 70, 0.5);
  }

  const fh = H / floors, bw2 = W / bays;
  const glass = style === 'tower' ? '#243642' : '#2c3b45';
  const frame = style === 'tower' ? 'rgba(30,34,38,0.9)' : 'rgba(58,54,50,0.9)';
  const litColour = ['#ffd9a0', '#ffe7c2', '#cfe0ff', '#ffcf82'];

  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    // storey ledge
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(0, y + fh - 4, W, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(0, y + fh - 8, W, 3);

    for (let b = 0; b < bays; b++) {
      const x = b * bw2;
      const pad = style === 'tower' ? 6 : 14;
      const wx = x + pad, wy = y + fh * 0.20, ww = bw2 - pad * 2, wh = fh * 0.55;
      ctx.fillStyle = frame;
      ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      ctx.fillStyle = glass;
      ctx.fillRect(wx, wy, ww, wh);
      // reflection streak
      const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, 'rgba(190,215,235,0.30)');
      g.addColorStop(0.45, 'rgba(190,215,235,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0.14)');
      ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
      if (style !== 'tower') { // mullion
        ctx.fillStyle = frame;
        ctx.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      }
      // glass is smooth
      rx.fillStyle = '#1c1c1c'; rx.fillRect(wx, wy, ww, wh);

      if (rng.chance(0.42)) {
        ex.fillStyle = rng.pick(litColour);
        ex.globalAlpha = rng.range(0.45, 1);
        ex.fillRect(wx, wy, ww, wh);
        ex.globalAlpha = 1;
        if (rng.chance(0.35)) { // blinds / a shape in the window
          ex.fillStyle = 'rgba(0,0,0,0.55)';
          ex.fillRect(wx, wy, ww, wh * rng.range(0.2, 0.5));
        }
      }
    }
  }
  grain(ctx, W, H, 12);

  const rx2 = W / bays, ry2 = H / floors;
  const out = {
    map: toTex(c, 1, 1),
    emissive: toTex(ec, 1, 1),
    rough: toTex(rc, 1, 1, false),
    tileW: rx2, tileH: ry2, floors, bays,
  };
  cache.set(key, out);
  return out;
}

export function roofTex() {
  if (cache.has('roof')) return cache.get('roof');
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  const rng = makeRng(88);
  ctx.fillStyle = '#4a4c4e'; ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, 140, rng, '#565a5d', 4, 18, 0.6);
  blobs(ctx, S, S, 90, rng, '#3c3e40', 4, 16, 0.6);
  // seam lines of roofing felt
  ctx.strokeStyle = 'rgba(30,30,32,0.6)'; ctx.lineWidth = 2;
  for (let y = 0; y < S; y += 42) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
  grain(ctx, S, S, 20);
  const t = toTex(c, 1, 1);
  cache.set('roof', t);
  return t;
}

/** Shop / business sign board. Drawn text is real detail for very little cost. */
export function signboard(text, bg = '#12202b', fg = '#ffb347', sub = '') {
  const key = `sign:${text}:${bg}:${fg}:${sub}`;
  if (cache.has(key)) return cache.get(key);
  const W = 512, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 58;
  ctx.font = `600 ${size}px Helvetica, Arial, sans-serif`;
  while (ctx.measureText(text).width > W - 60 && size > 14) {
    size -= 3;
    ctx.font = `600 ${size}px Helvetica, Arial, sans-serif`;
  }
  ctx.fillText(text.toUpperCase(), W / 2, sub ? H / 2 - 14 : H / 2);
  if (sub) {
    ctx.font = '300 22px Helvetica, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(sub, W / 2, H / 2 + 30);
  }
  const t = toTex(c, 1, 1);
  cache.set(key, t);
  return t;
}

/** Emissive twin of a signboard so shopfronts glow after dark. */
export function signGlow(text, fg = '#ffb347', sub = '') {
  const key = `signglow:${text}:${fg}:${sub}`;
  if (cache.has(key)) return cache.get(key);
  const W = 512, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 58;
  ctx.font = `600 ${size}px Helvetica, Arial, sans-serif`;
  while (ctx.measureText(text).width > W - 60 && size > 14) {
    size -= 3;
    ctx.font = `600 ${size}px Helvetica, Arial, sans-serif`;
  }
  ctx.shadowColor = fg; ctx.shadowBlur = 26;
  ctx.fillText(text.toUpperCase(), W / 2, sub ? H / 2 - 14 : H / 2);
  if (sub) {
    ctx.shadowBlur = 12;
    ctx.font = '300 22px Helvetica, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(sub, W / 2, H / 2 + 30);
  }
  const t = toTex(c, 1, 1);
  cache.set(key, t);
  return t;
}

/** Soft radial sprite reused for headlight pools, rain splashes and map blips. */
export function radialSprite(colour = '#ffffff', hardness = 0.25) {
  const key = 'rad' + colour + hardness;
  if (cache.has(key)) return cache.get(key);
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, S * hardness * 0.5, S / 2, S / 2, S / 2);
  g.addColorStop(0, colour);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export function foliageTex() {
  if (cache.has('foliage')) return cache.get('foliage');
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  const rng = makeRng(2024);
  ctx.fillStyle = '#3f6b34'; ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, 70, rng, '#4f7f3e', 5, 18, 0.7);
  blobs(ctx, S, S, 50, rng, '#2f5427', 5, 16, 0.7);
  grain(ctx, S, S, 18);
  const t = toTex(c, 1, 1);
  cache.set('foliage', t);
  return t;
}

export function clearCache() { cache.clear(); }
