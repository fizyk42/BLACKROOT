/**
 * ItemDatabase — every carryable thing in the Hollow, plus the loot tables
 * that decide what turns up where.
 *
 * Item shape:
 *   id, name, cat, icon, weight, stack, desc
 *   + category-specific fields (weapon / consumable / ammo)
 */

export const AMMO = {
  ammo9: { id: 'ammo9', name: '9×19mm Rounds', cat: 'ammo', icon: '▮', weight: 0.012, stack: 180, desc: 'Common pistol and submachine gun ammunition. Plentiful, unremarkable.' },
  ammo357: { id: 'ammo357', name: '.357 Magnum Rounds', cat: 'ammo', icon: '▮', weight: 0.020, stack: 90, desc: 'Heavy revolver ammunition. Punches far above its size.' },
  ammo12: { id: 'ammo12', name: '12-Gauge Shells', cat: 'ammo', icon: '▰', weight: 0.045, stack: 60, desc: 'Buckshot. Devastating up close, useless past twenty metres.' },
  ammo308: { id: 'ammo308', name: '.308 Rifle Rounds', cat: 'ammo', icon: '▯', weight: 0.026, stack: 80, desc: 'Full-power hunting cartridge. Scarce out here. Make them count.' },
  ammo556: { id: 'ammo556', name: '5.56mm Rounds', cat: 'ammo', icon: '▯', weight: 0.014, stack: 150, desc: 'Military rifle ammunition. Only found inside the cordon.' },
};

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Hunting Knife', cat: 'weapon', kind: 'melee', icon: '🗡', weight: 0.4, stack: 1,
    desc: 'A worn skinning knife. Silent, endlessly reusable, and a poor argument against anything larger than you.',
    damage: 34, rate: 2.2, range: 2.3, arc: 0.55, staminaCost: 8, headMul: 1.6,
    viewModel: 'knife', sfx: 'knife',
  },
  axe: {
    id: 'axe', name: 'Splitting Axe', cat: 'weapon', kind: 'melee', icon: '🪓', weight: 2.6, stack: 1,
    desc: 'Heavy, slow and genuinely frightening. Costs stamina but staggers almost anything.',
    damage: 68, rate: 1.05, range: 2.6, arc: 0.7, staminaCost: 18, headMul: 1.4, stagger: 1.0,
    viewModel: 'axe', sfx: 'axe',
  },
  machete: {
    id: 'machete', name: 'Brush Machete', cat: 'weapon', kind: 'melee', icon: '⚔', weight: 1.2, stack: 1,
    desc: 'Long, fast and made for clearing undergrowth. It clears other things too.',
    damage: 46, rate: 1.7, range: 2.7, arc: 0.65, staminaCost: 12, headMul: 1.5,
    viewModel: 'machete', sfx: 'machete',
  },

  pistol9: {
    id: 'pistol9', name: 'M-9 Sidearm', cat: 'weapon', kind: 'gun', icon: '🔫', weight: 1.0, stack: 1,
    desc: 'A 9mm service automatic. Fifteen rounds, quick to bring up, easy to feed. Your reliable last word.',
    ammo: 'ammo9', mag: 15, damage: 26, rate: 5.2, auto: false, reload: 1.9,
    recoil: 1.0, spread: 0.010, adsSpread: 0.0022, range: 120, adsTime: 0.18,
    sway: 1.0, headMul: 2.2, profile: 'pistol', viewModel: 'pistol', rarity: 'common',
  },
  revolver: {
    id: 'revolver', name: 'Bowman .357', cat: 'weapon', kind: 'gun', icon: '🔫', weight: 1.3, stack: 1,
    desc: 'Six shots of magnum. Slow to reload and loud enough to bring the whole hollow down on you.',
    ammo: 'ammo357', mag: 6, damage: 62, rate: 1.9, auto: false, reload: 3.2,
    recoil: 2.6, spread: 0.013, adsSpread: 0.003, range: 140, adsTime: 0.24,
    sway: 1.15, headMul: 2.4, profile: 'revolver', viewModel: 'revolver', rarity: 'uncommon',
  },
  shotgun: {
    id: 'shotgun', name: 'Coachman 12-Gauge', cat: 'weapon', kind: 'gun', icon: '🔫', weight: 3.2, stack: 1,
    desc: 'A pump-action bird gun pressed into ugly work. Eight pellets a shell, and nothing survives the first metre.',
    ammo: 'ammo12', mag: 6, damage: 17, pellets: 8, rate: 0.95, auto: false, reload: 0.62, shellReload: true,
    recoil: 4.0, spread: 0.052, adsSpread: 0.036, range: 34, adsTime: 0.3,
    sway: 1.4, headMul: 1.5, profile: 'shotgun', viewModel: 'shotgun', rarity: 'uncommon',
  },
  rifle: {
    id: 'rifle', name: 'Halloway Bolt Rifle', cat: 'weapon', kind: 'gun', icon: '🔫', weight: 3.9, stack: 1,
    desc: 'A .308 hunting rifle with a scarred stock. One good shot is worth six bad ones.',
    ammo: 'ammo308', mag: 5, damage: 96, rate: 0.85, auto: false, reload: 3.6, boltAction: true,
    recoil: 3.6, spread: 0.020, adsSpread: 0.0006, range: 300, adsTime: 0.36, zoom: 2.4,
    sway: 1.5, headMul: 3.0, profile: 'rifle', viewModel: 'rifle', rarity: 'rare',
  },
  smg: {
    id: 'smg', name: 'Vector-9 Compact', cat: 'weapon', kind: 'gun', icon: '🔫', weight: 2.4, stack: 1,
    desc: 'A blowback 9mm machine pistol. Empties itself faster than you can regret it.',
    ammo: 'ammo9', mag: 30, damage: 21, rate: 12.5, auto: true, reload: 2.4,
    recoil: 1.15, spread: 0.020, adsSpread: 0.009, range: 90, adsTime: 0.20,
    sway: 1.1, headMul: 1.8, profile: 'smg', viewModel: 'smg', rarity: 'rare',
  },
  carbine: {
    id: 'carbine', name: 'AR-4 Service Carbine', cat: 'weapon', kind: 'gun', icon: '🔫', weight: 3.4, stack: 1,
    desc: 'Military 5.56. Selective fire, forgiving recoil, and only ever found where somebody died holding it.',
    ammo: 'ammo556', mag: 30, damage: 38, rate: 10.0, auto: true, reload: 2.6,
    recoil: 1.6, spread: 0.014, adsSpread: 0.0028, range: 220, adsTime: 0.26, zoom: 1.35,
    sway: 1.2, headMul: 2.2, profile: 'ar', viewModel: 'carbine', rarity: 'veryrare',
  },
};

export const CONSUMABLES = {
  berries: { id: 'berries', name: 'Hollow Berries', cat: 'food', icon: '🫐', weight: 0.05, stack: 30, useTime: 1.4,
    hunger: 9, thirst: 4, health: 2, desc: 'Small, sharp and just this side of edible. Barely a mouthful, but they add up.' },
  apple: { id: 'apple', name: 'Wild Apple', cat: 'food', icon: '🍎', weight: 0.16, stack: 12, useTime: 2.0,
    hunger: 20, thirst: 9, health: 3, desc: 'Hard, sour and half wormed. Still the best thing you have eaten in two days.' },
  mushroom: { id: 'mushroom', name: 'Pale Cap Mushroom', cat: 'food', icon: '🍄', weight: 0.06, stack: 20, useTime: 1.8,
    hunger: 14, thirst: 0, health: 0, desc: 'Firm white flesh, faint smell of earth. Cooked would be better. There is no cooking here.' },
  nuts: { id: 'nuts', name: 'Beech Nuts', cat: 'food', icon: '🌰', weight: 0.04, stack: 40, useTime: 1.3,
    hunger: 8, thirst: -2, health: 0, desc: 'Oily, filling, and they make you thirsty. A fair trade when there is nothing else.' },
  root: { id: 'root', name: 'Edible Root', cat: 'food', icon: '🥕', weight: 0.12, stack: 15, useTime: 2.4,
    hunger: 24, thirst: 5, health: 0, desc: 'Fibrous and bitter. Dug from the creek bank where the soil is soft.' },
  jerky: { id: 'jerky', name: 'Dried Meat', cat: 'food', icon: '🥩', weight: 0.10, stack: 12, useTime: 2.2,
    hunger: 34, thirst: -6, health: 4, desc: 'Somebody smoked this a long time ago and never came back for it.' },
  canned: { id: 'canned', name: 'Tinned Stew', cat: 'food', icon: '🥫', weight: 0.40, stack: 8, useTime: 3.2,
    hunger: 48, thirst: 10, health: 8, desc: 'Cold, greasy, and the single most valuable object you own right now.' },
  water: { id: 'water', name: 'Canteen Water', cat: 'food', icon: '💧', weight: 0.5, stack: 6, useTime: 2.6,
    hunger: 0, thirst: 46, health: 0, desc: 'Boiled at some point. Probably.' },

  bandage: { id: 'bandage', name: 'Field Bandage', cat: 'medical', icon: '🩹', weight: 0.08, stack: 10, useTime: 3.0,
    health: 18, healOverTime: 16, healDuration: 12, stopsBleed: true,
    desc: 'Stops bleeding immediately and knits the wound slowly. The cheap, sensible option.' },
  medkit: { id: 'medkit', name: 'Trauma Kit', cat: 'medical', icon: '🧰', weight: 0.9, stack: 4, useTime: 5.2,
    health: 70, stopsBleed: true, curePoison: true,
    desc: 'Sealed military trauma kit. Everything you need to stay upright, once.' },
  herb: { id: 'herb', name: 'Bitterleaf Herb', cat: 'medical', icon: '🌿', weight: 0.03, stack: 25, useTime: 2.0,
    health: 8, healOverTime: 10, healDuration: 10, curePoison: true,
    desc: 'Grows in the shade of old growth. Chewed raw it takes the edge off almost anything.' },
  painkillers: { id: 'painkillers', name: 'Analgesic Tablets', cat: 'medical', icon: '💊', weight: 0.05, stack: 12, useTime: 1.6,
    health: 6, damageResist: 0.35, resistDuration: 40, staminaBoost: 0.4,
    desc: 'Dulls pain and fear alike for a while. What it does not do is close the hole in you.' },
};

export const SUPPLIES = {
  battery: { id: 'battery', name: 'Lamp Cell', cat: 'supply', icon: '🔋', weight: 0.09, stack: 12, useTime: 1.2,
    battery: 100, desc: 'A fat lithium cell for a hand lamp. Light is the only thing out here that reliably works.' },
  cloth: { id: 'cloth', name: 'Torn Cloth', cat: 'supply', icon: '🧵', weight: 0.04, stack: 30,
    desc: 'Strips of canvas and shirt. Crude, but it will hold a dressing on.' },
  scrap: { id: 'scrap', name: 'Scrap Metal', cat: 'supply', icon: '⚙', weight: 0.25, stack: 25,
    desc: 'Bent brackets, hinges, casing fragments. Heavy for what it is.' },
  flare: { id: 'flare', name: 'Signal Flare', cat: 'supply', icon: '🧨', weight: 0.2, stack: 6, useTime: 1.0,
    throwable: true, desc: 'Burns furiously red for half a minute. Lights an area — and draws every eye toward it.' },
  key_cabinet: { id: 'key_cabinet', name: 'Cabinet Tin Key', cat: 'key', icon: '🗝', weight: 0.02, stack: 1,
    desc: 'A small brass key from a tobacco tin. Ranger district, medical cabinet.' },
  sample: { id: 'sample', name: 'Tissue Sample', cat: 'key', icon: '🧪', weight: 0.15, stack: 5,
    desc: 'A sealed vial of something dark that has not stopped moving since you took it.' },
};

export const ITEMS = { ...AMMO, ...WEAPONS, ...CONSUMABLES, ...SUPPLIES };

export function getItem(id) { return ITEMS[id] || null; }

export function isWeapon(id) { const i = ITEMS[id]; return !!i && i.cat === 'weapon'; }
export function isConsumable(id) { const i = ITEMS[id]; return !!i && (i.cat === 'food' || i.cat === 'medical' || i.id === 'battery'); }

/* ------------------------------------------------------------------ */
/* Loot tables. Weight is relative within a table.                      */
/* Entries: [itemId, weight, minQty, maxQty]                            */
/* ------------------------------------------------------------------ */

export const LOOT_TABLES = {
  camp: [
    ['berries', 12, 2, 5], ['nuts', 10, 2, 6], ['apple', 8, 1, 3],
    ['cloth', 10, 1, 3], ['bandage', 8, 1, 2], ['battery', 7, 1, 1],
    ['ammo9', 9, 5, 12], ['jerky', 5, 1, 2], ['canned', 3, 1, 1],
    ['knife', 3, 1, 1], ['herb', 6, 1, 3], ['water', 5, 1, 2],
  ],
  cabin: [
    ['ammo12', 14, 3, 8], ['canned', 9, 1, 2], ['jerky', 8, 1, 3],
    ['bandage', 8, 1, 3], ['battery', 8, 1, 2], ['cloth', 7, 1, 4],
    ['shotgun', 5, 1, 1], ['axe', 5, 1, 1], ['ammo308', 5, 2, 5],
    ['knife', 4, 1, 1], ['water', 6, 1, 2], ['scrap', 6, 1, 3],
    ['rifle', 2, 1, 1], ['medkit', 2, 1, 1],
  ],
  ranger: [
    ['bandage', 14, 2, 4], ['medkit', 8, 1, 2], ['herb', 10, 2, 5],
    ['painkillers', 8, 1, 2], ['battery', 10, 1, 3], ['ammo9', 9, 8, 20],
    ['ammo12', 7, 3, 7], ['canned', 6, 1, 2], ['water', 8, 1, 3],
    ['revolver', 4, 1, 1], ['flare', 6, 1, 3], ['key_cabinet', 3, 1, 1],
  ],
  medical: [
    ['medkit', 16, 1, 2], ['bandage', 20, 2, 5], ['painkillers', 14, 1, 3],
    ['herb', 12, 2, 4], ['cloth', 10, 2, 5], ['water', 8, 1, 2],
  ],
  wreck: [
    ['scrap', 14, 2, 5], ['cloth', 10, 1, 4], ['ammo9', 12, 6, 15],
    ['bandage', 9, 1, 3], ['battery', 8, 1, 2], ['canned', 7, 1, 2],
    ['flare', 8, 1, 2], ['painkillers', 5, 1, 2], ['pistol9', 4, 1, 1],
    ['smg', 2, 1, 1], ['medkit', 3, 1, 1],
  ],
  military: [
    ['ammo556', 16, 12, 30], ['medkit', 9, 1, 2], ['ammo9', 10, 10, 24],
    ['carbine', 5, 1, 1], ['smg', 6, 1, 1], ['painkillers', 8, 1, 3],
    ['flare', 8, 2, 4], ['battery', 8, 2, 4], ['scrap', 7, 2, 5],
    ['canned', 6, 1, 3], ['bandage', 9, 2, 4], ['sample', 3, 1, 1],
  ],
  cave: [
    ['ammo308', 12, 4, 10], ['rifle', 5, 1, 1], ['medkit', 8, 1, 2],
    ['ammo12', 10, 4, 9], ['canned', 9, 1, 3], ['battery', 10, 2, 4],
    ['machete', 6, 1, 1], ['sample', 5, 1, 2], ['ammo357', 8, 6, 14],
    ['revolver', 4, 1, 1], ['painkillers', 7, 1, 2],
  ],
  tower: [
    ['battery', 16, 2, 5], ['scrap', 12, 2, 6], ['flare', 12, 2, 4],
    ['ammo9', 10, 8, 18], ['bandage', 9, 1, 3], ['canned', 7, 1, 2],
    ['smg', 4, 1, 1], ['medkit', 4, 1, 1], ['painkillers', 6, 1, 2],
  ],
  ruin: [
    ['cloth', 14, 1, 4], ['scrap', 12, 1, 4], ['ammo9', 9, 4, 10],
    ['bandage', 8, 1, 2], ['nuts', 8, 2, 5], ['berries', 8, 2, 5],
    ['battery', 7, 1, 2], ['knife', 4, 1, 1], ['ammo12', 6, 2, 5],
  ],
  graves: [
    ['cloth', 12, 1, 3], ['herb', 12, 2, 4], ['bandage', 8, 1, 2],
    ['ammo357', 7, 4, 9], ['revolver', 3, 1, 1], ['scrap', 8, 1, 3],
    ['jerky', 6, 1, 2],
  ],
  nest: [
    ['sample', 14, 1, 3], ['medkit', 8, 1, 1], ['ammo308', 8, 3, 7],
    ['ammo12', 8, 3, 7], ['machete', 5, 1, 1], ['painkillers', 8, 1, 2],
    ['herb', 10, 2, 5], ['battery', 8, 1, 3], ['canned', 6, 1, 2],
  ],
  dock: [
    ['water', 16, 1, 3], ['cloth', 10, 1, 3], ['ammo9', 9, 4, 10],
    ['bandage', 8, 1, 2], ['root', 12, 2, 5], ['scrap', 8, 1, 3],
  ],
  body: [
    ['ammo9', 14, 4, 12], ['bandage', 12, 1, 3], ['battery', 9, 1, 2],
    ['cloth', 10, 1, 3], ['pistol9', 6, 1, 1], ['canned', 6, 1, 1],
    ['ammo12', 7, 2, 6], ['painkillers', 6, 1, 2], ['flare', 5, 1, 2],
    ['jerky', 6, 1, 2],
  ],
  forage: [
    ['berries', 30, 2, 6], ['mushroom', 22, 1, 3], ['nuts', 20, 2, 5],
    ['herb', 14, 1, 3], ['root', 12, 1, 2], ['apple', 12, 1, 2],
  ],
};

/** Roll a loot table. Tier scales quantity and re-roll chance. */
export function rollLoot(table, rng, tier = 1, lootMul = 1) {
  const t = LOOT_TABLES[table];
  if (!t) return [];
  const out = [];
  const rolls = Math.max(1, Math.round((0.9 + tier * 0.55) * lootMul + rng() * 0.9));
  for (let i = 0; i < rolls; i++) {
    const total = t.reduce((s, e) => s + e[1], 0);
    let r = rng() * total;
    for (const e of t) {
      r -= e[1];
      if (r <= 0) {
        const qty = Math.max(1, Math.round(rng.range(e[2], e[3]) * (0.75 + tier * 0.14) * lootMul));
        const existing = out.find((o) => o.id === e[0]);
        const item = ITEMS[e[0]];
        if (item && item.cat === 'weapon' && item.kind !== 'melee' && rng() > 0.62) break; // guns stay scarce
        if (existing && item && item.stack > 1) existing.qty += qty;
        else out.push({ id: e[0], qty: item && item.stack === 1 ? 1 : qty });
        break;
      }
    }
  }
  return out;
}

/** Starting loadout for a new run. */
/**
 * What you wake up with.
 *
 * Deliberately more than a survival purist would give you. The first ten
 * minutes are where a player decides whether the game is fair, and thirty
 * rounds and two bandages is not enough to survive being surprised twice —
 * which, in a dark forest you have never seen before, you will be.
 */
export function startingLoadout() {
  return [
    { id: 'pistol9', qty: 1 },
    { id: 'ammo9', qty: 64 },
    { id: 'knife', qty: 1 },
    { id: 'bandage', qty: 5 },
    { id: 'medkit', qty: 1 },
    { id: 'berries', qty: 5 },
    { id: 'water', qty: 2 },
    { id: 'battery', qty: 2 },
  ];
}
