/**
 * rooms — the authoritative half of BLACKROOT co-op.
 *
 * A room is a shared run: one world seed, one route through the biomes, one
 * set of players. The code on the front of it is what a player types in to
 * get into it, and it is the only thing they have to exchange.
 *
 * Authority model. This is a co-operative game against the world, not a
 * competitive one against each other, so the server does not simulate the
 * forest — it could not, without shipping the whole world generator twice.
 * What it *does* own is everything the players have to agree on:
 *
 *   · the run seed and the biome route  (so everyone walks the same road)
 *   · which biome the party is in, and how deep
 *   · the shared clock
 *   · boss health and phase, credited across everyone shooting it
 *   · who is down, and who revived them
 *
 * This file is plain `.js` rather than `.mjs` on purpose: it is imported by
 * the browser as well as by Node, and a static server whose MIME table does
 * not know `.mjs` serves it as a download instead of as a module — which shows
 * up as the entire game failing to boot, with nothing to point at.
 *
 * Player movement is client-authoritative because latency compensation for
 * eight-player co-op PvE is not worth the input lag; the server still rejects
 * physically impossible movement so one modified client cannot teleport
 * around the map, and everything that *matters* (damage on a boss, the rift,
 * progression) is arbitrated here.
 */

/** No 0/O/1/I/5/S: codes get read out loud over voice chat. */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
export const CODE_LEN = 6;

export const LIMITS = {
  players: 8,
  nameLen: 18,
  chatLen: 160,
  msgPerSecond: 90,        // generous: 12 Hz position + fire + events
  bytesPerSecond: 96 * 1024,
  speed: 42,               // m/s ceiling; a sprint is ~6, a rift jump teleports
  idleMs: 180000,          // a slow machine can be locked up this long building a world
  emptyRoomMs: 120000,     // a room with nobody in it is kept this long
};

export function makeCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}

export function normaliseCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

/** Trim, strip control characters, and never let a name be empty. */
export function cleanName(s, fallback = 'OPERATOR') {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.nameLen);
  return t || fallback;
}

let nextId = 1;

export class Player {
  constructor(conn, name, operator) {
    this.id = nextId++;
    this.conn = conn;
    this.name = cleanName(name);
    this.operator = sanitiseOperator(operator);
    this.room = null;
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.flags = 0;          // 1 crouch, 2 sprint, 4 aiming, 8 firing, 16 light
    this.health = 100;
    this.weapon = '';
    this.down = false;
    this.kills = 0;
    this.joinedAt = Date.now();
    this.lastSeen = Date.now();
    this.lastMove = 0;
    this._msgWindow = Date.now();
    this._msgCount = 0;
    this._bytes = 0;
    this.warnings = 0;
    this.missed = 0;          // consecutive heartbeats with no answer
  }

  /** Returns false when the client is talking too fast and should be dropped. */
  charge(bytes) {
    const now = Date.now();
    if (now - this._msgWindow >= 1000) { this._msgWindow = now; this._msgCount = 0; this._bytes = 0; }
    this._msgCount++;
    this._bytes += bytes;
    this.lastSeen = now;
    return this._msgCount <= LIMITS.msgPerSecond && this._bytes <= LIMITS.bytesPerSecond;
  }

  /** The compact form that goes in a snapshot: order matters, see NetClient. */
  packed() {
    return [this.id, r2(this.x), r2(this.y), r2(this.z),
      r2(this.yaw), r2(this.pitch), this.flags, Math.round(this.health)];
  }

  profile() {
    return { id: this.id, name: this.name, op: this.operator, w: this.weapon, down: this.down };
  }

  send(str) { try { this.conn.send(str); } catch { /* dropped; the close handler cleans up */ } }
}

export class Room {
  constructor(code, seed, route) {
    this.code = code;
    this.seed = seed >>> 0;
    this.route = route;
    this.depth = 0;
    this.biome = route[0];
    this.players = new Map();
    this.hostId = 0;
    this.createdAt = Date.now();
    this.emptyAt = 0;
    this.tick = 0;
    this.clock = 0;             // shared world time in seconds
    this.boss = null;           // { id, name, health, maxHealth, phase }
    this.riftOpen = false;
    this.chat = [];
  }

  get size() { return this.players.size; }
  get full() { return this.players.size >= LIMITS.players; }

  add(player) {
    player.room = this;
    this.players.set(player.id, player);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = player.id;
    this.emptyAt = 0;
  }

  remove(player) {
    this.players.delete(player.id);
    player.room = null;
    // The host leaving must not end the run for everyone else: the oldest
    // remaining player inherits it.
    if (this.hostId === player.id) {
      let oldest = null;
      for (const p of this.players.values()) if (!oldest || p.joinedAt < oldest.joinedAt) oldest = p;
      this.hostId = oldest ? oldest.id : 0;
      if (oldest) this.broadcast({ t: 'host', id: oldest.id });
    }
    if (!this.players.size) this.emptyAt = Date.now();
  }

  broadcast(obj, exceptId = 0) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.id !== exceptId) p.send(s);
  }

  snapshot() {
    const ps = [];
    for (const p of this.players.values()) ps.push(p.packed());
    return { t: 'snap', n: this.tick, ps };
  }

  /** Everything a joining client needs to be in the same run as everyone else. */
  world() {
    return {
      seed: this.seed, route: this.route, depth: this.depth, biome: this.biome,
      clock: Math.round(this.clock * 10) / 10, riftOpen: this.riftOpen, boss: this.boss,
    };
  }

  state() {
    return {
      code: this.code, players: this.size, max: LIMITS.players,
      biome: this.biome, depth: this.depth, age: Date.now() - this.createdAt,
    };
  }
}

export class Hub {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.maxRooms = opts.maxRooms ?? 500;
    this.routeFor = opts.routeFor || ((seed) => defaultRoute(seed));
    this.log = opts.log || (() => {});
  }

  get(code) { return this.rooms.get(normaliseCode(code)) || null; }

  /**
   * `route` is whatever the host's own biome shuffle produced. Taking it from
   * the host rather than recomputing it here means the server never has to
   * keep a copy of the client's shuffle in step — the fallback below only
   * runs when a client opens a room without declaring one.
   */
  create(seed, route) {
    if (this.rooms.size >= this.maxRooms) return null;
    let code = makeCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 64) code = makeCode();
    if (this.rooms.has(code)) return null;
    const s = (seed ?? (Math.random() * 0xffffffff)) >>> 0;
    const r = cleanRoute(route) || this.routeFor(s);
    const room = new Room(code, s, r);
    this.rooms.set(code, room);
    this.log(`room ${code} opened (seed ${s})`);
    return room;
  }

  /** Drop rooms that have been empty long enough that nobody is coming back. */
  sweep(now = Date.now()) {
    let closed = 0;
    for (const [code, room] of this.rooms) {
      if (room.size === 0 && room.emptyAt && now - room.emptyAt > LIMITS.emptyRoomMs) {
        this.rooms.delete(code);
        closed++;
        this.log(`room ${code} closed (empty)`);
      }
    }
    return closed;
  }

  list() {
    const out = [];
    for (const r of this.rooms.values()) out.push(r.state());
    return out;
  }
}

/* ================= validation ================= */

/**
 * Movement sanity, applied in place.
 *
 * Not anti-cheat in the competitive sense — this is co-op against the world —
 * but a client claiming to have crossed the map in one tick would drag every
 * other client's interpolation somewhere absurd, so the claim is capped.
 *
 * The important detail is that an over-long claim is *clamped rather than
 * ignored*. Holding the old position instead would leave the server's copy of
 * the player permanently behind the real one, every subsequent update would
 * look equally impossible, and a player who took one legitimate long step —
 * a lift, a fall, a lag spike, a debug teleport — would be kicked a few
 * seconds later for the crime of continuing to exist. Clamping converges: the
 * server catches up over a few ticks and the count only rises while the
 * claims keep being absurd.
 *
 * @returns true when the move was accepted as-is.
 */
export function acceptMove(player, x, y, z, now = Date.now()) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > 20000 || Math.abs(z) > 20000 || y < -2000 || y > 20000) return false;
  const last = player.lastMove;
  player.lastMove = now;
  // A rift transition legitimately moves a player any distance at all, so the
  // server hands out a free pass for the tick after it announces one.
  if (!last || player.warp) {
    player.warp = false;
    player.x = x; player.y = y; player.z = z;
    return true;
  }
  const dt = Math.min(2, (now - last) / 1000);
  const d = Math.hypot(x - player.x, y - player.y, z - player.z);
  const limit = LIMITS.speed * Math.max(dt, 1 / 30) + 3;
  if (d <= limit) { player.x = x; player.y = y; player.z = z; return true; }
  const k = limit / d;
  player.x += (x - player.x) * k;
  player.y += (y - player.y) * k;
  player.z += (z - player.z) * k;
  return false;
}

export function sanitiseOperator(op) {
  const pick = (v, max = 24) => (typeof v === 'string' ? v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max) : '');
  const o = op && typeof op === 'object' ? op : {};
  return {
    headgear: pick(o.headgear) || 'helmet',
    face: pick(o.face) || 'shemagh',
    torso: pick(o.torso) || 'carrier',
    legs: pick(o.legs) || 'combat',
    skin: pick(o.skin) || 'tan',
    colour: pick(o.colour) || 'olive',
  };
}

/** A route is a list of known biome ids, starting in the Hollow. */
export function cleanRoute(route) {
  if (!Array.isArray(route) || route.length < 1 || route.length > 12) return null;
  const out = [];
  for (const id of route) {
    if (typeof id !== 'string') return null;
    const t = id.replace(/[^a-z]/g, '').slice(0, 16);
    if (!BIOME_ROUTE.includes(t) && t !== 'sandbox') return null;
    if (out.includes(t)) return null;
    out.push(t);
  }
  return out.length ? out : null;
}

export function num(v, def, lo, hi) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return def;
  return n < lo ? lo : n > hi ? hi : n;
}

function r2(v) { return Math.round(v * 100) / 100; }

/**
 * The same shuffle the client uses, kept here so the server can hand a route
 * to a player who joins before the host has generated anything. It is
 * duplicated rather than imported because the client module pulls in three.js
 * through its neighbours, and the server must stay dependency-free.
 */
export const BIOME_ROUTE = ['hollow', 'void', 'abyss', 'cinder', 'permafrost', 'bloom'];

export function defaultRoute(seed) {
  const rest = BIOME_ROUTE.slice(1);
  let s = (seed ^ 0x6d2b79f5) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return ['hollow', ...rest];
}
