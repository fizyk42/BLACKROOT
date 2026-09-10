// Save/load. The important detail is the claimed-reward ledger: every payout in the
// game carries a unique id, and an id can only ever be claimed once per profile.
// Reloading an old save cannot re-bank a reward that profile already banked, and it
// cannot re-grant a vehicle that is already in the garage.

import { store } from './settings.js';

const SLOT_PREFIX = 'pa_save_v1_';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];
export const SAVE_VERSION = 3;

export function slotKey(slot) { return SLOT_PREFIX + slot; }

export function listSaves() {
  return SLOTS.map((slot) => {
    const raw = store.getItem(slotKey(slot));
    if (!raw) return { slot, empty: true };
    try {
      const d = JSON.parse(raw);
      return {
        slot, empty: false,
        savedAt: d.savedAt, money: d.economy?.money ?? 0,
        missions: d.missions?.completed?.length ?? 0,
        hours: d.world?.hours ?? 8,
        playtime: d.playtime || 0,
        version: d.version,
      };
    } catch (e) {
      return { slot, empty: false, corrupt: true };
    }
  });
}

export function writeSave(slot, data) {
  const payload = Object.assign({}, data, {
    version: SAVE_VERSION,
    savedAt: Date.now(),
  });
  try {
    store.setItem(slotKey(slot), JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

export function readSave(slot) {
  const raw = store.getItem(slotKey(slot));
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return migrate(d);
  } catch (e) {
    console.warn('Save in slot', slot, 'is unreadable:', e);
    return null;
  }
}

export function deleteSave(slot) { store.removeItem(slotKey(slot)); }

function migrate(d) {
  if (!d || typeof d !== 'object') return null;
  if (!d.version || d.version < 2) {
    d.economy = d.economy || { money: 500 };
    d.economy.ledger = d.economy.ledger || [];
  }
  if (d.version < 3) {
    d.economy.revision = d.economy.revision || 0;
  }
  d.version = SAVE_VERSION;
  return d;
}

export function storageAvailable() { return !store.unavailable; }
