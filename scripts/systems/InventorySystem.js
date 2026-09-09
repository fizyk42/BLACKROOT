/**
 * InventorySystem — stacked slot inventory with a weight budget and five
 * quick slots. Emits change events the HUD and inventory screen listen to.
 */
import { ITEMS, getItem } from './ItemDatabase.js';

export const MAX_SLOTS = 30;
export const BASE_CARRY = 35; // kg

export class Inventory {
  constructor() {
    this.slots = [];                 // {id, qty}
    this.quick = [null, null, null, null, null];
    this.equipped = null;            // item id of held weapon (or null = unarmed)
    this._subs = [];
  }

  onChange(fn) { this._subs.push(fn); return () => { const i = this._subs.indexOf(fn); if (i >= 0) this._subs.splice(i, 1); }; }
  _emit() { for (const f of this._subs) f(this); }

  get weight() {
    let w = 0;
    for (const s of this.slots) { const it = ITEMS[s.id]; if (it) w += it.weight * s.qty; }
    return w;
  }
  get maxWeight() { return BASE_CARRY; }
  get overloaded() { return this.weight > this.maxWeight; }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s.id === id) n += s.qty;
    return n;
  }

  has(id, qty = 1) { return this.count(id) >= qty; }

  /** Returns the number actually added (may be less if weight-limited). */
  add(id, qty = 1) {
    const item = getItem(id);
    if (!item) return 0;
    let remaining = qty, added = 0;
    // top up existing stacks
    if (item.stack > 1) {
      for (const s of this.slots) {
        if (s.id !== id || s.qty >= item.stack) continue;
        const room = item.stack - s.qty;
        const take = Math.min(room, remaining);
        if (this.weight + item.weight * take > this.maxWeight + 0.001 && added > 0) break;
        s.qty += take; remaining -= take; added += take;
        if (remaining <= 0) break;
      }
    }
    // new stacks
    while (remaining > 0 && this.slots.length < MAX_SLOTS) {
      const take = Math.min(item.stack, remaining);
      if (this.weight + item.weight * take > this.maxWeight + 0.001 && added > 0) break;
      this.slots.push({ id, qty: take });
      remaining -= take; added += take;
    }
    if (added > 0) {
      this._autoQuick(id);
      if (!this.equipped && item.cat === 'weapon') this.equipped = id;
      this._emit();
    }
    return added;
  }

  remove(id, qty = 1) {
    let remaining = qty, removed = 0;
    for (let i = this.slots.length - 1; i >= 0 && remaining > 0; i--) {
      const s = this.slots[i];
      if (s.id !== id) continue;
      const take = Math.min(s.qty, remaining);
      s.qty -= take; remaining -= take; removed += take;
      if (s.qty <= 0) this.slots.splice(i, 1);
    }
    if (removed > 0) {
      if (!this.has(id)) {
        for (let i = 0; i < 5; i++) if (this.quick[i] === id) this.quick[i] = null;
        if (this.equipped === id) this.equipped = this._firstWeapon();
      }
      this._emit();
    }
    return removed;
  }

  _firstWeapon() {
    for (const s of this.slots) { const it = ITEMS[s.id]; if (it && it.cat === 'weapon') return s.id; }
    return null;
  }

  /** Newly-found weapons and healing items claim a free quick slot. */
  _autoQuick(id) {
    if (this.quick.includes(id)) return;
    const it = ITEMS[id];
    if (!it) return;
    const wants = it.cat === 'weapon' || it.cat === 'medical' || it.cat === 'food';
    if (!wants) return;
    // weapons prefer 1..3, consumables 4..5
    const order = it.cat === 'weapon' ? [0, 1, 2, 3, 4] : [3, 4, 2, 1, 0];
    for (const i of order) if (!this.quick[i]) { this.quick[i] = id; return; }
  }

  assignQuick(index, id) {
    if (index < 0 || index > 4) return;
    for (let i = 0; i < 5; i++) if (this.quick[i] === id) this.quick[i] = null;
    this.quick[index] = id;
    this._emit();
  }

  equip(id) {
    const it = getItem(id);
    if (!it || it.cat !== 'weapon' || !this.has(id)) return false;
    this.equipped = id;
    this._emit();
    return true;
  }

  unequip() { this.equipped = null; this._emit(); }

  /** Cycle held weapon by mouse wheel. */
  cycleWeapon(dir) {
    const list = this.slots.filter((s) => ITEMS[s.id]?.cat === 'weapon').map((s) => s.id);
    if (!list.length) return null;
    let i = list.indexOf(this.equipped);
    i = (i + (dir > 0 ? 1 : -1) + list.length) % list.length;
    this.equipped = list[i];
    this._emit();
    return this.equipped;
  }

  weapons() { return this.slots.filter((s) => ITEMS[s.id]?.cat === 'weapon').map((s) => s.id); }

  serialize() { return { slots: this.slots.map((s) => ({ ...s })), quick: [...this.quick], equipped: this.equipped }; }
  deserialize(d) {
    if (!d) return;
    this.slots = (d.slots || []).filter((s) => ITEMS[s.id]).map((s) => ({ ...s }));
    this.quick = (d.quick || [null, null, null, null, null]).slice(0, 5);
    while (this.quick.length < 5) this.quick.push(null);
    this.equipped = d.equipped && ITEMS[d.equipped] ? d.equipped : null;
    this._emit();
  }

  clear() { this.slots = []; this.quick = [null, null, null, null, null]; this.equipped = null; this._emit(); }
}
