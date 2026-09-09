/**
 * InteractionSystem — one reusable "look at a thing and press E" pipeline.
 *
 * Interactables are plain objects registered with the world; anything with
 * {x,y,z,radius,label,kind} participates. Selection prefers what the player is
 * actually looking at, not merely what is closest.
 */
import * as THREE from 'three';
import { Audio } from '../core/AudioManager.js';
import { ITEMS } from './ItemDatabase.js';

const REACH = 3.1;
const CORPSE_REACH = 2.6;

export class InteractionSystem {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.holdProgress = 0;
  }

  /** Find the best interactable in front of the player. */
  pick() {
    const cam = this.game.camera;
    const origin = cam.getWorldPosition(_o);
    const dir = cam.getWorldDirection(_d);
    let best = null, bestScore = -Infinity;

    const list = this.game.world.queryInteractables(origin, REACH + 1.5);
    for (const it of list) {
      const dx = it.x - origin.x, dy = it.y - origin.y, dz = it.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = Math.min(REACH, it.radius || REACH);
      if (dist > reach + 0.6) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(0.001, dist);
      if (dot < 0.55) continue;
      const score = dot * 2.2 - dist * 0.25;
      if (score > bestScore) { bestScore = score; best = it; }
    }

    // corpses are dynamic, so they are tested separately
    const corpse = this.game.entities.nearestCorpse(this.game.player.position, CORPSE_REACH);
    if (corpse) {
      const dx = corpse.position.x - origin.x, dy = corpse.position.y + 0.4 - origin.y, dz = corpse.position.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(0.001, dist);
      if (dot > 0.45) {
        const score = dot * 2.2 - dist * 0.25 + 0.2;
        if (score > bestScore) best = { kind: 'corpse', entity: corpse, label: `Search ${corpse.displayName()}`, x: corpse.position.x, y: corpse.position.y, z: corpse.position.z };
      }
    }

    // A downed teammate outranks anything else within reach. Nothing on the
    // ground is more urgent than the person bleeding out on it.
    const net = this.game.net;
    if (net && net.online) {
      for (const mate of net.players.values()) {
        if (!mate.down) continue;
        const g = mate.group.position;
        const dx = g.x - origin.x, dy = g.y + 0.5 - origin.y, dz = g.z - origin.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 3.2) continue;
        const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(0.001, dist);
        if (dot < 0.2) continue;
        best = {
          kind: 'revive', mateId: mate.id, label: `Get ${mate.name} back up`,
          x: g.x, y: g.y, z: g.z,
        };
        bestScore = Infinity;
        break;
      }
    }

    return best;
  }

  update(dt, allowInput) {
    this.current = allowInput ? this.pick() : null;
    if (this.current) this.game.ui.showPrompt(this.current.label);
    else this.game.ui.hidePrompt();
  }

  activate() {
    const it = this.current;
    if (!it) return false;
    const G = this.game;
    // Interactables may carry their own behaviour; the switch below is the
    // table of the ones the loot and world systems own.
    if (typeof it.activate === 'function') return it.activate();
    switch (it.kind) {
      case 'revive':
        G.net.revive(it.mateId, 40);
        G.ui.toast('Picking them up…', 'good');
        Audio.heal();
        return true;
      case 'pickup': return G.loot.takePickup(it);
      case 'forage': return G.loot.harvest(it);
      case 'container': return G.loot.openContainer(it);
      case 'corpse': return G.loot.lootCorpse(it.entity, G.rng, G.difficulty.lootMul);
      case 'note': {
        const note = G.world.notes[it.noteId];
        if (note) { G.ui.showNote(note); G.world.markNoteRead(it.noteId); }
        Audio.uiClick();
        return true;
      }
      case 'campfire': {
        if (it.searched) { G.ui.toast('Nothing but cold ash', 'warn'); return false; }
        it.searched = true;
        const items = ['cloth', 'jerky', 'battery'];
        const id = items[Math.floor(Math.random() * items.length)];
        G.inventory.add(id, 1);
        G.ui.toast(`${ITEMS[id].name} — buried in the ashes`, 'good');
        Audio.pickup();
        return true;
      }
      case 'radio': {
        G.world.useRadio(it);
        return true;
      }
      case 'map': {
        G.world.revealLandmarks(180);
        G.ui.toast('District map studied — nearby landmarks marked', 'good');
        G.ui.subtitle('Someone has circled three places on this map. Two of the circles have been crossed out.');
        Audio.uiClick();
        return true;
      }
      case 'water': {
        if (G.stats.thirst > 96) { G.ui.toast('You are not thirsty', 'warn'); return false; }
        G.startUse({ useTime: 2.6, label: 'Drinking', onComplete: () => {
          G.stats.thirst = Math.min(100, G.stats.thirst + 42);
          if (Math.random() < 0.28) { G.stats.poison = Math.min(3, G.stats.poison + 1); G.ui.toast('The water tastes wrong', 'bad'); }
          else G.ui.toast('Water — cold and clean enough', 'good');
          Audio.drink();
        } });
        return true;
      }
      default: return false;
    }
  }
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
