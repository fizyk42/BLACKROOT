/**
 * WeaponForge — an endless armoury.
 *
 * Every forged weapon is a pure function of a 32-bit seed: chassis, tier,
 * stat rolls, traits, name and signature finish all fall out of the same
 * number. That gives 4,294,967,296 distinct weapons without storing any of
 * them — a save only ever holds the eight hex digits.
 *
 * Forged weapons are real items. They register themselves into the item
 * database, so the inventory, the weapon system, the HUD and the save file
 * treat them exactly like the hand-authored ones.
 */
import { makeRNG } from '../core/RNG.js';
import { WEAPONS, ITEMS } from './ItemDatabase.js';

export const FORGE_SPACE = 4294967296;

/* ------------------------------------------------------------------ */
/* chassis                                                             */
/* ------------------------------------------------------------------ */

/**
 * Each chassis is a *class* of weapon rather than a specific gun: the family
 * decides the shape, the feed and the role, and the roll decides the rest.
 */
export const CHASSIS = {
  sidearm: {
    id: 'sidearm', label: 'Sidearm', base: 'pistol9', viewModel: 'pistol', profile: 'pistol',
    ammo: 'ammo9', weight: 1.0,
    stats: { mag: 15, damage: 26, rate: 5.2, reload: 1.9, recoil: 1.0, spread: 0.010, adsSpread: 0.0022, range: 120, adsTime: 0.18, sway: 1.0, headMul: 2.2 },
    auto: false,
  },
  magnum: {
    id: 'magnum', label: 'Magnum', base: 'revolver', viewModel: 'revolver', profile: 'revolver',
    ammo: 'ammo357', weight: 1.3,
    stats: { mag: 6, damage: 62, rate: 1.9, reload: 3.2, recoil: 2.6, spread: 0.013, adsSpread: 0.003, range: 140, adsTime: 0.24, sway: 1.15, headMul: 2.4 },
    auto: false,
  },
  scattergun: {
    id: 'scattergun', label: 'Scattergun', base: 'shotgun', viewModel: 'shotgun', profile: 'shotgun',
    ammo: 'ammo12', weight: 3.2,
    stats: { mag: 6, damage: 17, rate: 0.95, reload: 0.62, recoil: 4.0, spread: 0.052, adsSpread: 0.036, range: 34, adsTime: 0.30, sway: 1.4, headMul: 1.5 },
    auto: false, pellets: 8, shellReload: true,
  },
  marksman: {
    id: 'marksman', label: 'Marksman Rifle', base: 'rifle', viewModel: 'rifle', profile: 'rifle',
    ammo: 'ammo308', weight: 3.9,
    stats: { mag: 5, damage: 96, rate: 0.85, reload: 3.6, recoil: 3.6, spread: 0.020, adsSpread: 0.0006, range: 300, adsTime: 0.36, sway: 1.5, headMul: 3.0 },
    auto: false, boltAction: true, zoom: 2.4,
  },
  machinePistol: {
    id: 'machinePistol', label: 'Machine Pistol', base: 'smg', viewModel: 'smg', profile: 'smg',
    ammo: 'ammo9', weight: 2.4,
    stats: { mag: 30, damage: 21, rate: 12.5, reload: 2.4, recoil: 1.15, spread: 0.020, adsSpread: 0.009, range: 90, adsTime: 0.20, sway: 1.1, headMul: 1.8 },
    auto: true,
  },
  carbine: {
    id: 'carbine', label: 'Assault Carbine', base: 'carbine', viewModel: 'carbine', profile: 'ar',
    ammo: 'ammo556', weight: 3.4,
    stats: { mag: 30, damage: 38, rate: 10.0, reload: 2.6, recoil: 1.6, spread: 0.014, adsSpread: 0.0028, range: 220, adsTime: 0.26, sway: 1.2, headMul: 2.2 },
    auto: true, zoom: 1.35,
  },
};

export const CHASSIS_LIST = Object.values(CHASSIS);

/* ------------------------------------------------------------------ */
/* tiers                                                               */
/* ------------------------------------------------------------------ */

export const TIERS = [
  { id: 'field', label: 'Field', color: '#8e8c84', weight: 0.42, power: 0.00, traits: 0 },
  { id: 'marked', label: 'Marked', color: '#6f9a72', weight: 0.28, power: 0.06, traits: 1 },
  { id: 'issued', label: 'Issued', color: '#5b8fc9', weight: 0.18, power: 0.13, traits: 1 },
  { id: 'relic', label: 'Relic', color: '#ad6bf0', weight: 0.09, power: 0.22, traits: 2 },
  { id: 'blackroot', label: 'Blackroot', color: '#d9a441', weight: 0.03, power: 0.34, traits: 3 },
];

/* ------------------------------------------------------------------ */
/* traits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Traits are the character of a forged weapon: each is a real trade, so a
 * high-tier roll is not automatically the gun you want to carry.
 */
export const TRAITS = [
  { id: 'hollowpoint', label: 'Hollowpoint', desc: 'Expands on impact. Loses velocity fast.', mods: { damage: 1.16, range: 0.82 } },
  { id: 'match', label: 'Match Grade', desc: 'Hand-lapped bore. Groups like a laser, wears quickly.', mods: { spread: 0.72, adsSpread: 0.62, reload: 1.08 } },
  { id: 'overclock', label: 'Overclocked', desc: 'Lightened bolt carrier. Faster than it has any right to be.', mods: { rate: 1.22, recoil: 1.18 } },
  { id: 'feather', label: 'Featherweight', desc: 'Skeletonised everything. Snaps to the shoulder.', mods: { adsTime: 0.80, sway: 1.22 } },
  { id: 'anchored', label: 'Anchored', desc: 'Heavy profile, dead steady, slow to swing.', mods: { recoil: 0.74, sway: 0.70, adsTime: 1.16 } },
  { id: 'longthrow', label: 'Long Throw', desc: 'Extended tube and a tight crown.', mods: { range: 1.30, adsTime: 1.08 } },
  { id: 'ravenous', label: 'Ravenous', desc: 'Oversized feed. Empties itself with enthusiasm.', mods: { magAdd: 0.34, reload: 1.14 } },
  { id: 'drilled', label: 'Drilled', desc: 'Tabbed mags and a cut-down well.', mods: { reload: 0.68 } },
  { id: 'quiet', label: 'Quiet Running', desc: 'Ported and baffled from the factory. The forest hears less.', mods: {}, noise: 0.55, flash: 0.6 },
  { id: 'headhunter', label: 'Headhunter', desc: 'Sighted for the top of the mass.', mods: { headMul: 1.35, damage: 0.94 } },
  { id: 'brutal', label: 'Brutal', desc: 'Overpressure loads. Everything about firing it is worse except the result.', mods: { damage: 1.28, recoil: 1.35, spread: 1.15 } },
  { id: 'surefooted', label: 'Surefooted', desc: 'Balanced for shooting on the move.', mods: { spread: 0.80, sway: 0.84 } },
];

const TRAIT_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

/* ------------------------------------------------------------------ */
/* naming                                                              */
/* ------------------------------------------------------------------ */

const MAKERS = ['Halloway', 'Bowman', 'Verrick', 'Ostend', 'Kaltbrun', 'Marrow & Sons',
  'Lantern Works', 'Pell', 'Ardath', 'Ninefold', 'Carrow', 'Stannis', 'Vosk', 'Deering',
  'Merrow', 'Ashgrove', 'Thorne', 'Quillan'];
const LETTERS = 'ABCDEFGHKLMPRSTVXZ';
const NICK_A = ['Ashen', 'Hollow', 'Silent', 'Drowned', 'Burnt', 'Pale', 'Iron', 'Wretched',
  'Frozen', 'Rotting', 'Gilded', 'Feral', 'Broken', 'Starless', 'Bitter', 'Second',
  'Long', 'Low', 'Quiet', 'Black', 'Hungry', 'Split', 'Grave', 'Salt'];
const NICK_B = ['Widow', 'Sermon', 'Vigil', 'Choir', 'Tide', 'Bloom', 'Cinder', 'Vein',
  'Wake', 'Husk', 'Lantern', 'Thaw', 'Harrow', 'Grain', 'Fathom', 'Ledger',
  'Cradle', 'Lure', 'Spine', 'Bell', 'Root', 'Frost', 'Static', 'Verse'];

/* ------------------------------------------------------------------ */
/* forging                                                             */
/* ------------------------------------------------------------------ */

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;

export function forgeId(seed) {
  return 'fg_' + ((seed >>> 0).toString(16).padStart(8, '0'));
}

export function seedFromId(id) {
  const m = /^fg_([0-9a-f]{8})$/.exec(String(id));
  return m ? (parseInt(m[1], 16) >>> 0) : null;
}

export function isForged(id) { return seedFromId(id) !== null; }

/** Describe a forged weapon without registering it. */
export function forgeInfo(seed) {
  seed = seed >>> 0;
  const r = makeRNG((seed ^ 0x7F4A7C15) >>> 0);

  const chassis = pick(r, CHASSIS_LIST);

  // tier
  let v = r(), acc = 0, tier = TIERS[0];
  for (const t of TIERS) { acc += t.weight; if (v <= acc) { tier = t; break; } }

  // traits, never duplicated
  const traits = [];
  const pool = TRAITS.slice();
  for (let i = 0; i < tier.traits && pool.length; i++) {
    traits.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  }

  // stat rolls: a spread around the chassis baseline, biased up by tier
  const P = tier.power;
  const rollUp = () => lerp(0.90, 1.14, r()) * (1 + P);          // higher is better
  const rollDown = () => lerp(0.88, 1.12, r()) * (1 - P * 0.55); // lower is better

  const s = { ...chassis.stats };
  s.damage = s.damage * rollUp();
  s.rate = s.rate * lerp(0.92, 1.10, r());
  s.range = s.range * rollUp();
  s.recoil = s.recoil * rollDown();
  s.spread = s.spread * rollDown();
  s.adsSpread = s.adsSpread * rollDown();
  s.adsTime = s.adsTime * rollDown();
  s.reload = s.reload * rollDown();
  s.sway = s.sway * rollDown();
  s.mag = Math.max(1, Math.round(s.mag * lerp(0.85, 1.2, r()) * (1 + P * 0.5)));

  let noiseMul = 1, flashMul = 1;
  let magAdd = 0;
  for (const t of traits) {
    for (const [k, val] of Object.entries(t.mods)) {
      if (k === 'magAdd') { magAdd += val; continue; }
      if (typeof s[k] === 'number') s[k] *= val;
    }
    if (t.noise !== undefined) noiseMul *= t.noise;
    if (t.flash !== undefined) flashMul *= t.flash;
  }
  if (magAdd) s.mag = Math.max(1, Math.round(s.mag * (1 + magAdd)));

  // name
  const maker = pick(r, MAKERS);
  const letter = LETTERS[Math.floor(r() * LETTERS.length)];
  const num = 1 + Math.floor(r() * 98);
  const model = `${letter}-${num}`;
  const nickname = tier.traits >= 2 ? `${pick(r, NICK_A)} ${pick(r, NICK_B)}` : null;

  // signature finish, applied by default at the two highest tiers
  const camoSeed = (r() * FORGE_SPACE) >>> 0;
  const presetCamo = tier.power >= 0.22 ? camoSeed : null;

  // an opinionated factory fit, so a forged weapon arrives feeling built
  const fit = {
    optic: pickFit(r, chassis, 'optic'),
    muzzle: pickFit(r, chassis, 'muzzle'),
    barrel: pickFit(r, chassis, 'barrel'),
    mag: 'standard',
    stock: pickFit(r, chassis, 'stock'),
    grip: pickFit(r, chassis, 'grip'),
    laser: r() < 0.18 ? 'red' : 'none',
  };

  const rating = powerRating(s, chassis);

  return {
    seed, id: forgeId(seed), chassis, tier, traits, stats: s,
    maker, model, nickname, camoSeed, presetCamo, fit,
    noiseMul, flashMul, rating,
    name: nickname ? `${maker} ${model} “${nickname}”` : `${maker} ${model}`,
  };
}

function pickFit(r, chassis, slot) {
  const v = r();
  if (slot === 'optic') {
    if (chassis.id === 'marksman') return v < 0.5 ? 'sniper' : v < 0.8 ? 'acog' : 'iron';
    if (chassis.id === 'scattergun') return v < 0.4 ? 'reflex' : 'iron';
    if (chassis.id === 'sidearm' || chassis.id === 'magnum') return v < 0.35 ? 'reflex' : 'iron';
    return v < 0.32 ? 'reflex' : v < 0.55 ? 'holo' : v < 0.68 ? 'acog' : 'iron';
  }
  if (slot === 'muzzle') return v < 0.22 ? 'suppressor' : v < 0.42 ? 'compensator' : v < 0.55 ? 'brake' : 'none';
  if (slot === 'barrel') return v < 0.2 ? 'long' : v < 0.35 ? 'heavy' : v < 0.48 ? 'short' : 'standard';
  if (slot === 'stock') {
    if (chassis.id === 'sidearm' || chassis.id === 'magnum') return 'standard';
    return v < 0.22 ? 'heavy' : v < 0.44 ? 'light' : 'standard';
  }
  if (slot === 'grip') {
    if (chassis.id === 'sidearm' || chassis.id === 'magnum') return 'none';
    return v < 0.24 ? 'vertical' : v < 0.4 ? 'angled' : v < 0.5 ? 'bipod' : 'none';
  }
  return 'none';
}

/** A single readable 0–100 number for sorting the armoury list. */
export function powerRating(s, chassis) {
  const b = chassis.stats;
  const dps = s.damage * s.rate * (chassis.pellets || 1);
  const baseDps = b.damage * b.rate * (chassis.pellets || 1);
  const acc = (b.spread / s.spread) * 0.5 + (b.recoil / s.recoil) * 0.5;
  const handling = (b.adsTime / s.adsTime) * 0.5 + (b.reload / s.reload) * 0.5;
  const reach = s.range / b.range;
  const raw = (dps / baseDps) * 0.45 + acc * 0.2 + handling * 0.2 + reach * 0.15;
  return Math.max(1, Math.min(100, Math.round(raw * 52)));
}

/* ------------------------------------------------------------------ */
/* registration                                                        */
/* ------------------------------------------------------------------ */

const forged = new Map();   // id -> item definition

/**
 * Turn a seed into a real, equippable item and register it.
 * Calling this twice with the same seed returns the same definition.
 */
export function forgeWeapon(seed) {
  const id = forgeId(seed);
  if (forged.has(id)) return forged.get(id);
  const info = forgeInfo(seed);
  const c = info.chassis;
  const s = info.stats;

  const def = {
    id, name: info.name, cat: 'weapon', kind: 'gun', icon: '🔫',
    weight: +(c.weight * 1.0).toFixed(2), stack: 1,
    desc: describe(info),
    ammo: c.ammo,
    mag: s.mag,
    damage: +s.damage.toFixed(1),
    rate: +s.rate.toFixed(2),
    auto: c.auto,
    reload: +s.reload.toFixed(2),
    recoil: +s.recoil.toFixed(2),
    spread: +s.spread.toFixed(5),
    adsSpread: +s.adsSpread.toFixed(5),
    range: Math.round(s.range),
    adsTime: +Math.max(0.08, s.adsTime).toFixed(3),
    sway: +s.sway.toFixed(2),
    headMul: +s.headMul.toFixed(2),
    profile: c.profile,
    viewModel: c.viewModel,
    rarity: info.tier.id,
    forged: true,
    forgeInfo: info,
  };
  if (c.pellets) def.pellets = c.pellets;
  if (c.shellReload) def.shellReload = true;
  if (c.boltAction) def.boltAction = true;
  if (c.zoom) def.zoom = c.zoom;
  if (info.noiseMul !== 1) def.forgeNoise = info.noiseMul;
  if (info.flashMul !== 1) def.forgeFlash = info.flashMul;

  WEAPONS[id] = def;
  ITEMS[id] = def;
  forged.set(id, def);
  return def;
}

function describe(info) {
  const t = info.traits.map((x) => x.label).join(', ');
  const role = {
    sidearm: 'A sidearm you can bring up one-handed while the other hand is busy.',
    magnum: 'Six answers, each of them final.',
    scattergun: 'For the first metre, and nothing past thirty.',
    marksman: 'One good shot, taken slowly, from somewhere they cannot reach.',
    machinePistol: 'Empties itself faster than you can regret it.',
    carbine: 'Selective fire and forgiving recoil. The soldier\'s compromise.',
  }[info.chassis.id];
  return `${info.tier.label}-grade ${info.chassis.label.toLowerCase()} out of the ${info.maker} line. ${role}` +
    (t ? ` Marked: ${t}.` : '');
}

/** Re-register anything a save file refers to. */
export function ensureForged(id) {
  const seed = seedFromId(id);
  if (seed === null) return null;
  return forgeWeapon(seed);
}

/** Scan an arbitrary structure for forged ids and re-register every one. */
export function ensureForgedIn(data) {
  const ids = String(JSON.stringify(data) || '').match(/fg_[0-9a-f]{8}/g);
  if (!ids) return 0;
  const uniq = Array.from(new Set(ids));
  for (const id of uniq) ensureForged(id);
  return uniq.length;
}

/** A deterministic page of forged weapons for the armoury list. */
export function forgePage(page, perPage = 24, salt = 0) {
  const out = [];
  const r = makeRNG(((page * 2654435761) ^ (salt * 40503) ^ 0x5EED) >>> 0);
  for (let i = 0; i < perPage; i++) out.push((r() * FORGE_SPACE) >>> 0);
  return out;
}

/** A page filtered to one chassis, so the class tabs stay honest. */
export function forgePageFor(chassisId, page, perPage = 24, salt = 0) {
  const out = [];
  let p = page * 97, guard = 0;
  while (out.length < perPage && guard < 40000) {
    const r = makeRNG(((p * 2654435761) ^ (salt * 40503) ^ 0x5EED) >>> 0);
    for (let i = 0; i < 64 && out.length < perPage; i++) {
      const seed = (r() * FORGE_SPACE) >>> 0;
      guard++;
      if (chassisOf(seed) === chassisId) out.push(seed);
    }
    p++;
  }
  return out;
}

/** Cheap chassis lookup that does not build the whole weapon. */
export function chassisOf(seed) {
  const r = makeRNG(((seed >>> 0) ^ 0x7F4A7C15) >>> 0);
  return CHASSIS_LIST[Math.floor(r() * CHASSIS_LIST.length)].id;
}
