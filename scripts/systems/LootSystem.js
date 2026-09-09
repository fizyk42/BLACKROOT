/**
 * LootSystem — world pickups, foraging nodes, containers and corpse looting.
 *
 * Placement is deliberate rather than uniform: food grows where the ground is
 * damp and near camps, weapons and ammunition sit at the places people died,
 * and the best gear is in the worst neighbourhoods.
 */
import * as THREE from 'three';
import { ITEMS, rollLoot } from './ItemDatabase.js';
import { PLAYABLE_RADIUS, WORLD_HALF } from '../world/Terrain.js';
import { Audio } from '../core/AudioManager.js';

const PICKUP_VIEW = 78;

/* ---- shared pickup geometry ---- */
function makeGeoms() {
  return {
    ammo: new THREE.BoxGeometry(0.20, 0.11, 0.13),
    med: new THREE.BoxGeometry(0.22, 0.14, 0.16),
    food: new THREE.IcosahedronGeometry(0.09, 0),
    supply: new THREE.BoxGeometry(0.14, 0.14, 0.14),
    gun: new THREE.BoxGeometry(0.34, 0.09, 0.10),
    key: new THREE.OctahedronGeometry(0.08, 0),
    berry: new THREE.IcosahedronGeometry(0.045, 0),
  };
}

function makeMats() {
  return {
    ammo: new THREE.MeshStandardMaterial({ color: 0x6b6250, roughness: 0.8, metalness: 0.2 }),
    med: new THREE.MeshStandardMaterial({ color: 0xa8b0b4, roughness: 0.7, metalness: 0.05, emissive: 0x220505, emissiveIntensity: 0.6 }),
    food: new THREE.MeshStandardMaterial({ color: 0x7c5a2e, roughness: 0.9 }),
    supply: new THREE.MeshStandardMaterial({ color: 0x54595c, roughness: 0.75, metalness: 0.35 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x2c2e32, roughness: 0.45, metalness: 0.8 }),
    key: new THREE.MeshStandardMaterial({ color: 0xc8a44e, roughness: 0.35, metalness: 0.9, emissive: 0x3a2a06, emissiveIntensity: 0.8 }),
    bushLeaf: new THREE.MeshStandardMaterial({ color: 0x33452a, roughness: 1, flatShading: true }),
    berryRed: new THREE.MeshStandardMaterial({ color: 0x6d1420, roughness: 0.55, emissive: 0x2a0206, emissiveIntensity: 0.8 }),
    mushroom: new THREE.MeshStandardMaterial({ color: 0xbfb4a0, roughness: 0.9, emissive: 0x14120c, emissiveIntensity: 0.6 }),
    herb: new THREE.MeshStandardMaterial({ color: 0x4d6b3a, roughness: 1 }),
    fruit: new THREE.MeshStandardMaterial({ color: 0x7a2c1e, roughness: 0.7 }),
  };
}

export class LootSystem {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'loot';
    this.geoms = makeGeoms();
    this.mats = makeMats();
    this.pickups = [];      // {mesh, item, qty, x,y,z, taken}
    this.forage = [];
    this.containers = [];
    this._bob = 0;
  }

  attach(scene) { scene.add(this.group); }

  /**
   * Loot never moves once it is scattered, and there are thousands of pieces
   * of it. Telling three.js so turns thousands of matrix recompositions per
   * frame into none — the visuals are already distance-culled, but an
   * invisible object still gets its world matrix rebuilt every frame unless
   * it is marked static.
   */
  freezeScatter() {
    this.group.updateMatrixWorld(true);
    this.group.traverse((o) => {
      if (o === this.group) return;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  /* ---------------- creation ---------------- */

  categoryOf(id) {
    const it = ITEMS[id];
    if (!it) return 'supply';
    if (it.cat === 'ammo') return 'ammo';
    if (it.cat === 'medical') return 'med';
    if (it.cat === 'food') return 'food';
    if (it.cat === 'weapon') return it.kind === 'gun' ? 'gun' : 'gun';
    if (it.cat === 'key') return 'key';
    return 'supply';
  }

  dropPickup(id, qty, x, y, z, rot = Math.random() * 6.28) {
    const cat = this.categoryOf(id);
    const mesh = new THREE.Mesh(this.geoms[cat], this.mats[cat]);
    mesh.position.set(x, y + 0.06, z);
    mesh.rotation.set(0, rot, cat === 'gun' ? 0.06 : 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const p = {
      kind: 'pickup', mesh, id, qty,
      x, y: y + 0.06, z, radius: 1.9,
      label: `Pick Up ${ITEMS[id].name}${qty > 1 ? ' ×' + qty : ''}`,
      taken: false, baseY: y + 0.06, phase: Math.random() * 6.28,
    };
    this.pickups.push(p);
    this.game.world.registerInteractable(p);
    return p;
  }

  /** Scatter loot for one landmark's authored spots plus its container rolls. */
  populateLandmark(lm, spots, interactables, rng, lootMul) {
    for (const s of spots) {
      const items = rollLoot(lm.lootTheme, rng, s.tier, lootMul);
      let off = 0;
      for (const it of items) {
        this.dropPickup(it.id, it.qty, s.x + Math.cos(off) * 0.28, s.y, s.z + Math.sin(off) * 0.28);
        off += 1.9;
      }
    }
    for (const inter of interactables) {
      if (inter.kind === 'container') {
        inter.opened = false;
        inter.rng = rng;
        inter.lootMul = lootMul;
        this.containers.push(inter);
      }
      this.game.world.registerInteractable(inter);
    }
  }

  /** Corpses of the people who did not make it: a body, a rifle, a story. */
  scatterBodies(rng, terrain, count, lootMul) {
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2, r = 50 + rng() * (PLAYABLE_RADIUS - 70);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (terrain.isWater(x, z) || terrain.slopeAt(x, z) > 0.4) { i--; continue; }
      const y = terrain.heightAt(x, z);
      // a rough shape suggesting remains, plus its loot
      const g = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.9), this.mats.supply);
      torso.material = new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 1 });
      torso.position.y = 0.12;
      torso.rotation.y = rng() * 3.14;
      torso.castShadow = true;
      g.add(torso);
      g.position.set(x, y, z);
      this.group.add(g);
      const items = rollLoot('body', rng, 2, lootMul);
      let off = 0;
      for (const it of items) {
        this.dropPickup(it.id, it.qty, x + Math.cos(off) * 0.5, y, z + Math.sin(off) * 0.5);
        off += 1.6;
      }
    }
  }

  /** Edible plants: berries, mushrooms, herbs, nut trees and creek-bank roots. */
  scatterForage(rng, terrain, count) {
    const T = terrain;
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 12) {
      const x = rng.range(-WORLD_HALF + 20, WORLD_HALF - 20);
      const z = rng.range(-WORLD_HALF + 20, WORLD_HALF - 20);
      if (Math.hypot(x, z) > PLAYABLE_RADIUS - 8) continue;
      if (T.isWater(x, z) || T.slopeAt(x, z) > 0.42) continue;
      const m = T.moistureAt(x, z);
      const nearCreek = Math.abs(x - T.creekX(z)) < 26;

      let kind;
      if (nearCreek && rng() < 0.42) kind = 'root';
      else if (m > 0.62) kind = rng.weighted([['berries', 5], ['mushroom', 4], ['herb', 3]]);
      else if (m < 0.38) kind = rng.weighted([['nuts', 5], ['berries', 2], ['herb', 2]]);
      else kind = rng.weighted([['berries', 4], ['apple', 3], ['nuts', 3], ['mushroom', 2], ['herb', 2]]);
      if (rng() > 0.25 + m * 0.9) continue;

      const y = T.heightAt(x, z);
      const node = this.buildForageNode(kind, x, y, z, rng);
      this.forage.push(node);
      this.game.world.registerInteractable(node);
      placed++;
    }
  }

  buildForageNode(kind, x, y, z, rng) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    let label, harvests = 1 + Math.floor(rng() * 3);

    if (kind === 'berries') {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), this.mats.bushLeaf);
      bush.scale.set(1.2, 0.85, 1.2);
      bush.position.y = 0.34; bush.castShadow = true;
      g.add(bush);
      for (let i = 0; i < 9; i++) {
        const berry = new THREE.Mesh(this.geoms.berry, this.mats.berryRed);
        const a = rng() * 6.28, r = 0.2 + rng() * 0.28;
        berry.position.set(Math.cos(a) * r, 0.28 + rng() * 0.3, Math.sin(a) * r);
        g.add(berry);
      }
      label = 'Pick Berries';
    } else if (kind === 'mushroom') {
      for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 5, 0, 6.28, 0, Math.PI / 2), this.mats.mushroom);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.10, 5), this.mats.mushroom);
        const a = rng() * 6.28, r = rng() * 0.34;
        cap.position.set(Math.cos(a) * r, 0.10, Math.sin(a) * r);
        stem.position.set(cap.position.x, 0.05, cap.position.z);
        cap.castShadow = true;
        g.add(cap, stem);
      }
      label = 'Gather Mushrooms';
      harvests = 1 + Math.floor(rng() * 2);
    } else if (kind === 'herb') {
      for (let i = 0; i < 7; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.30, 0.012), this.mats.herb);
        const a = rng() * 6.28;
        blade.position.set(Math.cos(a) * rng() * 0.12, 0.15, Math.sin(a) * rng() * 0.12);
        blade.rotation.set(rng.range(-0.3, 0.3), a, rng.range(-0.3, 0.3));
        g.add(blade);
      }
      label = 'Cut Bitterleaf';
    } else if (kind === 'apple') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 2.1, 6), this.mats.food);
      trunk.position.y = 1.05; trunk.castShadow = true;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 0), this.mats.bushLeaf);
      crown.position.y = 2.3; crown.scale.set(1.1, 0.8, 1.1); crown.castShadow = true;
      g.add(trunk, crown);
      for (let i = 0; i < 5; i++) {
        const fruit = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), this.mats.fruit);
        const a = rng() * 6.28, r = 0.5 + rng() * 0.45;
        fruit.position.set(Math.cos(a) * r, 2.0 + rng() * 0.5, Math.sin(a) * r);
        g.add(fruit);
      }
      label = 'Collect Apples';
      harvests = 2 + Math.floor(rng() * 3);
    } else if (kind === 'nuts') {
      const pile = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), this.mats.food);
      pile.scale.set(1.4, 0.4, 1.4); pile.position.y = 0.09;
      g.add(pile);
      for (let i = 0; i < 6; i++) {
        const n = new THREE.Mesh(this.geoms.berry, this.mats.food);
        n.position.set(rng.range(-0.3, 0.3), 0.05, rng.range(-0.3, 0.3));
        g.add(n);
      }
      label = 'Gather Beech Nuts';
    } else { // root
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), this.mats.herb);
      leaf.scale.set(1.3, 0.35, 1.3); leaf.position.y = 0.10;
      g.add(leaf);
      label = 'Dig Edible Root';
      harvests = 1 + Math.floor(rng() * 2);
    }

    g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    this.group.add(g);
    return {
      kind: 'forage', group: g, item: kind, harvests,
      x, y: y + 0.4, z, radius: 2.1, label, phase: Math.random() * 6.28,
    };
  }

  /* ---------------- interaction results ---------------- */

  takePickup(p) {
    if (p.taken) return false;
    const added = this.game.inventory.add(p.id, p.qty);
    if (added <= 0) {
      this.game.ui.toast('You cannot carry any more weight', 'bad');
      Audio.denied();
      return false;
    }
    if (added < p.qty) {
      p.qty -= added;
      p.label = `Pick Up ${ITEMS[p.id].name}${p.qty > 1 ? ' ×' + p.qty : ''}`;
      this.game.ui.toast(`${ITEMS[p.id].name} ×${added} (pack full)`, 'warn');
    } else {
      p.taken = true;
      p.mesh.visible = false;
      this.game.world.unregisterInteractable(p);
      this.game.ui.toast(`${ITEMS[p.id].name}${p.qty > 1 ? ' ×' + p.qty : ''}`, 'good');
    }
    this.game.stats.itemsLooted += added;
    Audio.pickup();
    return true;
  }

  harvest(node) {
    const added = this.game.inventory.add(node.item, 1 + Math.floor(Math.random() * 2));
    if (added <= 0) { this.game.ui.toast('You cannot carry any more weight', 'bad'); Audio.denied(); return false; }
    node.harvests--;
    this.game.stats.itemsLooted += added;
    Audio.pickup();
    this.game.ui.toast(`${ITEMS[node.item].name} ×${added}`, 'good');
    this.game.player.emitNoise(0.08);
    if (node.harvests <= 0) {
      this.game.world.unregisterInteractable(node);
      // strip the visible fruit/berries but leave the plant standing
      const kids = node.group.children.slice(1);
      for (const k of kids) if (k.geometry === this.geoms.berry || k.material === this.mats.fruit) k.visible = false;
      node.depleted = true;
    }
    return true;
  }

  openContainer(c) {
    if (c.opened) { this.game.ui.toast('Already searched', 'warn'); return false; }
    c.opened = true;
    const items = rollLoot(c.table, c.rng || Math.random, c.tier || 2, c.lootMul || 1);
    let n = 0, off = Math.random() * 6.28;
    for (const it of items) {
      this.dropPickup(it.id, it.qty, c.x + Math.cos(off) * 0.55, c.y - 0.5, c.z + Math.sin(off) * 0.55);
      off += 1.7; n++;
    }
    Audio.reloadStep('magOut', c);
    this.game.ui.toast(n ? `Searched — ${n} thing${n > 1 ? 's' : ''} worth taking` : 'Searched — nothing left', n ? 'good' : 'warn');
    this.game.world.unregisterInteractable(c);
    this.game.player.emitNoise(0.3);
    return true;
  }

  lootCorpse(entity, rng, lootMul) {
    if (entity.looted) return false;
    entity.looted = true;
    const table = entity.faction === 'mutant' ? 'nest' : 'forage';
    const items = entity.faction === 'mutant'
      ? rollLoot('nest', rng, 1, lootMul * 0.5)
      : [{ id: 'jerky', qty: 1 + Math.floor(rng() * 2) }];
    let n = 0, off = rng() * 6.28;
    for (const it of items) {
      this.dropPickup(it.id, it.qty, entity.position.x + Math.cos(off) * 0.4, entity.position.y, entity.position.z + Math.sin(off) * 0.4);
      off += 1.6; n++;
    }
    this.game.ui.toast(n ? 'Searched the body' : 'Nothing usable', n ? 'good' : 'warn');
    Audio.pickup();
    return true;
  }

  /* ---------------- per-frame ---------------- */

  update(dt, camPos) {
    this._bob += dt;
    const far2 = PICKUP_VIEW * PICKUP_VIEW;
    for (const p of this.pickups) {
      if (p.taken) continue;
      const dx = p.x - camPos.x, dz = p.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      const vis = d2 < far2;
      p.mesh.visible = vis;
      if (vis && d2 < 900) {
        p.mesh.position.y = p.baseY + Math.sin(this._bob * 1.6 + p.phase) * 0.022;
        p.mesh.rotation.y += dt * 0.45;
        // Frozen at scatter time; a visible pickup is the exception that has
        // to recompose its own matrix, and only while it is on screen.
        p.mesh.updateMatrix();
      }
    }
    for (const f of this.forage) {
      const dx = f.x - camPos.x, dz = f.z - camPos.z;
      f.group.visible = dx * dx + dz * dz < far2 * 1.4;
    }
  }

  serialize() {
    return {
      pickups: this.pickups.filter((p) => !p.taken).map((p) => ({ id: p.id, q: p.qty, x: p.x, y: p.y - 0.06, z: p.z })),
      forage: this.forage.map((f) => f.harvests),
      containers: this.containers.map((c) => (c.opened ? 1 : 0)),
    };
  }
}
