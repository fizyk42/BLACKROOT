/**
 * Textures — every texture in the game is drawn procedurally into a canvas at
 * boot. No image files ship with the prototype, which keeps it self-contained
 * and makes substitution trivial: replace any factory here with a loader.
 */
import * as THREE from 'three';

const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(c, repeat = 1, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tileable value-noise field drawn with wrapping offsets. */
function noiseField(ctx, size, cells, alpha, hue) {
  const step = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = Math.random();
      ctx.fillStyle = `hsla(${hue[0] + (Math.random() - .5) * hue[1]},${hue[2]}%,${hue[3] + v * hue[4]}%,${alpha})`;
      ctx.fillRect(x * step, y * step, step + 1, step + 1);
    }
  }
}

function blur(c, radius) {
  const ctx = c.getContext('2d');
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(c, 0, 0);
  ctx.filter = 'none';
}

/* ------------------------------------------------------------------ */

export function groundTexture(quality) {
  const key = 'ground' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 256 : quality === 'medium' ? 512 : 1024;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2620'; ctx.fillRect(0, 0, size, size);
  noiseField(ctx, size, size / 8, 0.5, [30, 24, 22, 12, 12]);
  blur(c, size / 220);
  // leaf litter flecks
  for (let i = 0; i < size * 3; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 1 + Math.random() * (size / 200);
    const h = 26 + Math.random() * 30, l = 10 + Math.random() * 16;
    ctx.fillStyle = `hsla(${h},${28 + Math.random() * 22}%,${l}%,${0.35 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1 + Math.random()), r * 0.6, Math.random() * 6.28, 0, 6.28);
    ctx.fill();
  }
  // small stones
  for (let i = 0; i < size / 4; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 1 + Math.random() * (size / 260);
    ctx.fillStyle = `hsla(40,6%,${16 + Math.random() * 14}%,.7)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
  }
  const t = finish(c, 1);
  cache.set(key, t);
  return t;
}

/** Derive a cheap normal map from a greyscale height render of the same noise. */
/**
 * Surfaces read as *material* — bark, rusted steel, split plank — largely
 * because of how light breaks across their relief, not because of their
 * colour. Every one of these textures is drawn as a canvas, so the height
 * information is already there in its luminance; this turns that into a normal
 * map with a Sobel filter, and a matching roughness map so that the raised
 * parts catch light differently from the recesses.
 *
 * It costs one extra texture per surface and no extra authoring, and it is the
 * difference between a flat brown cylinder and something that looks like a
 * tree when a torch sweeps across it.
 */
const canvasFor = new Map();

function sobelNormal(src, size, strength) {
  const sc = src.getContext('2d');
  const px = sc.getImageData(0, 0, size, size).data;
  const lum = (x, y) => {
    const i = (((y % size) + size) % size * size + (((x % size) + size) % size)) * 4;
    return (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
  };
  const n = canvas(size), nc = n.getContext('2d');
  const out = nc.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // A full Sobel rather than a two-tap difference: the diagonals are what
      // stop a derived normal map looking like corduroy.
      const dx = (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1))
               - (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const dy = (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1))
               - (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      out.data[i] = (nx / l * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  nc.putImageData(out, 0, 0);
  return finish(n, 1, false);
}

/** A normal map derived from an already-generated colour texture. */
export function normalFor(key, strength = 2.4) {
  const nk = 'n:' + key + strength;
  if (cache.has(nk)) return cache.get(nk);
  const src = canvasFor.get(key);
  if (!src) return null;
  const t = sobelNormal(src, src.width, strength);
  cache.set(nk, t);
  return t;
}

/**
 * Roughness from the same luminance: recesses hold dirt and scatter light,
 * raised edges are worn smooth. Inverted and compressed into a narrow band,
 * because a roughness map with full range reads as an oil slick.
 */
export function roughnessFor(key, lo = 0.55, hi = 0.98) {
  const rk = `r:${key}${lo}${hi}`;
  if (cache.has(rk)) return cache.get(rk);
  const src = canvasFor.get(key);
  if (!src) return null;
  const size = src.width;
  const px = src.getContext('2d').getImageData(0, 0, size, size).data;
  const r = canvas(size), rc = r.getContext('2d');
  const out = rc.createImageData(size, size);
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    const v = Math.round((hi - (hi - lo) * l) * 255);
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  rc.putImageData(out, 0, 0);
  const t = finish(r, 1, false);
  cache.set(rk, t);
  return t;
}

export function groundNormal(quality) {
  const key = 'gnorm' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 128 : 256;
  const h = canvas(size), hc = h.getContext('2d');
  hc.fillStyle = '#808080'; hc.fillRect(0, 0, size, size);
  noiseField(hc, size, size / 6, 0.6, [0, 0, 0, 40, 30]);
  blur(h, 1.5);
  const src = hc.getImageData(0, 0, size, size).data;
  const n = canvas(size), nc = n.getContext('2d');
  const out = nc.createImageData(size, size);
  const at = (x, y) => src[((y & (size - 1)) * size + (x & (size - 1))) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const s = 2.2;
      let nx = -dx * s, ny = -dy * s, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      out.data[i] = (nx * .5 + .5) * 255;
      out.data[i + 1] = (ny * .5 + .5) * 255;
      out.data[i + 2] = (nz * .5 + .5) * 255;
      out.data[i + 3] = 255;
    }
  }
  nc.putImageData(out, 0, 0);
  const t = finish(n, 1, false);
  cache.set(key, t);
  return t;
}

export function barkTexture(quality) {
  const key = 'bark' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 128 : 256;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#38312a'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 1.5; i++) {
    const x = Math.random() * size;
    const w = 1 + Math.random() * 3;
    ctx.strokeStyle = `hsla(${24 + Math.random() * 14},${10 + Math.random() * 16}%,${8 + Math.random() * 16}%,${0.3 + Math.random() * 0.5})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    let y = 0, cx = x;
    ctx.moveTo(cx, y);
    while (y < size) { y += 8 + Math.random() * 14; cx += (Math.random() - 0.5) * 5; ctx.lineTo(cx, y); }
    ctx.stroke();
  }
  // moss on one side
  for (let i = 0; i < size / 2; i++) {
    const x = Math.random() * size * 0.4, y = Math.random() * size;
    ctx.fillStyle = `hsla(${88 + Math.random() * 26},${18 + Math.random() * 22}%,${12 + Math.random() * 10}%,${0.15 + Math.random() * 0.3})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + Math.random() * 7, 0, 6.28); ctx.fill();
  }
  canvasFor.set(key, c);
  const t = finish(c, 1);
  cache.set(key, t);
  return t;
}

/** Alpha-tested foliage card: a clump of leaves on transparent background. */
export function leafCardTexture(hue = 105, quality = 'high') {
  const key = 'leaf' + hue + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 128 : 256;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const leaves = quality === 'low' ? 40 : 90;
  for (let i = 0; i < leaves; i++) {
    const x = size * (0.12 + Math.random() * 0.76);
    const y = size * (0.10 + Math.random() * 0.84);
    const rx = size * (0.035 + Math.random() * 0.07);
    const ry = rx * (0.32 + Math.random() * 0.45);
    const rot = Math.random() * Math.PI * 2;
    const l = 8 + Math.random() * 16;
    ctx.fillStyle = `hsl(${hue + (Math.random() - .5) * 26},${26 + Math.random() * 26}%,${l}%)`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, 6.28);
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue},30%,${l + 8}%,.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(rot) * rx, y - Math.sin(rot) * rx);
    ctx.lineTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
    ctx.stroke();
  }
  const t = finish(c, 1);
  cache.set(key, t);
  return t;
}

export function grassCardTexture(quality = 'high') {
  const key = 'grass' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 64 : 128;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const h = size * (0.45 + Math.random() * 0.5);
    const lean = (Math.random() - 0.5) * size * 0.3;
    ctx.strokeStyle = `hsl(${76 + Math.random() * 34},${20 + Math.random() * 20}%,${9 + Math.random() * 12}%)`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + lean * 0.4, size - h * 0.6, x + lean, size - h);
    ctx.stroke();
  }
  const t = finish(c, 1);
  cache.set(key, t);
  return t;
}

export function rockTexture(quality) {
  const key = 'rock' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 128 : 256;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3a38'; ctx.fillRect(0, 0, size, size);
  noiseField(ctx, size, size / 5, 0.55, [40, 12, 5, 16, 16]);
  blur(c, 1.2);
  for (let i = 0; i < size / 3; i++) {
    ctx.strokeStyle = `hsla(60,4%,${10 + Math.random() * 22}%,.4)`;
    ctx.lineWidth = 0.6 + Math.random();
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (Math.random() - .5) * 40; y += (Math.random() - .5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  canvasFor.set(key, c);
  const t = finish(c, 1);
  cache.set(key, t);
  return t;
}

export function metalTexture(quality) {
  const key = 'metal' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 128 : 256;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4a48'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 2; i++) {
    ctx.fillStyle = `hsla(${18 + Math.random() * 22},${40 + Math.random() * 30}%,${14 + Math.random() * 18}%,${Math.random() * .5})`;
    const x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath(); ctx.arc(x, y, 1 + Math.random() * 9, 0, 6.28); ctx.fill();
  }
  blur(c, 0.8);
  canvasFor.set(key, c);
  const t = finish(c, 1);
  cache.set(key, t);
  return t;
}

export function plankTexture(quality) {
  const key = 'plank' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = quality === 'low' ? 128 : 256;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#312a22'; ctx.fillRect(0, 0, size, size);
  const rows = 6, rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const l = 10 + Math.random() * 10;
    ctx.fillStyle = `hsl(${26 + Math.random() * 10},${14 + Math.random() * 10}%,${l}%)`;
    ctx.fillRect(0, r * rh, size, rh - 1);
    for (let i = 0; i < 22; i++) {
      ctx.strokeStyle = `hsla(28,16%,${l + (Math.random() - .5) * 10}%,.5)`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      const y = r * rh + Math.random() * rh;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * .3, y + (Math.random() - .5) * 5, size * .6, y + (Math.random() - .5) * 5, size, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, r * rh + rh - 2, size, 2);
  }
  canvasFor.set(key, c);
  const t = finish(c, 1);
  cache.set(key, t);
  return t;
}

/** Soft radial sprite used for muzzle flashes, fireflies, blood mist, fog motes. */
export function sprite(color = '#ffffff', softness = 0.55) {
  const key = 'sp' + color + softness;
  if (cache.has(key)) return cache.get(key);
  const size = 64;
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(softness, color.replace(')', ',0.35)').replace('rgb', 'rgba'));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export function softDot() {
  if (cache.has('softdot')) return cache.get('softdot');
  const size = 64, c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set('softdot', t);
  return t;
}

/**
 * A tiny equirectangular night sky, used as the scene environment.
 * Physically-based metals are black without something to reflect; this gives
 * gun steel, water and wet rock a believable sky term at almost no cost.
 */
export function nightEnvironment(renderer) {
  if (cache.has('envmap')) return cache.get('envmap');
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.00, '#10161f');   // zenith
  g.addColorStop(0.42, '#1b232c');
  g.addColorStop(0.52, '#232b31');   // horizon glow
  g.addColorStop(0.62, '#0d1210');
  g.addColorStop(1.00, '#050706');   // ground bounce
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // moon lobe, roughly where the directional light comes from
  const mg = ctx.createRadialGradient(w * 0.30, h * 0.24, 0, w * 0.30, h * 0.24, w * 0.20);
  mg.addColorStop(0, 'rgba(150,170,205,0.85)');
  mg.addColorStop(1, 'rgba(150,170,205,0)');
  ctx.fillStyle = mg;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  cache.set('envmap', rt.texture);
  return rt.texture;
}

export function disposeAll() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}
