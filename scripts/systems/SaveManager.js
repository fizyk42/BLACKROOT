/**
 * SaveManager — a single local save slot in localStorage.
 *
 * The world is regenerated from its seed rather than serialised, so a save is
 * only the mutable state: where you are, what you carry, what you have already
 * taken, read and discovered.
 */

import { ensureForgedIn } from './WeaponForge.js';

const KEY = 'blackroot.save.v1';

export class SaveManager {
  constructor(game) { this.game = game; }

  hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  meta() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return { seed: d.seed, time: d.savedAt, alive: d.stats?.timeAlive || 0 };
    } catch (e) { return null; }
  }

  save() {
    const G = this.game;
    const data = {
      version: 1,
      savedAt: Date.now(),
      seed: G.seed,
      biome: G.biomeId,
      depth: G.depth || 0,
      route: G.route,
      riftOpen: !!G.riftOpen,
      difficulty: G.settings.get('difficulty'),
      player: G.player.serialize(),
      stats: G.stats.serialize(),
      inventory: G.inventory.serialize(),
      weapons: G.weapons.serialize(),
      armoury: G.armoury.serialize(),
      flashlight: G.flashlight.serialize(),
      takenPickups: G.loot.pickups.map((p) => (p.taken ? 1 : 0)),
      extraPickups: G.loot.pickups.filter((p) => p.spawned && !p.taken).map((p) => ({ id: p.id, q: p.qty, x: p.x, y: p.baseY, z: p.z })),
      forage: G.loot.forage.map((f) => f.harvests),
      containers: G.loot.containers.map((c) => (c.opened ? 1 : 0)),
      notesRead: Object.keys(G.world.notes).filter((k) => G.world.notes[k].read),
      landmarks: G.world.landmarks.map((l) => (l.discovered ? 1 : 0)),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('save failed', e);
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  /** Restore mutable state onto a freshly generated world with the same seed. */
  apply(data) {
    const G = this.game;
    // Forged weapons are regenerated from their ids before anything refers to them.
    ensureForgedIn(data);
    G.armoury.deserialize(data.armoury);
    G.player.deserialize(data.player);
    G.stats.deserialize(data.stats);
    G.inventory.deserialize(data.inventory);
    G.weapons.deserialize(data.weapons);
    G.flashlight.deserialize(data.flashlight);

    const taken = data.takenPickups || [];
    G.loot.pickups.forEach((p, i) => {
      if (taken[i]) { p.taken = true; p.mesh.visible = false; G.world.unregisterInteractable(p); }
    });
    (data.forage || []).forEach((h, i) => {
      const f = G.loot.forage[i];
      if (!f) return;
      f.harvests = h;
      if (h <= 0) G.world.unregisterInteractable(f);
    });
    (data.containers || []).forEach((o, i) => {
      const c = G.loot.containers[i];
      if (c && o) { c.opened = true; G.world.unregisterInteractable(c); }
    });
    for (const id of data.notesRead || []) if (G.world.notes[id]) G.world.notes[id].read = true;
    (data.landmarks || []).forEach((d, i) => { if (G.world.landmarks[i]) G.world.landmarks[i].discovered = !!d; });
    for (const p of data.extraPickups || []) G.loot.dropPickup(p.id, p.q, p.x, p.y, p.z);
    // A save taken after the boss fell keeps its rift, so loading never
    // strands the player in a biome whose only exit has been closed.
    if (data.riftOpen) G.restoreRift();
  }

  clear() { try { localStorage.removeItem(KEY); } catch (e) { /* noop */ } }
}
