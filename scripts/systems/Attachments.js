/**
 * Attachments — optics, muzzles, barrels, magazines, stocks, grips and lasers.
 *
 * Every attachment does three things: it changes the weapon's numbers, it puts
 * geometry on a named mount point of the model, and (for optics) it changes
 * what aiming down the sight actually looks like.
 *
 * Optics are the interesting case. A red dot or holo is transparent glass with
 * a floating reticle — you look *through* it. A magnified scope renders the
 * world a second time through a narrower camera into a texture, and that
 * texture is mapped onto the lens, so the view inside the tube is a real
 * magnified image of the world rather than a zoom of the whole screen.
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* materials                                                           */
/* ------------------------------------------------------------------ */

const M = {};
const mat = (k, o) => (M[k] = M[k] || new THREE.MeshStandardMaterial(o));
const gunmetal = () => mat('am_gun', { color: 0x3c4046, roughness: 0.46, metalness: 0.72, envMapIntensity: 1.5 });
const poly = () => mat('am_poly', { color: 0x26282c, roughness: 0.74, metalness: 0.10, envMapIntensity: 1.1 });
const steel = () => mat('am_steel', { color: 0xa8aeb6, roughness: 0.30, metalness: 0.90, envMapIntensity: 1.8 });
const rubber = () => mat('am_rub', { color: 0x1d1e21, roughness: 0.94, metalness: 0 });

/** Optic glass: genuinely transparent, with a faint coating tint. */
function glassMaterial(tint = 0x4e6f86, opacity = 0.16) {
  const m = new THREE.MeshPhysicalMaterial({
    color: tint, transparent: true, opacity,
    roughness: 0.06, metalness: 0, transmission: 0.0,
    depthWrite: false, side: THREE.DoubleSide,
    envMapIntensity: 2.4,
  });
  return m;
}

function box(w, h, d, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  return m;
}
function tube(rt, rb, h, seg, material, x = 0, y = 0, z = 0, rx = Math.PI / 2, open = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), material);
  m.position.set(x, y, z); m.rotation.x = rx;
  return m;
}

/* ------------------------------------------------------------------ */
/* optics                                                              */
/* ------------------------------------------------------------------ */

/**
 * Reticle textures are drawn to canvas so they stay crisp and cost nothing.
 * `hollow` leaves the middle clear, which is the whole point of a red dot.
 */
function reticleTexture(kind, color = '#ff3b30') {
  // Drawn at 512 so the lines stay hairline when the scope view fills the
  // screen; a chunky reticle is the fastest way to make an optic feel cheap.
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = size / 90;
  ctx.shadowColor = color; ctx.shadowBlur = size / 60;
  const mid = size / 2;

  if (kind === 'dot') {
    ctx.beginPath(); ctx.arc(mid, mid, size / 26, 0, 6.283); ctx.fill();
  } else if (kind === 'holo') {
    ctx.beginPath(); ctx.arc(mid, mid, size / 3.1, 0, 6.283); ctx.stroke();
    ctx.beginPath(); ctx.arc(mid, mid, size / 30, 0, 6.283); ctx.fill();
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      ctx.beginPath();
      ctx.moveTo(mid + Math.cos(a) * size / 3.1, mid + Math.sin(a) * size / 3.1);
      ctx.lineTo(mid + Math.cos(a) * size / 2.5, mid + Math.sin(a) * size / 2.5);
      ctx.stroke();
    }
  } else if (kind === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(mid, mid - size / 12);
    ctx.lineTo(mid + size / 12, mid + size / 14);
    ctx.lineTo(mid, mid + size / 40);
    ctx.lineTo(mid - size / 12, mid + size / 14);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'crosshair') {
    ctx.lineWidth = size / 340;
    ctx.beginPath();
    ctx.moveTo(mid, 0); ctx.lineTo(mid, mid - size / 22);
    ctx.moveTo(mid, mid + size / 22); ctx.lineTo(mid, size);
    ctx.moveTo(0, mid); ctx.lineTo(mid - size / 22, mid);
    ctx.moveTo(mid + size / 22, mid); ctx.lineTo(size, mid);
    ctx.stroke();
    // mil dots down the lower post
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath(); ctx.arc(mid, mid + i * size / 12, size / 300, 0, 6.283); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(mid, mid, size / 420, 0, 6.283); ctx.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Build an optic.
 * Returns { group, glass, reticle, lensMesh, eyeOffset } where lensMesh is the
 * surface the scope render target is mapped onto for magnified optics.
 */
function buildOptic(def) {
  const g = new THREE.Group();
  const parts = {};
  const gm = gunmetal(), pm = poly(), sm = steel(), rm = rubber();

  if (def.id === 'reflex') {
    // open-frame reflex: two posts and a canted lens, nothing blocking the view
    g.add(box(0.052, 0.012, 0.056, pm, 0, 0.006, 0));
    g.add(box(0.007, 0.040, 0.010, pm, -0.024, 0.030, -0.020));
    g.add(box(0.007, 0.040, 0.010, pm, 0.024, 0.030, -0.020));
    g.add(box(0.056, 0.008, 0.010, pm, 0, 0.052, -0.020));
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.038), glassMaterial(0x3f6b8a, 0.13));
    lens.position.set(0, 0.031, -0.018);
    lens.rotation.x = 0.20;
    g.add(lens);
    parts.glass = lens;
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.040, 0.040),
      new THREE.MeshBasicMaterial({ map: reticleTexture('dot', def.reticleColor), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }));
    ret.position.set(0, 0.031, -0.0175);
    ret.rotation.x = 0.20;
    ret.renderOrder = 40;
    g.add(ret);
    parts.reticle = ret;
    parts.eye = new THREE.Vector3(0, 0.031, -0.018);

  } else if (def.id === 'holo') {
    g.add(box(0.060, 0.014, 0.084, pm, 0, 0.007, 0.006));
    g.add(box(0.060, 0.046, 0.014, pm, 0, 0.036, 0.040));        // rear housing
    g.add(box(0.010, 0.042, 0.012, pm, -0.025, 0.034, -0.026));
    g.add(box(0.010, 0.042, 0.012, pm, 0.025, 0.034, -0.026));
    g.add(box(0.060, 0.009, 0.012, pm, 0, 0.056, -0.026));
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.040), glassMaterial(0x2f5f4a, 0.12));
    lens.position.set(0, 0.034, -0.024);
    g.add(lens);
    parts.glass = lens;
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.052, 0.052),
      new THREE.MeshBasicMaterial({ map: reticleTexture('holo', def.reticleColor), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }));
    ret.position.set(0, 0.034, -0.0235);
    ret.renderOrder = 40;
    g.add(ret);
    parts.reticle = ret;
    parts.eye = new THREE.Vector3(0, 0.034, -0.024);

  } else {
    // magnified tube optics: acog / sniper / thermal
    const len = def.tubeLength || 0.20;
    const rad = def.tubeRadius || 0.021;
    g.add(tube(rad, rad, len, 16, pm, 0, 0.030, -0.01));
    g.add(tube(rad * 1.35, rad * 1.35, 0.030, 16, pm, 0, 0.030, -0.01 - len / 2 + 0.012));  // objective bell
    g.add(tube(rad * 1.18, rad * 1.18, 0.026, 16, rm, 0, 0.030, -0.01 + len / 2 - 0.010));  // eyepiece
    g.add(box(0.016, 0.030, 0.030, pm, 0, 0.012, -0.01 - len * 0.22));
    g.add(box(0.016, 0.030, 0.030, pm, 0, 0.012, -0.01 + len * 0.22));
    g.add(tube(0.008, 0.008, 0.016, 10, gm, 0.020, 0.038, -0.01, Math.PI / 2));             // windage turret
    g.add(tube(0.008, 0.008, 0.016, 10, gm, 0, 0.050, -0.01, 0));                            // elevation turret

    // The lens the world gets rendered onto. Slightly inset so the tube walls
    // form a natural vignette around the image.
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(rad * 0.94, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: THREE.DoubleSide })
    );
    lens.position.set(0, 0.030, -0.01 + len / 2 - 0.013);
    lens.renderOrder = 30;             // +Z already faces the shooter
    g.add(lens);
    parts.lens = lens;

    const ret = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.94, 32),
      new THREE.MeshBasicMaterial({ map: reticleTexture(def.reticle || 'crosshair', def.reticleColor),
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
    ret.position.set(0, 0.030, -0.01 + len / 2 - 0.0128);
    ret.renderOrder = 41;
    g.add(ret);
    parts.reticle = ret;
    parts.eye = new THREE.Vector3(0, 0.030, -0.01 + len / 2 - 0.013);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  return { group: g, parts };
}

/* ------------------------------------------------------------------ */
/* the catalogue                                                       */
/* ------------------------------------------------------------------ */

/**
 * mods are multiplicative unless the key ends in `Add`.
 * `zoom` on an optic drives the magnified render path; 1 means non-magnified.
 */
export const ATTACHMENTS = {
  optic: {
    iron:   { id: 'iron', slot: 'optic', name: 'Iron Sights', desc: 'No glass, nothing to break, nothing between you and the target.', mods: {}, zoom: 1, magnified: false },
    reflex: { id: 'reflex', slot: 'optic', name: 'Reflex Sight', desc: 'Open-frame red dot. Both eyes stay open and the whole frame stays visible.', mods: { adsTime: 0.94, adsSpread: 0.82 }, zoom: 1.12, magnified: false, reticleColor: '#ff3b30' },
    holo:   { id: 'holo', slot: 'optic', name: 'Holographic Sight', desc: 'Ring-and-dot holo. Slower to bring up than a dot, far faster to pick up in the dark.', mods: { adsTime: 1.04, adsSpread: 0.74 }, zoom: 1.2, magnified: false, reticleColor: '#39ff88' },
    acog:   { id: 'acog', slot: 'optic', name: '3× Combat Scope', desc: 'Magnified prism. The view through the tube is the real world, rendered again.', mods: { adsTime: 1.22, adsSpread: 0.5, sway: 1.15 }, zoom: 3, magnified: true, tubeLength: 0.17, tubeRadius: 0.020, reticle: 'chevron', reticleColor: '#ffb02e' },
    sniper: { id: 'sniper', slot: 'optic', name: '6× Precision Scope', desc: 'Long glass with mil-dots. Everything outside the tube goes dark when you settle in.', mods: { adsTime: 1.5, adsSpread: 0.28, sway: 1.45, range: 1.2 }, zoom: 6, magnified: true, tubeLength: 0.24, tubeRadius: 0.023, reticle: 'crosshair', reticleColor: '#e8e2d2', vignette: 0.82 },
    thermal:{ id: 'thermal', slot: 'optic', name: '4× Thermal Optic', desc: 'Heat rendering. Living things burn white through undergrowth; the dead go cold.', mods: { adsTime: 1.42, adsSpread: 0.42, sway: 1.3 }, zoom: 4, magnified: true, thermal: true, tubeLength: 0.20, tubeRadius: 0.022, reticle: 'crosshair', reticleColor: '#ffffff' },
  },
  muzzle: {
    none:       { id: 'none', slot: 'muzzle', name: 'No Muzzle Device', desc: '', mods: {} },
    suppressor: { id: 'suppressor', slot: 'muzzle', name: 'Suppressor', desc: 'Cuts the report to something the forest can swallow. Costs you a little velocity.', mods: { damage: 0.94, range: 0.88, recoil: 0.9 }, noise: 0.35, flash: 0.25 },
    compensator:{ id: 'compensator', slot: 'muzzle', name: 'Compensator', desc: 'Vents gas upward. Flatter recoil, louder signature.', mods: { recoil: 0.72, spread: 1.06 }, noise: 1.15, flash: 1.3 },
    brake:      { id: 'brake', slot: 'muzzle', name: 'Muzzle Brake', desc: 'Tames the first shot hard. Everything within fifty metres hears it.', mods: { recoil: 0.58, adsTime: 1.06 }, noise: 1.3, flash: 1.5 },
  },
  barrel: {
    standard: { id: 'standard', slot: 'barrel', name: 'Standard Barrel', desc: '', mods: {} },
    long:     { id: 'long', slot: 'barrel', name: 'Long Barrel', desc: 'More velocity and reach, slower to swing around.', mods: { range: 1.35, damage: 1.08, adsTime: 1.14, sway: 1.15 } },
    short:    { id: 'short', slot: 'barrel', name: 'Short Barrel', desc: 'Handles like a knife indoors. Gives up reach for it.', mods: { range: 0.7, adsTime: 0.84, spread: 1.18, sway: 0.85 } },
    heavy:    { id: 'heavy', slot: 'barrel', name: 'Heavy Barrel', desc: 'Thick profile soaks up recoil and holds a group.', mods: { recoil: 0.78, spread: 0.86, adsTime: 1.18 } },
  },
  mag: {
    standard: { id: 'standard', slot: 'mag', name: 'Standard Magazine', desc: '', mods: {} },
    extended: { id: 'extended', slot: 'mag', name: 'Extended Magazine', desc: 'Half again as many rounds, slower to swap.', mods: { magAdd: 0.5, reload: 1.15 } },
    drum:     { id: 'drum', slot: 'mag', name: 'Drum Magazine', desc: 'Double capacity. Heavy, awkward, and worth it when the nest wakes up.', mods: { magAdd: 1.0, reload: 1.45, adsTime: 1.12 } },
    quick:    { id: 'quick', slot: 'mag', name: 'Quickdraw Mags', desc: 'Taped and tabbed for speed.', mods: { reload: 0.7, magAdd: -0.15 } },
  },
  stock: {
    standard: { id: 'standard', slot: 'stock', name: 'Standard Stock', desc: '', mods: {} },
    heavy:    { id: 'heavy', slot: 'stock', name: 'Heavy Stock', desc: 'Plants the weapon. Steadier hold, slower to move with.', mods: { sway: 0.6, recoil: 0.85, adsTime: 1.1 } },
    light:    { id: 'light', slot: 'stock', name: 'Skeleton Stock', desc: 'Strips weight for speed at the cost of steadiness.', mods: { adsTime: 0.86, sway: 1.3 } },
    none:     { id: 'none', slot: 'stock', name: 'No Stock', desc: 'Fastest handling in the game. Do not expect to hit anything past twenty metres.', mods: { adsTime: 0.72, sway: 1.7, recoil: 1.35 } },
  },
  grip: {
    none:     { id: 'none', slot: 'grip', name: 'No Grip', desc: '', mods: {} },
    vertical: { id: 'vertical', slot: 'grip', name: 'Vertical Grip', desc: 'Pulls vertical recoil down.', mods: { recoil: 0.8 } },
    angled:   { id: 'angled', slot: 'grip', name: 'Angled Grip', desc: 'Faster into the shoulder.', mods: { adsTime: 0.88, spread: 1.05 } },
    bipod:    { id: 'bipod', slot: 'grip', name: 'Folding Bipod', desc: 'Rock steady while crouched, dead weight while moving.', mods: { sway: 0.5, adsTime: 1.2 }, crouchBonus: true },
  },
  laser: {
    none:  { id: 'none', slot: 'laser', name: 'No Laser', desc: '', mods: {} },
    red:   { id: 'red', slot: 'laser', name: 'Target Laser', desc: 'Tightens the hip-fire cone. Everything that can see, sees it.', mods: { spread: 0.62 }, laserColor: 0xff2a1a, visible: true },
    ir:    { id: 'ir', slot: 'laser', name: 'Infrared Laser', desc: 'Invisible to the naked eye. Invisible to most of what lives here, too.', mods: { spread: 0.72 }, laserColor: 0x30203a, visible: false },
  },
};

export const SLOTS = ['optic', 'muzzle', 'barrel', 'mag', 'stock', 'grip', 'laser'];
export const SLOT_LABEL = {
  optic: 'Optic', muzzle: 'Muzzle', barrel: 'Barrel', mag: 'Magazine',
  stock: 'Stock', grip: 'Underbarrel', laser: 'Laser',
};

export function defaultLoadoutFor() {
  return { optic: 'iron', muzzle: 'none', barrel: 'standard', mag: 'standard', stock: 'standard', grip: 'none', laser: 'none' };
}

export function getAttachment(slot, id) {
  const s = ATTACHMENTS[slot];
  return (s && s[id]) || (s && s[Object.keys(s)[0]]) || null;
}

/**
 * Fold a weapon's base stats through its fitted attachments.
 * Returns a new stat object; the base definition is never mutated.
 */
export function resolveWeapon(base, fit) {
  const out = { ...base };
  const f = fit || defaultLoadoutFor();
  let magAdd = 0;
  out.noiseMul = 1; out.flashMul = 1;
  out.zoom = 1; out.magnified = false; out.optic = ATTACHMENTS.optic.iron;

  for (const slot of SLOTS) {
    const a = getAttachment(slot, f[slot]);
    if (!a) continue;
    for (const [k, v] of Object.entries(a.mods || {})) {
      if (k.endsWith('Add')) { if (k === 'magAdd') magAdd += v; continue; }
      if (typeof out[k] === 'number') out[k] *= v;
    }
    if (a.noise !== undefined) out.noiseMul *= a.noise;
    if (a.flash !== undefined) out.flashMul *= a.flash;
    if (slot === 'optic') {
      out.optic = a;
      out.zoom = a.zoom || 1;
      out.magnified = !!a.magnified;
      out.thermal = !!a.thermal;
      out.opticVignette = a.vignette || 0;
    }
    if (slot === 'laser' && a.visible) out.laserColor = a.laserColor;
    if (slot === 'grip' && a.crouchBonus) out.bipod = true;
  }
  if (magAdd) out.mag = Math.max(1, Math.round(base.mag * (1 + magAdd)));
  out.adsTime = Math.max(0.06, out.adsTime);
  return out;
}

/** A one-line summary of what a fit changes, for the armoury UI. */
export function describeMods(a) {
  const NICE = {
    damage: 'Damage', range: 'Range', recoil: 'Recoil', spread: 'Hip spread',
    adsSpread: 'ADS spread', adsTime: 'ADS speed', reload: 'Reload', sway: 'Sway',
    rate: 'Fire rate', magAdd: 'Magazine',
  };
  // For these, lower is better, so a 0.8 multiplier is a *gain*.
  const LOWER_BETTER = new Set(['recoil', 'spread', 'adsSpread', 'adsTime', 'reload', 'sway']);
  const out = [];
  for (const [k, v] of Object.entries(a.mods || {})) {
    if (k === 'magAdd') { out.push({ label: 'Magazine', delta: Math.round(v * 100), good: v > 0 }); continue; }
    const pct = Math.round((v - 1) * 100);
    if (pct === 0) continue;
    const good = LOWER_BETTER.has(k) ? pct < 0 : pct > 0;
    out.push({ label: NICE[k] || k, delta: LOWER_BETTER.has(k) ? -pct : pct, good });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* attachment geometry                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build the mesh for one attachment. Returns null for "none"-style entries.
 * `parts` carries anything the weapon system needs to talk to later (glass,
 * reticle, scope lens, laser beam).
 */
export function buildAttachment(slot, id, weaponScale = 1) {
  const def = getAttachment(slot, id);
  if (!def) return null;
  const gm = gunmetal(), pm = poly(), sm = steel(), rm = rubber();

  if (slot === 'optic') {
    if (def.id === 'iron') return null;
    return buildOptic(def);
  }

  if (slot === 'muzzle') {
    if (def.id === 'none') return null;
    const g = new THREE.Group();
    if (def.id === 'suppressor') {
      g.add(tube(0.019, 0.021, 0.135, 14, pm, 0, 0, -0.065, Math.PI / 2, false));
      for (let i = 0; i < 5; i++) g.add(tube(0.0205, 0.0205, 0.004, 14, gm, 0, 0, -0.02 - i * 0.024, Math.PI / 2, false));
    } else if (def.id === 'compensator') {
      g.add(tube(0.016, 0.016, 0.048, 12, gm, 0, 0, -0.024, Math.PI / 2, false));
      for (let i = 0; i < 3; i++) g.add(box(0.034, 0.006, 0.006, gm, 0, 0.011, -0.012 - i * 0.013));
    } else {
      g.add(tube(0.018, 0.015, 0.052, 12, sm, 0, 0, -0.026, Math.PI / 2, false));
      g.add(box(0.040, 0.030, 0.008, sm, 0, 0, -0.020));
      g.add(box(0.040, 0.030, 0.008, sm, 0, 0, -0.038));
    }
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return { group: g, parts: {} };
  }

  if (slot === 'barrel') {
    if (def.id === 'standard') return null;
    const g = new THREE.Group();
    const len = def.id === 'long' ? 0.20 : def.id === 'short' ? -0.06 : 0.06;
    const r = def.id === 'heavy' ? 0.017 : 0.011;
    if (len > 0) g.add(tube(r, r, len, 12, gm, 0, 0, -len / 2, Math.PI / 2, false));
    if (def.id === 'heavy') for (let i = 0; i < 4; i++) g.add(tube(r * 1.25, r * 1.25, 0.005, 12, gm, 0, 0, -0.02 - i * 0.02, Math.PI / 2, false));
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return { group: g, parts: {} };
  }

  if (slot === 'mag') {
    if (def.id === 'standard') return null;
    const g = new THREE.Group();
    if (def.id === 'drum') {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.030, 18), pm);
      d.rotation.z = Math.PI / 2; d.position.set(0, -0.055, 0);
      g.add(d);
      g.add(box(0.030, 0.05, 0.042, pm, 0, -0.02, 0));
    } else if (def.id === 'extended') {
      g.add(box(0.030, 0.075, 0.044, pm, 0, -0.052, 0.004));
    } else {
      g.add(box(0.034, 0.026, 0.048, rm, 0, -0.030, 0.002));
    }
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return { group: g, parts: {} };
  }

  if (slot === 'stock') {
    if (def.id === 'standard') return null;
    const g = new THREE.Group();
    if (def.id === 'none') return { group: g, parts: {}, hideBase: true };
    if (def.id === 'heavy') {
      g.add(box(0.048, 0.090, 0.20, pm, 0, -0.024, 0.13));
      g.add(box(0.052, 0.052, 0.020, rm, 0, -0.030, 0.235));
    } else {
      g.add(box(0.012, 0.060, 0.17, gm, 0, -0.018, 0.12));
      g.add(box(0.040, 0.010, 0.16, gm, 0, -0.046, 0.12));
      g.add(box(0.046, 0.046, 0.016, rm, 0, -0.030, 0.205));
    }
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return { group: g, parts: {}, hideBase: true };
  }

  if (slot === 'grip') {
    if (def.id === 'none') return null;
    const g = new THREE.Group();
    if (def.id === 'vertical') g.add(box(0.024, 0.070, 0.026, rm, 0, -0.040, 0));
    else if (def.id === 'angled') { const b = box(0.024, 0.058, 0.026, rm, 0, -0.032, -0.012); b.rotation.x = -0.5; g.add(b); }
    else {
      for (const s of [-1, 1]) {
        const leg = box(0.008, 0.075, 0.008, gm, s * 0.016, -0.042, 0);
        leg.rotation.z = s * 0.30;
        g.add(leg);
      }
      g.add(box(0.030, 0.016, 0.030, pm, 0, -0.012, 0));
    }
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return { group: g, parts: {} };
  }

  if (slot === 'laser') {
    if (def.id === 'none') return null;
    const g = new THREE.Group();
    g.add(box(0.020, 0.018, 0.044, pm, 0, 0, 0));
    const emitter = new THREE.Mesh(new THREE.CircleGeometry(0.005, 10),
      new THREE.MeshBasicMaterial({ color: def.laserColor, toneMapped: false }));
    emitter.position.set(0, 0, -0.023);
    emitter.rotation.y = Math.PI;
    g.add(emitter);
    const parts = { emitter, color: def.laserColor, visibleBeam: !!def.visible };
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return { group: g, parts };
  }

  return null;
}

export function disposeAttachmentMaterials() {
  for (const k of Object.keys(M)) { M[k].dispose(); delete M[k]; }
}
