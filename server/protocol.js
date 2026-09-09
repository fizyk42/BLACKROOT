/**
 * protocol — what a BLACKROOT co-op room does with a message.
 *
 * This is deliberately transport-agnostic: it knows about players, rooms and
 * verbs, and nothing about sockets. `server.mjs` drives it over a real
 * WebSocket for players on different machines; the game drives the *same*
 * module in the browser, over a BroadcastChannel, so that two windows on one
 * computer can play together with no server at all.
 *
 * One implementation, two transports. The alternative — a second, simplified
 * protocol for the local case — would drift out of step with this one within a
 * week, and the bug would only ever show up for the players least able to
 * report it.
 */
import { Player, LIMITS, normaliseCode, cleanName, cleanRoute, acceptMove, sanitiseOperator, num } from './rooms.js';

export const TICK_HZ = 15;

/* ---------------- join / create ---------------- */

export function doHello(hub, conn, m, addr, log = () => {}) {
  const name = cleanName(m.name);
  const operator = sanitiseOperator(m.op);
  let room;

  if (m.host) {
    room = hub.create(m.seed, m.route);
    if (!room) { conn.send(JSON.stringify({ t: 'err', code: 'busy', m: 'The server is out of rooms. Try again shortly.' })); conn.close(4004, 'no rooms'); return null; }
  } else {
    const code = normaliseCode(m.code);
    room = hub.get(code);
    if (!room) {
      // The single most common thing that goes wrong is a mistyped code, so
      // it gets its own error rather than a generic failure.
      conn.send(JSON.stringify({ t: 'err', code: 'nosuch', m: `No game with the code ${code || '—'}. Check it and try again.` }));
      conn.close(4404, 'no such room');
      return null;
    }
    if (room.full) {
      conn.send(JSON.stringify({ t: 'err', code: 'full', m: `${room.code} is full (${LIMITS.players} players).` }));
      conn.close(4005, 'full');
      return null;
    }
  }

  const player = new Player(conn, name, operator);
  player.weapon = typeof m.w === 'string' ? m.w.slice(0, 32) : '';
  room.add(player);

  player.send(JSON.stringify({
    t: 'welcome',
    id: player.id,
    code: room.code,
    host: room.hostId === player.id,
    hostId: room.hostId,
    tickHz: TICK_HZ,
    limits: { players: LIMITS.players, chat: LIMITS.chatLen },
    world: room.world(),
    players: [...room.players.values()].filter((p) => p !== player).map((p) => p.profile()),
  }));
  room.broadcast({ t: 'join', p: player.profile() }, player.id);
  log(`${player.name} joined ${room.code} from ${addr} (${room.size} in room)`);
  return player;
}

/* ---------------- per-message handling ---------------- */

export function handle(p, m) {
  const room = p.room;
  if (!room) return;

  switch (m.t) {
    /* --- movement, 12–15 Hz --- */
    case 'pos': {
      const a = m.p;
      if (!Array.isArray(a) || a.length < 3) return;
      const [x, y, z] = a;
      // acceptMove writes the position itself, clamping an impossible claim
      // rather than discarding it; the counter only climbs while the claims
      // keep coming, and one legitimate lurch decays back to zero.
      if (acceptMove(p, x, y, z)) p.warnings = Math.max(0, p.warnings - 1);
      else if (++p.warnings > 120) { p.conn.close(4030, 'impossible movement'); return; }
      p.yaw = num(m.y, p.yaw, -Math.PI * 2, Math.PI * 2);
      p.pitch = num(m.pi, p.pitch, -2, 2);
      p.flags = (m.f | 0) & 0xff;
      p.health = num(m.hp, p.health, 0, 1000);
      if (typeof m.w === 'string' && m.w !== p.weapon) {
        p.weapon = m.w.slice(0, 32);
        room.broadcast({ t: 'gun', id: p.id, w: p.weapon }, p.id);
      }
      return;
    }

    /* --- a shot: relayed so everyone hears and sees it in the right place --- */
    case 'shot': {
      if (!Array.isArray(m.p) || !Array.isArray(m.d)) return;
      room.broadcast({
        t: 'shot', id: p.id, w: typeof m.w === 'string' ? m.w.slice(0, 32) : '',
        p: m.p.slice(0, 3).map((v) => num(v, 0, -20000, 20000)),
        d: m.d.slice(0, 3).map((v) => num(v, 0, -1, 1)),
        s: num(m.s, 1, 0, 4),
      }, p.id);
      return;
    }

    /* --- damage on the shared boss, arbitrated here --- */
    case 'bosshit': {
      if (!room.boss) return;
      const dmg = num(m.d, 0, 0, 5000);
      room.boss.health = Math.max(0, room.boss.health - dmg);
      const phase = room.boss.health > room.boss.maxHealth * 0.66 ? 1
        : room.boss.health > room.boss.maxHealth * 0.33 ? 2 : 3;
      const changed = phase !== room.boss.phase;
      room.boss.phase = phase;
      room.broadcast({ t: 'boss', b: room.boss, by: p.id, dmg, phase: changed });
      if (room.boss.health <= 0) {
        p.kills++;
        room.riftOpen = true;
        room.broadcast({ t: 'bossdown', id: room.boss.id, by: p.id });
        room.boss = null;
      }
      return;
    }

    /* --- the host declares the shared world state --- */
    case 'world': {
      if (p.id !== room.hostId) return;
      if (typeof m.biome === 'string') room.biome = m.biome.replace(/[^a-z]/g, '').slice(0, 16) || room.biome;
      room.depth = num(m.depth, room.depth, 0, 32) | 0;
      room.clock = num(m.clock, room.clock, 0, 1e7);
      if (typeof m.riftOpen === 'boolean') room.riftOpen = m.riftOpen;
      if (m.boss === null) room.boss = null;
      else if (m.boss && typeof m.boss === 'object') {
        room.boss = {
          id: String(m.boss.id || '').slice(0, 24),
          name: String(m.boss.name || '').slice(0, 40),
          health: num(m.boss.health, 100, 0, 1e6),
          maxHealth: num(m.boss.maxHealth, 100, 1, 1e6),
          phase: num(m.boss.phase, 1, 1, 3) | 0,
        };
      }
      const r = cleanRoute(m.route);
      if (r) room.route = r;
      room.broadcast({ t: 'world', world: room.world() }, p.id);
      return;
    }

    /* --- moving to the next biome: everyone goes together --- */
    case 'rift': {
      if (p.id !== room.hostId) {
        // A guest asking to descend is a request; the host's client answers it.
        room.players.get(room.hostId)?.send(JSON.stringify({ t: 'riftreq', id: p.id, name: p.name }));
        return;
      }
      room.depth = num(m.depth, room.depth + 1, 0, 32) | 0;
      room.biome = typeof m.biome === 'string' ? m.biome.replace(/[^a-z]/g, '').slice(0, 16) : room.biome;
      room.riftOpen = false;
      room.boss = null;
      for (const q of room.players.values()) q.warp = true;
      room.broadcast({ t: 'rift', world: room.world() });
      log(`room ${room.code} descends to ${room.biome} (depth ${room.depth})`);
      return;
    }

    /* --- down / revive / death --- */
    case 'down': {
      p.down = true;
      p.health = 0;
      room.broadcast({ t: 'down', id: p.id, name: p.name, cause: String(m.cause || '').slice(0, 60) });
      return;
    }
    case 'revive': {
      const target = room.players.get(m.id | 0);
      if (!target || !target.down) return;
      target.down = false;
      target.health = num(m.hp, 35, 1, 1000);
      room.broadcast({ t: 'up', id: target.id, by: p.id, hp: target.health });
      return;
    }
    case 'alive': { p.down = false; p.health = num(m.hp, 100, 0, 1000); return; }

    /* --- free-form co-op events: pings, loot calls, mutant spawns --- */
    case 'evt': {
      const k = String(m.k || '').replace(/[^a-z_]/g, '').slice(0, 24);
      if (!k) return;
      room.broadcast({
        t: 'evt', id: p.id, k,
        p: Array.isArray(m.p) ? m.p.slice(0, 3).map((v) => num(v, 0, -20000, 20000)) : null,
        v: typeof m.v === 'number' ? num(m.v, 0, -1e6, 1e6) : (typeof m.v === 'string' ? m.v.slice(0, 40) : null),
      }, m.self ? 0 : p.id);
      return;
    }

    case 'chat': {
      const text = String(m.m || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.chatLen);
      if (!text) return;
      const line = { t: 'chat', id: p.id, name: p.name, m: text, at: Date.now() };
      room.chat.push(line);
      if (room.chat.length > 60) room.chat.shift();
      room.broadcast(line);
      return;
    }

    case 'name': { p.name = cleanName(m.name, p.name); room.broadcast({ t: 'named', id: p.id, name: p.name }); return; }
    case 'op': { p.operator = sanitiseOperator(m.op); room.broadcast({ t: 'reop', id: p.id, op: p.operator }, p.id); return; }
    case 'pong': { p.rtt = Math.max(0, Date.now() - num(m.n, Date.now(), 0, 1e15)); return; }
    case 'bye': { p.conn.close(1000, 'bye'); return; }
    default: /* unknown verbs are ignored, so an older client is not fatal */
  }
}


/* ---------------- the shared tick ---------------- */

/**
 * Advance every room one tick and post a snapshot to everyone in it. Returns
 * the number of players it dropped for going quiet.
 */
export function tickRooms(hub, now = Date.now()) {
  let dropped = 0;
  for (const room of hub.rooms.values()) {
    if (!room.size) continue;
    room.tick++;
    room.clock += 1 / TICK_HZ;
    const snap = JSON.stringify(room.snapshot());
    for (const p of room.players.values()) {
      // Silence alone is not proof of absence: a client can be locked up
      // generating a world and still be answering pings from its network
      // thread. Only a client that is *both* saying nothing and failing to
      // answer the heartbeat is gone.
      if (now - p.lastSeen > LIMITS.idleMs && (p.missed || 0) >= 3) {
        p.conn.close(4008, 'idle'); dropped++; continue;
      }
      p.send(snap);
    }
  }
  return dropped;
}
