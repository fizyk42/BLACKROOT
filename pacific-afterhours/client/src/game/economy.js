// Money, ownership and passive income. Deliberately free of rendering imports so
// tools/verify.js can exercise the anti-duplication rules in plain Node.

export const BUSINESSES = [
  { id: 'diner', name: 'The Afterhours Diner', poi: 'diner', price: 85000, incomePerHour: 620, upkeepPerHour: 180 },
  { id: 'tuner', name: "Park's Performance", poi: 'tuner', price: 140000, incomePerHour: 1150, upkeepPerHour: 420 },
  { id: 'depot', name: 'Kestrel Freight Depot', poi: 'depot', price: 210000, incomePerHour: 1900, upkeepPerHour: 760 },
  { id: 'racehub', name: 'The Pier Lot', poi: 'racehub', price: 62000, incomePerHour: 430, upkeepPerHour: 90 },
];

export const PROPERTIES = [
  { id: 'apartment_1', name: 'Linnet Street Studio', price: 0, garageSlots: 2 },
  { id: 'apartment_2', name: 'Marisol Loft', price: 42000, garageSlots: 4 },
  { id: 'house_hills', name: 'Ridge Line House', price: 185000, garageSlots: 8 },
];

export class Economy {
  constructor(opts = {}) {
    this.money = opts.money ?? 500;
    this.revision = opts.revision ?? 0;
    /** Every id that has ever paid out for this profile. */
    this.ledger = new Set(opts.ledger || []);
    this.properties = new Set(opts.properties || ['apartment_1']);
    this.businesses = new Map(Object.entries(opts.businesses || {}));
    this.vehicles = new Map();          // id -> serialised vehicle
    this.stats = Object.assign({ earned: 0, spent: 0, jobs: 0, fines: 0 }, opts.stats);
    this.listeners = [];
    this.lastIncomeHour = opts.lastIncomeHour ?? 0;
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit(evt) { for (const f of this.listeners) f(evt); }

  // ---------------------------------------------------------------- money
  /**
   * Bank a reward. `id` must be globally unique for the thing being rewarded
   * (mission_late_delivery, job_delivery_1723_4, collectible_reel_7 ...).
   * Returns {ok, reason} — a repeat claim is rejected, which is what stops
   * save-scumming and reconnect exploits from minting money.
   */
  claim(id, amount, meta = {}) {
    if (!id) return { ok: false, reason: 'missing-id' };
    if (this.ledger.has(id)) return { ok: false, reason: 'already-claimed' };
    this.ledger.add(id);
    this.revision++;
    this.money += amount;
    this.stats.earned += Math.max(0, amount);
    this.emit({ type: 'claim', id, amount, meta });
    return { ok: true, amount, money: this.money };
  }

  hasClaimed(id) { return this.ledger.has(id); }

  /** Unconditional credit for things that are not one-off rewards (selling a car). */
  credit(amount, reason = '') {
    this.money += amount;
    this.revision++;
    this.stats.earned += Math.max(0, amount);
    this.emit({ type: 'credit', amount, reason });
    return this.money;
  }

  canAfford(amount) { return this.money >= amount; }

  spend(amount, reason = '') {
    if (amount > this.money) return { ok: false, reason: 'insufficient' };
    this.money -= amount;
    this.revision++;
    this.stats.spent += amount;
    this.emit({ type: 'spend', amount, reason });
    return { ok: true, money: this.money };
  }

  fine(amount, reason = 'police') {
    const take = Math.min(this.money, amount);
    this.money -= take;
    this.revision++;
    this.stats.fines += take;
    this.emit({ type: 'fine', amount: take, reason });
    return take;
  }

  // ---------------------------------------------------------------- vehicles
  /** Adding a vehicle is idempotent: the same vehicle id can never be granted twice. */
  addVehicle(data) {
    if (!data || !data.id) return { ok: false, reason: 'missing-id' };
    if (this.vehicles.has(data.id)) return { ok: false, reason: 'already-owned' };
    this.vehicles.set(data.id, Object.assign({}, data, { owned: true }));
    this.revision++;
    this.emit({ type: 'vehicle-added', id: data.id });
    return { ok: true };
  }

  removeVehicle(id) {
    const had = this.vehicles.delete(id);
    if (had) this.revision++;
    return had;
  }

  updateVehicle(data) {
    if (!data || !this.vehicles.has(data.id)) return false;
    this.vehicles.set(data.id, Object.assign({}, this.vehicles.get(data.id), data, { owned: true }));
    return true;
  }

  ownsVehicle(id) { return this.vehicles.has(id); }
  get vehicleList() { return [...this.vehicles.values()]; }

  garageCapacity() {
    let n = 0;
    for (const p of this.properties) {
      const def = PROPERTIES.find((x) => x.id === p);
      if (def) n += def.garageSlots;
    }
    return n;
  }

  // ---------------------------------------------------------------- property
  buyProperty(id) {
    const def = PROPERTIES.find((p) => p.id === id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (this.properties.has(id)) return { ok: false, reason: 'already-owned' };
    const r = this.spend(def.price, 'property:' + id);
    if (!r.ok) return r;
    this.properties.add(id);
    this.emit({ type: 'property', id });
    return { ok: true };
  }

  buyBusiness(id) {
    const def = BUSINESSES.find((b) => b.id === id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (this.businesses.has(id)) return { ok: false, reason: 'already-owned' };
    const r = this.spend(def.price, 'business:' + id);
    if (!r.ok) return r;
    this.businesses.set(id, { boughtAt: Date.now(), accrued: 0 });
    this.emit({ type: 'business', id });
    return { ok: true };
  }

  /**
   * Passive income ticks with in-game time. Income accrues at the business and must
   * be collected in person, so it is not free money for idling on the menu.
   */
  tickBusinesses(gameHoursElapsed) {
    if (gameHoursElapsed <= 0) return;
    for (const [id, state] of this.businesses) {
      const def = BUSINESSES.find((b) => b.id === id);
      if (!def) continue;
      const net = (def.incomePerHour - def.upkeepPerHour) * gameHoursElapsed;
      state.accrued = Math.max(0, (state.accrued || 0) + net);
    }
  }

  collectBusiness(id) {
    const state = this.businesses.get(id);
    if (!state) return { ok: false, reason: 'not-owned' };
    const amount = Math.floor(state.accrued || 0);
    if (amount < 1) return { ok: false, reason: 'nothing-to-collect' };
    state.accrued -= amount;
    this.credit(amount, 'business:' + id);
    return { ok: true, amount };
  }

  totalAccrued() {
    let n = 0;
    for (const s of this.businesses.values()) n += s.accrued || 0;
    return n;
  }

  // ---------------------------------------------------------------- persistence
  serialise() {
    return {
      money: Math.round(this.money),
      revision: this.revision,
      ledger: [...this.ledger],
      properties: [...this.properties],
      businesses: Object.fromEntries(this.businesses),
      vehicles: this.vehicleList,
      stats: this.stats,
      lastIncomeHour: this.lastIncomeHour,
    };
  }

  static deserialise(d) {
    const e = new Economy(d || {});
    if (d && Array.isArray(d.vehicles)) {
      for (const v of d.vehicles) e.vehicles.set(v.id, v);
    }
    return e;
  }

  /**
   * Merge an authoritative server snapshot into this wallet. Used when playing
   * online: the server owns the numbers, the client only mirrors them.
   */
  applyAuthoritative(snapshot) {
    if (!snapshot) return;
    this.money = snapshot.money;
    this.revision = snapshot.revision ?? this.revision;
    if (Array.isArray(snapshot.ledger)) this.ledger = new Set(snapshot.ledger);
    this.emit({ type: 'sync', money: this.money });
  }
}
