/**
 * rooms — the authoritative half of BLACKROOT co-op / public online.
 */

/** No 0/O/1/I/5/S: codes get read out loud over voice chat. */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
export const CODE_LEN = 6;

export const LIMITS = {
  players: 8,
  nameLen: 18,
  chatLen: 160,
  msgPerSecond: 90,
  bytesPerSecond: 96 * 1024,
  speed: 42,
  idleMs: 180000,
  emptyRoomMs: 120000,
};

export function makeCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}

export function normaliseCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

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
    this.flags = 0;
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
    this.missed = 0;
  }

  charge(bytes) {
    const now = Date.now();
    if (now - this._msgWindow >= 1000) { this._msgWindow = now; this._msgCount = 0; this._bytes = 0; }
    this._msgCount++;
    this._bytes += bytes;
    this.lastSeen = now;
    return this._msgCount <= LIMITS.msgPerSecond && this._bytes <= LIMITS.bytesPerSecond;
  }

  packed() {
    return [this.id, r2(this.x), r2(this.y), r2(this.z), r2(this.yaw), r2(this.pitch), this.flags, Math.round(this.health)];
  }

  profile() { return { id: this.id, name: this.name, op: this.operator, w: this.weapon, down: this.down }; }
  send(str) { try { this.conn.send(str); } catch { /* dropped */ } }
}

export class Room {
  constructor(code, seed, route, opts = {}) {
    this.code = code;
    this.seed = seed >>> 0;
    this.route = route;
    this.public = opts.public === true;
    this.depth = 0;
    this.biome = route[0];
    this.players = new Map();
    this.hostId = 0;
    this.createdAt = Date.now();
    this.emptyAt = 0;
    this.tick = 0;
    this.clock = 0;
    this.boss = null;
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

  world() {
    return {
      seed: this.seed, route: this.route, depth: this.depth, biome: this.biome,
      clock: Math.round(this.clock * 10) / 10, riftOpen: this.riftOpen, boss: this.boss,
    };
  }

  state() {
    return {
      code: this.code, players: this.size, max: LIMITS.players, public: this.public,
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

  create(seed, route, opts = {}) {
    if (this.rooms.size >= this.maxRooms) return null;
    let code = makeCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 64) code = makeCode();
    if (this.rooms.has(code)) return null;
    const s = (seed ?? (Math.random() * 0xffffffff)) >>> 0;
    const r = cleanRoute(route) || this.routeFor(s);
    const room = new Room(code, s, r, opts);
    this.rooms.set(code, room);
    this.log(`${opts.public ? 'public ' : ''}room ${code} opened (seed ${s})`);
    return room;
  }

  /** Find a public room with space, or create one. */
  matchmake(seed, route) {
    let best = null;
    for (const room of this.rooms.values()) {
      if (!room.public || room.full) continue;
      if (!best || room.size > best.size) best = room;
    }
    if (best) return best;
    return this.create(seed, route, { public: true });
  }

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

export function acceptMove(player, x, y, z, now = Date.now()) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > 20000 || Math.abs(z) > 20000 || y < -2000 || y > 20000) return false;
  const last = player.lastMove;
  player.lastMove = now;
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
