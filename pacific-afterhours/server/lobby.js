// The lobby service. This is the actual room-code lookup: codes live in a Map,
// are checked for collisions on creation, and are removed when the room empties.
//
// It also owns the online wallet. Clients never tell the server how much money they
// have — they ask the server to bank a reward id, and the server decides. A reward id
// that has already been banked for a profile is rejected, so neither a reconnect nor
// a replayed message can duplicate money or vehicles.

import { randomUUID, randomInt } from 'node:crypto';

export const REWARDS = {
  // Every payout the client may request, with the value the server will actually pay.
  delivery: { min: 120, max: 3000 },
  taxi: { min: 90, max: 2200 },
  race: { min: 800, max: 9000 },
  recovery: { min: 400, max: 2000 },
  collectible: { min: 250, max: 250 },
  mission: { min: 250, max: 15000 },
};

export class Profile {
  constructor(token, name) {
    this.token = token;
    this.name = name;
    this.money = 500;
    this.revision = 0;
    this.ledger = new Set();
    this.vehicles = new Map();
    this.createdAt = Date.now();
    this.lastSeen = Date.now();
  }

  claim(id, kind, requested) {
    if (typeof id !== 'string' || !id.length || id.length > 120) {
      return { ok: false, reason: 'bad-id' };
    }
    if (this.ledger.has(id)) return { ok: false, reason: 'already-claimed' };
    const band = REWARDS[kind];
    if (!band) return { ok: false, reason: 'unknown-reward' };
    const amount = Math.max(band.min, Math.min(band.max, Math.round(Number(requested) || band.min)));
    this.ledger.add(id);
    this.money += amount;
    this.revision++;
    return { ok: true, amount, money: this.money, revision: this.revision };
  }

  spend(amount, reason) {
    const a = Math.max(0, Math.round(Number(amount) || 0));
    if (a > this.money) return { ok: false, reason: 'insufficient', money: this.money };
    this.money -= a;
    this.revision++;
    return { ok: true, money: this.money, revision: this.revision, reason };
  }

  addVehicle(id, spec, colour) {
    if (this.vehicles.has(id)) return { ok: false, reason: 'already-owned' };
    this.vehicles.set(id, { id, spec, colour });
    this.revision++;
    return { ok: true };
  }

  wallet() {
    return { money: this.money, revision: this.revision, ledger: [...this.ledger] };
  }
}

export class Room {
  constructor(code, hostId, opts = {}) {
    this.code = code;
    this.hostId = hostId;
    this.pvp = !!opts.pvp;          // player-versus-player is off unless the host turns it on
    this.name = opts.name || 'San Aurelio';
    this.members = new Map();       // clientId -> client
    this.createdAt = Date.now();
    this.tick = 0;
  }
  get size() { return this.members.size; }
  roster() {
    return [...this.members.values()].map((c) => ({
      id: c.id, name: c.name, host: c.id === this.hostId, money: c.profile.money,
    }));
  }
  broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const c of this.members.values()) {
      if (c.id === exceptId) continue;
      c.sendRaw(s);
    }
  }
}

export class Lobby {
  constructor(opts = {}) {
    this.rooms = new Map();        // code -> Room
    this.profiles = new Map();     // token -> Profile
    this.maxPlayers = opts.maxPlayers || 8;
    this.maxRooms = opts.maxRooms || 500;
  }

  profileFor(token, name) {
    if (token && this.profiles.has(token)) {
      const p = this.profiles.get(token);
      p.lastSeen = Date.now();
      if (name) p.name = name;
      return p;
    }
    const t = token && typeof token === 'string' && token.length <= 64 ? token : randomUUID();
    const p = new Profile(t, name || 'Driver');
    this.profiles.set(t, p);
    return p;
  }

  /** Six digits, guaranteed unique among live rooms. */
  generateCode() {
    for (let attempt = 0; attempt < 500; attempt++) {
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate a room code');
  }

  createRoom(client, opts = {}) {
    if (this.rooms.size >= this.maxRooms) return { ok: false, reason: 'server-full' };
    const code = this.generateCode();
    const room = new Room(code, client.id, opts);
    this.rooms.set(code, room);
    return this.joinRoom(client, code);
  }

  /** The lookup. A code that is not in the Map is simply not a room. */
  lookup(code) {
    if (typeof code !== 'string') return null;
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) return null;
    return this.rooms.get(c) || null;
  }

  joinRoom(client, code) {
    const room = this.lookup(code);
    if (!room) return { ok: false, reason: 'no-such-room' };
    if (room.size >= this.maxPlayers && !room.members.has(client.id)) {
      return { ok: false, reason: 'room-full' };
    }
    if (client.room && client.room !== room) this.leaveRoom(client);
    room.members.set(client.id, client);
    client.room = room;
    return { ok: true, room };
  }

  leaveRoom(client) {
    const room = client.room;
    if (!room) return null;
    room.members.delete(client.id);
    client.room = null;
    if (room.size === 0) {
      this.rooms.delete(room.code);
    } else if (room.hostId === client.id) {
      room.hostId = [...room.members.keys()][0];
    }
    return room;
  }

  stats() {
    return {
      rooms: this.rooms.size,
      players: [...this.rooms.values()].reduce((n, r) => n + r.size, 0),
      profiles: this.profiles.size,
    };
  }
}
