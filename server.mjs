/**
 * BLACKROOT dedicated server.
 *
 *   npm run server                 # game + co-op on http://localhost:8787
 *   PORT=9000 npm run server       # somewhere else
 *   HOST=0.0.0.0 npm run server    # reachable from the LAN / the internet
 *
 * It does two jobs at once. It serves the game's files, so a player can point
 * a browser at the box and play; and it runs the co-op hub on ws://…/net, so
 * the people who type the same six-character code end up in the same run.
 *
 * There is no matchmaking, no accounts and no database. A room lives in
 * memory for as long as somebody is in it (plus two minutes' grace so a
 * player who alt-tabs into a crash can come straight back to the same code),
 * and the whole thing is one process with no dependencies beyond Node.
 *
 * Deploying it: any host that gives you a TCP port will do — a VPS, a Fly
 * machine, a Raspberry Pi on your own network. Put it behind a TLS terminator
 * if you serve the game over https, because a page on https cannot open a
 * plain ws:// socket; the client will ask for wss:// automatically in that
 * case.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach } from './server/wsock.js';
import { Hub, LIMITS } from './server/rooms.js';
// The room logic is shared with the browser's local hub, so it lives in one
// place that knows nothing about sockets.
import { doHello, handle, tickRooms, TICK_HZ } from './server/protocol.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const QUIET = process.argv.includes('--quiet') || process.env.QUIET === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

const log = (...a) => { if (!QUIET) console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a); };
const hub = new Hub({ log });

/* ================= http: the game's files, plus a little status ================= */

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);

  if (p === '/health') return json(res, { ok: true, rooms: hub.rooms.size, players: playerCount(), up: Math.round(process.uptime()) });
  if (p === '/rooms') return json(res, { rooms: hub.list() });
  if (p.startsWith('/room/')) {
    const room = hub.get(p.slice(6));
    return room ? json(res, room.state()) : json(res, { error: 'no such room' }, 404);
  }

  try {
    if (p === '/') p = '/index.html';
    const file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
});

function json(res, obj, code = 200) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Content-Length': b.length });
  res.end(b);
}

function playerCount() {
  let n = 0;
  for (const r of hub.rooms.values()) n += r.size;
  return n;
}

/* ================= websocket: the co-op hub ================= */

const pending = new Set();   // connected, but has not said hello yet

attach(server, '/net', (conn, req) => {
  const addr = req.socket.remoteAddress;
  let player = null;
  pending.add(conn);
  // A socket that connects and then says nothing is either a scan or a broken
  // client. Either way it does not get to sit there.
  const helloTimer = setTimeout(() => { if (!player) conn.close(4008, 'no hello'); }, 10000);

  conn.on('message', (text) => {
    let m;
    try { m = JSON.parse(text); } catch { conn.close(1003, 'not json'); return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') { conn.close(1003, 'bad message'); return; }

    if (!player) {
      if (m.t !== 'hello') { conn.close(4003, 'hello first'); return; }
      player = doHello(hub, conn, m, addr, log);
      if (player) { pending.delete(conn); clearTimeout(helloTimer); }
      return;
    }
    if (!player.charge(text.length)) { conn.close(4029, 'too fast'); return; }
    handle(player, m);
  });

  conn.on('close', () => {
    clearTimeout(helloTimer);
    pending.delete(conn);
    if (!player) return;
    const room = player.room;
    if (room) {
      room.remove(player);
      room.broadcast({ t: 'left', id: player.id, name: player.name });
      log(`${player.name} left ${room.code} (${room.size} in room)`);
    }
    player.room = null;
  });

  // A client generating a 513x513 world blocks its own main thread for tens of
  // seconds and sends nothing at all in that time. The transport-level pong is
  // answered by the browser's network thread regardless, so it — not the flow
  // of game messages — is what proves the player is still there.
  conn.on('pong', () => { if (player) player.lastSeen = Date.now(); });

  conn.on('error', () => { /* the close handler does the cleanup */ });
});

/* ================= the tick ================= */

setInterval(() => tickRooms(hub), Math.round(1000 / TICK_HZ));

// Heartbeat: a client whose network vanished without a FIN is only detectable
// by asking it something and not being answered.
//
// One missed beat is not evidence of anything. A client generating a 513x513
// world blocks its own main thread for a minute or more on a slow machine —
// longer still on integrated graphics, where compiling the world's shaders is
// itself measured in seconds — and dropping it for that throws the player out
// of co-op at precisely the moment they step through a rift. Nothing is lost
// by waiting: an actually dead socket is reclaimed when the room empties.
setInterval(() => {
  for (const room of hub.rooms.values()) {
    for (const p of room.players.values()) {
      if (p.conn.alive) p.missed = 0;
      else if (++p.missed >= 14) { p.conn.close(4008, 'unresponsive'); continue; }
      p.conn.alive = false;
      p.conn.ping('');
    }
  }
  hub.sweep();
}, 15000);

/* ================= go ================= */

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`BLACKROOT dedicated server`);
  console.log(`  game     http://${shown}:${PORT}`);
  console.log(`  co-op    ws://${shown}:${PORT}/net`);
  console.log(`  status   http://${shown}:${PORT}/health`);
  console.log(`  up to ${LIMITS.players} players per code, ${TICK_HZ} Hz`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const room of hub.rooms.values()) room.broadcast({ t: 'err', code: 'shutdown', m: 'The server is shutting down.' });
    setTimeout(() => process.exit(0), 120);
  });
}

export { hub, server };
