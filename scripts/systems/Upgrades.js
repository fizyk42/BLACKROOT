/**
 * Upgrades — permanent, per-weapon tuning tracks bought with armoury points.
 *
 * Attachments are a *trade*: every one of them gives something up. Upgrades are
 * a *investment*: they only ever improve the weapon, but they are rationed by a
 * currency you earn by surviving, so the interesting decision is which weapon
 * you commit to rather than which stat you take.
 *
 * Levels are stored per weapon id as a plain object, so they serialise into the
 * save file with no extra work.
 */

export const UPGRADE_TRACKS = [
  {
    id: 'ballistics', label: 'Terminal Ballistics', max: 5, baseCost: 2,
    desc: 'Hotter loads and better projectiles.',
    per: { damage: 0.055 },
    line: (n) => `+${Math.round(n * 5.5)}% damage`,
  },
  {
    id: 'control', label: 'Recoil Control', max: 5, baseCost: 2,
    desc: 'Buffered springs and a tuned gas system.',
    per: { recoil: -0.075 },
    line: (n) => `−${Math.round(n * 7.5)}% recoil`,
  },
  {
    id: 'handling', label: 'Handling', max: 5, baseCost: 2,
    desc: 'Lightened furniture and a slicker mount.',
    per: { adsTime: -0.045, sway: -0.055 },
    line: (n) => `−${Math.round(n * 4.5)}% aim time · −${Math.round(n * 5.5)}% sway`,
  },
  {
    id: 'capacity', label: 'Feed Capacity', max: 4, baseCost: 3,
    desc: 'Reworked follower and a longer body.',
    per: { magAdd: 0.10 },
    line: (n) => `+${Math.round(n * 10)}% magazine`,
  },
  {
    id: 'barrel', label: 'Barrel Tuning', max: 5, baseCost: 2,
    desc: 'Lapped bore, tighter crown.',
    per: { range: 0.075, adsSpread: -0.06 },
    line: (n) => `+${Math.round(n * 7.5)}% range · −${Math.round(n * 6)}% aimed spread`,
  },
  {
    id: 'drills', label: 'Reload Drills', max: 5, baseCost: 2,
    desc: 'Muscle memory. The only upgrade that is really about you.',
    per: { reload: -0.06 },
    line: (n) => `−${Math.round(n * 6)}% reload time`,
  },
];

export const TRACK_BY_ID = Object.fromEntries(UPGRADE_TRACKS.map((t) => [t.id, t]));

/** Cost of taking `track` from `level` to `level + 1`. */
export function upgradeCost(track, level) {
  return track.baseCost + level * track.baseCost;
}

export function emptyUpgrades() {
  const o = {};
  for (const t of UPGRADE_TRACKS) o[t.id] = 0;
  return o;
}

/** Total points sunk into a weapon, used for the "refund / reset" action. */
export function investedIn(levels) {
  let total = 0;
  for (const t of UPGRADE_TRACKS) {
    const n = (levels && levels[t.id]) || 0;
    for (let i = 0; i < n; i++) total += upgradeCost(t, i);
  }
  return total;
}

/**
 * Fold upgrade levels into an already-attachment-resolved stat block.
 * Mutates and returns `stats`.
 */
export function applyUpgrades(stats, levels, baseMag) {
  if (!levels) return stats;
  let magAdd = 0;
  for (const t of UPGRADE_TRACKS) {
    const n = levels[t.id] || 0;
    if (!n) continue;
    for (const [k, v] of Object.entries(t.per)) {
      if (k === 'magAdd') { magAdd += v * n; continue; }
      if (typeof stats[k] === 'number') stats[k] *= 1 + v * n;
    }
  }
  if (magAdd && baseMag) stats.mag = Math.max(1, Math.round(stats.mag + baseMag * magAdd));
  stats.adsTime = Math.max(0.06, stats.adsTime || 0.2);
  return stats;
}

/** Points earned so far this run, from the things the player actually did. */
export function earnedPoints(stats) {
  if (!stats) return 0;
  return Math.floor(
    stats.kills * 2 +
    (stats.landmarksFound || 0) * 4 +
    Math.floor((stats.timeAlive || 0) / 120) +
    Math.floor((stats.itemsLooted || 0) / 6)
  );
}
