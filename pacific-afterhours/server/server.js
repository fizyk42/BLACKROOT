// Static file server for the client plus the WebSocket game server.
// Run with: npm start   (then open http://localhost:8080)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'client');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const HOST = process.env.HOST || '0.0.0.0';
const TICK_HZ = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

const lobby = new Lobby();

// ------------------------------------------------------------------ http

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...lobby.stats(), uptime: process.uptime() }));
    return;
  }
  if (url.pathname === '/api/room-exists') {
    const room = lobby.lookup(url.searchParams.get('code') || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ exists: !!room, players: room ? room.size : 0 }));
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found: ' + rel);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// ------------------------------------------------------------------ websocket

const wss = new WebSocketServer({ server, path: '/ws' });

class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = randomUUID().slice(0, 8);
    this.name = 'Driver';
    this.room = null;
    this.profile = null;
    this.alive = true;
    this.state = { x: 0, y: 0, z: 0, yaw: 0, anim: 'idle', veh: null, health: 100, speed: 0 };
    this.lastMsg = 0;
    this.msgBudget = 0;
  }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  sendRaw(s) { if (this.ws.readyState === 1) this.ws.send(s); }
}

const clients = new Set();

wss.on('connection', (ws) => {
  const client = new Client(ws);
  clients.add(client);

  ws.on('pong', () => { client.alive = true; });

  ws.on('message', (raw) => {
    // Basic flood protection: 120 messages per second is far above normal use.
    const now = Date.now();
    if (now - client.lastMsg > 1000) { client.msgBudget = 0; client.lastMsg = now; }
    if (++client.msgBudget > 120) return;

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    handle(client, msg);
  });

  ws.on('close', () => {
    const room = client.room;
    if (room) {
      lobby.leaveRoom(client);
      room.broadcast({ t: 'left', id: client.id, name: client.name, roster: room.roster() });
    }
    clients.delete(client);
  });

  ws.on('error', () => { /* the close handler does the cleanup */ });
});

function handle(client, msg) {
  switch (msg.t) {
    case 'hello': {
      const name = String(msg.name || 'Driver').slice(0, 20).replace(/[<>]/g, '');
      client.name = name;
      client.profile = lobby.profileFor(msg.token, name);
      client.send({
        t: 'welcome', id: client.id, name, token: client.profile.token,
        wallet: client.profile.wallet(), tickHz: TICK_HZ,
      });
      break;
    }

    case 'create': {
      if (!client.profile) return client.send({ t: 'error', message: 'Say hello first.' });
      const r = lobby.createRoom(client, { pvp: !!msg.pvp, name: msg.roomName });
      if (!r.ok) return client.send({ t: 'error', message: r.reason });
      sendRoom(client, r.room, true);
      break;
    }

    case 'join': {
      if (!client.profile) return client.send({ t: 'error', message: 'Say hello first.' });
      const r = lobby.joinRoom(client, String(msg.code || ''));
      if (!r.ok) return client.send({ t: 'error', message: r.reason, code: msg.code });
      sendRoom(client, r.room, false);
      r.room.broadcast({
        t: 'joined', id: client.id, name: client.name, roster: r.room.roster(),
      }, client.id);
      break;
    }

    case 'leave': {
      const room = client.room;
      if (!room) return;
      lobby.leaveRoom(client);
      room.broadcast({ t: 'left', id: client.id, name: client.name, roster: room.roster() });
      client.send({ t: 'left-room' });
      break;
    }

    case 'state': {
      if (!client.room) return;
      const s = client.state;
      s.x = num(msg.x); s.y = num(msg.y); s.z = num(msg.z);
      s.yaw = num(msg.yaw); s.speed = num(msg.speed);
      s.health = Math.max(0, Math.min(100, num(msg.health, 100)));
      s.anim = typeof msg.anim === 'string' ? msg.anim.slice(0, 24) : 'idle';
      s.veh = msg.veh && typeof msg.veh === 'object'
        ? { spec: String(msg.veh.spec || 'sedan').slice(0, 16), colour: num(msg.veh.colour), yaw: num(msg.veh.yaw) }
        : null;
      s.outfit = typeof msg.outfit === 'string' ? msg.outfit.slice(0, 24) : undefined;
      break;
    }

    case 'chat': {
      if (!client.room) return;
      const text = String(msg.text || '').slice(0, 200);
      if (!text.trim()) return;
      client.room.broadcast({ t: 'chat', from: client.name, id: client.id, text });
      break;
    }

    // ---- authoritative economy ----
    case 'claim': {
      if (!client.profile) return;
      const r = client.profile.claim(String(msg.id || ''), String(msg.kind || ''), msg.amount);
      client.send({
        t: 'claim-result', id: msg.id, ok: r.ok, reason: r.reason,
        amount: r.amount, wallet: client.profile.wallet(),
      });
      if (r.ok && client.room) {
        client.room.broadcast({ t: 'roster', roster: client.room.roster() });
      }
      break;
    }

    case 'spend': {
      if (!client.profile) return;
      const r = client.profile.spend(msg.amount, String(msg.reason || ''));
      client.send({ t: 'spend-result', ok: r.ok, reason: r.reason, wallet: client.profile.wallet() });
      break;
    }

    case 'buy-vehicle': {
      if (!client.profile) return;
      const price = Math.max(0, Math.round(Number(msg.price) || 0));
      const spend = client.profile.spend(price, 'vehicle');
      if (!spend.ok) return client.send({ t: 'buy-result', ok: false, reason: spend.reason, wallet: client.profile.wallet() });
      const add = client.profile.addVehicle(String(msg.id || ''), String(msg.spec || 'sedan'), Number(msg.colour) || 0);
      client.send({
        t: 'buy-result', ok: add.ok, reason: add.reason,
        id: msg.id, wallet: client.profile.wallet(),
      });
      break;
    }

    case 'wallet': {
      if (client.profile) client.send({ t: 'wallet', wallet: client.profile.wallet() });
      break;
    }

    case 'ping':
      client.send({ t: 'pong', ts: msg.ts });
      break;

    default:
      break;
  }
}

function num(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function sendRoom(client, room, created) {
  client.send({
    t: 'room',
    code: room.code,
    created,
    host: room.hostId === client.id,
    pvp: room.pvp,
    roster: room.roster(),
    you: client.id,
    wallet: client.profile.wallet(),
  });
}

// ------------------------------------------------------------------ tick

setInterval(() => {
  for (const room of lobby.rooms.values()) {
    room.tick++;
    const players = [];
    for (const c of room.members.values()) {
      players.push({
        id: c.id, name: c.name,
        x: round2(c.state.x), y: round2(c.state.y), z: round2(c.state.z),
        yaw: round3(c.state.yaw), anim: c.state.anim, veh: c.state.veh,
        health: Math.round(c.state.health), speed: round2(c.state.speed),
        outfit: c.state.outfit,
      });
    }
    room.broadcast({ t: 'snapshot', tick: room.tick, players });
  }
}, 1000 / TICK_HZ);

// Heartbeat: drop connections that stop responding.
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch (e) { /* terminated below on next pass */ }
  }
}, 15000);

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

server.listen(PORT, HOST, () => {
  console.log(`Pacific Afterhours`);
  console.log(`  play at   http://localhost:${PORT}`);
  console.log(`  websocket ws://localhost:${PORT}/ws`);
  console.log(`  health    http://localhost:${PORT}/healthz`);
});

export { server, wss, lobby };
