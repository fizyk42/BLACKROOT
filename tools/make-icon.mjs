/**
 * BLACKROOT icon generator.
 *
 * The mark: a bare tree whose root system mirrors its branches, standing in a
 * cone of lamp light. It carries the title (blackroot), the core mechanic (the
 * flashlight is the only thing out here that reliably works) and the story beat
 * from the caves — "the roots are wrong first".
 *
 * The tree is grown recursively from a fixed seed rather than hand-drawn, so
 * the branching stays organic and the whole mark can be retuned by changing
 * numbers instead of redrawing bezier paths.
 *
 *   node tools/make-icon.mjs        -> assets/icon/*.svg
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'assets/icon');

/* ---------------- palette (matches the in-game UI) ---------------- */
const C = {
  bgTop: '#0e141b',
  bgBot: '#040506',
  lamp: '#fff4dc',
  lampMid: '#e6c68d',
  gold: '#c0a15a',
  goldDim: '#7a6636',
  moon: '#9fb6d8',
  rim: '#26303b',
  ink: '#04050a',
};

/* ---------------- seeded RNG ---------------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grow a branching structure. Returns segments [{x1,y1,x2,y2,w}] ordered
 * thickest-first so thin twigs draw on top.
 */
function grow(opts) {
  const {
    x, y, angle, length, width, depth, seed,
    lengthRatio, widthRatio, spread, splitChance, curve,
  } = opts;
  const rand = rng(seed);
  const segs = [];

  (function branch(px, py, ang, len, w, d) {
    if (d <= 0 || len < 2) return;
    // a slight curve per segment keeps it from looking like a diagram
    const bend = (rand() - 0.5) * curve;
    const a = ang + bend;
    const nx = px + Math.cos(a) * len;
    const ny = py + Math.sin(a) * len;
    segs.push({ x1: px, y1: py, x2: nx, y2: ny, w, d });

    const kids = rand() < splitChance ? 3 : 2;
    for (let i = 0; i < kids; i++) {
      const t = kids === 1 ? 0 : (i / (kids - 1)) * 2 - 1;      // -1..1
      const off = t * spread * (0.7 + rand() * 0.6);
      branch(
        nx, ny,
        a + off,
        len * (lengthRatio * (0.82 + rand() * 0.36)),
        Math.max(0.9, w * widthRatio),
        d - 1
      );
    }
  })(x, y, angle, length, width, depth);

  return segs.sort((p, q) => q.w - p.w);
}

const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

/**
 * Below ~64 px the grown tree collapses into a bar, so the small mark is
 * authored by hand: one trunk, four branches, five roots, all thick enough to
 * survive a 16 px downsample. Same silhouette language, far fewer elements.
 */
function boldTree(ground) {
  const T = (x1, y1, x2, y2, w) => ({ x1, y1, x2, y2, w });
  const canopy = [
    T(256, ground, 256, 168, 46),          // trunk
    T(252, 262, 168, 176, 30),             // lower left branch
    T(260, 276, 344, 190, 30),             // lower right branch
    T(254, 200, 198, 138, 20),             // upper left branch
    T(258, 192, 318, 132, 20),             // upper right branch
  ];
  const roots = [
    T(256, ground, 164, ground + 74, 34),  // left main root
    T(256, ground, 350, ground + 68, 34),  // right main root
    T(256, ground, 258, ground + 92, 26),  // tap root
    T(196, ground + 38, 140, ground + 96, 18),
    T(316, ground + 34, 372, ground + 92, 18),
  ];
  return { canopy: canopy.sort((a, b) => b.w - a.w), roots: roots.sort((a, b) => b.w - a.w) };
}

function segPaths(segs, stroke, widthAdd = 0, opacity = 1) {
  return segs.map((s) =>
    `<path d="M${s.x1.toFixed(1)} ${s.y1.toFixed(1)}L${s.x2.toFixed(1)} ${s.y2.toFixed(1)}" ` +
    `stroke="${stroke}" stroke-width="${(s.w + widthAdd).toFixed(2)}" stroke-linecap="round" ` +
    `fill="none"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`
  ).join('');
}

/* ---------------- the mark ---------------- */

function buildSVG({ size = 512, detail = 'full' } = {}) {
  const S = 512;                    // authoring grid; scaled by the viewBox
  const small = detail === 'small';
  const GROUND = small ? 372 : 312;  // where branches become roots

  const bold = small ? boldTree(GROUND) : null;

  // canopy
  const canopy = bold ? bold.canopy : grow({
    x: 256, y: GROUND, angle: UP,
    length: small ? 104 : 82,
    width: small ? 52 : 34,
    depth: small ? 3 : 6,
    seed: 0xB1A5E7,
    lengthRatio: small ? 0.66 : 0.72, widthRatio: small ? 0.54 : 0.62,
    spread: small ? 0.60 : 0.46, splitChance: small ? 0 : 0.22,
    curve: small ? 0.05 : 0.26,
  });

  // roots — wider, flatter, thinner, and reaching further sideways
  const roots = bold ? bold.roots : grow({
    x: 256, y: GROUND, angle: DOWN,
    length: small ? 66 : 54,
    width: small ? 46 : 28,
    depth: small ? 3 : 5,
    seed: 0x5EED11,
    lengthRatio: small ? 0.62 : 0.68, widthRatio: small ? 0.54 : 0.60,
    spread: small ? 0.85 : 0.74, splitChance: small ? 0 : 0.34,
    curve: small ? 0.07 : 0.34,
  });

  // stars, only where the sky is dark
  let stars = '';
  if (!small) {
    const r = rng(0xC0FFEE);
    for (let i = 0; i < 34; i++) {
      const sx = 40 + r() * 432;
      const sy = 40 + r() * 210;
      const d = Math.hypot(sx - 256, (sy - 120) * 0.6);
      const op = (0.16 + r() * 0.5) * Math.min(1, d / 130);
      stars += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(0.9 + r() * 1.5).toFixed(2)}" fill="#cfe0f2" opacity="${op.toFixed(2)}"/>`;
    }
  }

  // the lamp cone: narrow at the lens, opening down past the tree
  const coneTop = small ? 52 : 68, coneBot = small ? 486 : 468;
  const topHalf = small ? 30 : 20;
  const botHalf = small ? 168 : 158;
  const cone =
    `M${256 - topHalf} ${coneTop}` +
    `C${256 - topHalf - 8} ${coneTop + 120} ${256 - botHalf + 26} ${coneBot - 150} ${256 - botHalf} ${coneBot}` +
    `L${256 + botHalf} ${coneBot}` +
    `C${256 + botHalf - 26} ${coneBot - 150} ${256 + topHalf + 8} ${coneTop + 120} ${256 + topHalf} ${coneTop}Z`;

  const blur = small ? 5 : 9;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${size}" height="${size}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.bgTop}"/>
    <stop offset="0.62" stop-color="#080b0e"/>
    <stop offset="1" stop-color="${C.bgBot}"/>
  </linearGradient>
  <radialGradient id="vig" cx="0.5" cy="0.40" r="0.72">
    <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.72"/>
  </radialGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.lamp}" stop-opacity="${small ? 0.80 : 0.66}"/>
    <stop offset="0.30" stop-color="${C.lampMid}" stop-opacity="${small ? 0.46 : 0.30}"/>
    <stop offset="0.74" stop-color="${C.gold}" stop-opacity="0.10"/>
    <stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${C.lampMid}" stop-opacity="0.55"/>
    <stop offset="1" stop-color="${C.lampMid}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="lens" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fffaf0" stop-opacity="1"/>
    <stop offset="0.35" stop-color="${C.lamp}" stop-opacity="0.85"/>
    <stop offset="1" stop-color="${C.lamp}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="horizon" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.gold}" stop-opacity="0"/>
    <stop offset="0.5" stop-color="${C.gold}" stop-opacity="0.85"/>
    <stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>
  </linearGradient>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="${blur}"/>
  </filter>
  <filter id="softer" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="${blur * 2.4}"/>
  </filter>
  <clipPath id="squircle">
    <rect x="0" y="0" width="${S}" height="${S}" rx="114" ry="114"/>
  </clipPath>
</defs>

<g clip-path="url(#squircle)">
  <rect width="${S}" height="${S}" fill="url(#sky)"/>
  ${stars}

  <!-- lamp beam -->
  <path d="${cone}" fill="url(#beam)" filter="url(#softer)" opacity="0.55"/>
  <path d="${cone}" fill="url(#beam)" filter="url(#soft)"/>

  <!-- pool of light on the ground -->
  <ellipse cx="256" cy="${GROUND + 14}" rx="${small ? 158 : 158}" ry="${small ? 40 : 40}" fill="url(#pool)" filter="url(#soft)"/>

  <!-- the lens itself -->
  <circle cx="256" cy="${coneTop + 2}" r="${small ? 34 : 26}" fill="url(#lens)" filter="url(#soft)"/>
  <circle cx="256" cy="${coneTop + 2}" r="${small ? 13 : 7.5}" fill="#fffdf6"/>

  <!-- ground line: the boundary between branch and root -->
  <rect x="${small ? 74 : 46}" y="${GROUND - (small ? 3 : 1.5)}" width="${small ? 364 : 420}" height="${small ? 6 : 3}" fill="url(#horizon)"/>

  <!-- roots, then canopy: rim pass keeps them readable outside the beam -->
  <g>
    ${segPaths(roots, C.rim, small ? 7 : 3.4, 0.95)}
    ${segPaths(canopy, C.rim, small ? 7 : 3.4, 0.95)}
    ${segPaths(roots, C.ink)}
    ${segPaths(canopy, C.ink)}
  </g>

  <!-- moonlit edge on the trunk, so the silhouette has a light source -->
  <path d="M${small ? 240 : 247} ${GROUND} L${small ? 240 : 247} ${GROUND - (small ? 118 : 104)}" stroke="${C.moon}" stroke-width="${small ? 5 : 2.6}" stroke-linecap="round" opacity="${small ? 0.34 : 0.30}"/>

  <rect width="${S}" height="${S}" fill="url(#vig)"/>
  <rect x="1.5" y="1.5" width="${S - 3}" height="${S - 3}" rx="112.5" ry="112.5"
        fill="none" stroke="${C.goldDim}" stroke-width="3" opacity="0.55"/>
</g>
</svg>`;
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'icon.svg'), buildSVG({ detail: 'full' }));
await writeFile(path.join(OUT, 'icon-small.svg'), buildSVG({ detail: 'small' }));
console.log('wrote assets/icon/icon.svg and icon-small.svg');
