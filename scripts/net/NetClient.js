/**
 * NetClient — BLACKROOT online session client.
 */
import * as THREE from 'three';
import { Audio } from '../core/AudioManager.js';
import { RemotePlayer, FLAG } from './RemotePlayer.js';
import { LocalSocket, localRooms } from './LocalHub.js';

export const NetState = {
  OFFLINE: 'OFFLINE', CONNECTING: 'CONNECTING', LOBBY: 'LOBBY', PLAYING: 'PLAYING',
  RETRYING: 'RETRYING', FAILED: 'FAILED',
};

const SEND_HZ = 12;
const MAX_BACKOFF = 8;
const MAX_ATTEMPTS = 10;

export function defaultServer() {
  if (typeof location === 'undefined') return 'ws://localhost:8787/net';
  const secure = location.protocol === 'https:';
  if (location.protocol.startsWith('http') && location.host) return `${secure ? 'wss' : 'ws'}://${location.host}/net`;
  return 'ws://localhost:8787/net';
}

export class NetClient {
  constructor(game) {
    this.game = game;
    this.state = NetState.OFFLINE;
    this.sock = null;
    this.url = '';
    this.code = '';
    this.selfId = 0;
    this.hostId = 0;
    this.isHost = false;
    this.publicSession = false;
    this.name = loadName();
    this.players = new Map();
    this.roster = new Map();
    this.world = null;
    this.error = '';
    this.rtt = 0;
    this.tickHz = 15;
    this.chat = [];
    this._t0 = now();
    this._clock = 0;
    this._sendAcc = 0;
    this._attempt = 0;
    this._retryTimer = 0;
    this._wantCode = '';
    this._wantHost = false;
    this._wantPublic = false;
    this._lastGun = '';
    this._listeners = new Map();
    this._muzzle = new THREE.Vector3();
    this._hit = new THREE.Vector3();
  }

  get online() { return this.state === NetState.PLAYING || this.state === NetState.LOBBY; }
  get count() { return this.players.size + (this.online ? 1 : 0); }
  on(k, fn) { (this._listeners.get(k) || this._listeners.set(k, []).get(k)).push(fn); return this; }
  _emit(k, ...a) { for (const fn of this._listeners.get(k) || []) { try { fn(...a); } catch (e) { console.warn('[net]', e); } } }

  host(url, opts = {}) { return this._open(url, { host: true, ...opts }); }
  join(url, code, opts = {}) { return this._open(url, { host: false, code, ...opts }); }
  joinPublic(url, opts = {}) { return this._open(url, { host: false, code: 'PUBLIC', public: true, ...opts }); }
  get isLocal() { return !!(this.sock && this.sock.local); }
  localRooms() { return localRooms(); }

  _open(url, opts) {
    this.disconnect(true);
    this.local = opts.local === true;
    this.url = normaliseUrl(url || defaultServer());
    this._wantHost = !!opts.host;
    this._wantPublic = opts.public === true;
    this._wantCode = (opts.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    this._seed = opts.seed;
    this._route = opts.route;
    this._attempt = 0;
    this._triedLocal = this.local;
    this.error = '';
    return this._dial();
  }

  _hello() {
    return {
      t: 'hello', name: this.name, host: this._wantHost, code: this._wantCode,
      public: this._wantPublic, seed: this._seed, route: this._route,
      op: this.game.armoury ? this.game.armoury.operator : undefined,
      w: this.game.weapons?.currentId || '',
    };
  }

  _dial() {
    this.state = NetState.CONNECTING;
    this._emit('state', this.state);
    return new Promise((resolve) => {
      let sock;
      if (this.local) sock = new LocalSocket(this._hello());
      else {
        try { sock = new WebSocket(this.url); } catch (e) { this._fail(`That does not look like a server address: ${e.message}`); resolve(false); return; }
      }
      this.sock = sock;
      let settled = false;
      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { sock.close(); } catch {}
        this._unreachable(resolve, 'No answer from the server.');
      }, this.local ? 4000 : 8000);
      const mine = () => this.sock === sock;
      sock.onopen = () => { if (!mine() || this.local) return; this.send(this._hello()); };
      sock.onmessage = (ev) => {
        if (!mine()) return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (!settled && (m.t === 'welcome' || m.t === 'err')) { settled = true; clearTimeout(deadline); if (m.t === 'welcome') sock.accepted?.(); resolve(m.t === 'welcome'); }
        this._recv(m);
      };
      sock.onerror = () => {};
      sock.onclose = (ev) => {
        clearTimeout(deadline);
        if (!mine()) { if (!settled) { settled = true; resolve(false); } return; }
        const wasIn = this.online;
        this.sock = null;
        this._clearPlayers();
        if (!settled) { settled = true; this._unreachable(resolve, this.error || 'Could not reach the server.'); return; }
        if (this._intentional) { this._intentional = false; this.state = NetState.OFFLINE; this._emit('state', this.state); return; }
        if (ev.code >= 4400 || ev.code === 4005 || ev.code === 4004) { this._fail(this.error || 'The server closed the connection.'); return; }
        if (wasIn) this._scheduleRetry(ev.reason || 'Connection lost'); else this._fail(this.error || 'The server closed the connection.');
      };
    });
  }

  _unreachable(resolve, reason) {
    if (this._wantPublic && !this.local) {
      this._fail(`${reason} Public online needs a deployed BLACKROOT multiplayer server.`);
      resolve(false);
      return;
    }
    if (this.local || this._triedLocal) {
      this._fail(this.local ? reason : `${reason} Co-op needs a server: run "npm run server" on any machine and put its address in.`);
      resolve(false); return;
    }
    this._triedLocal = true; this.local = true; this.error = '';
    this._emit('notice', `${reason} Falling back to co-op on this computer.`, 'warn');
    this._dial().then(resolve);
  }

  _scheduleRetry(reason) {
    this._attempt++;
    this.state = NetState.RETRYING;
    this._wantHost = false;
    this._wantCode = this.publicSession ? 'PUBLIC' : (this.code || this._wantCode);
    this._wantPublic = this.publicSession;
    const wait = Math.min(MAX_BACKOFF, 1.2 * Math.pow(1.7, this._attempt - 1));
    this._retryTimer = wait;
    this.error = `${reason}. Reconnecting${this.publicSession ? ' to public online' : ` to ${this.code}`} in ${wait.toFixed(0)}s…`;
    this._emit('state', this.state);
    this._emit('notice', this.error, 'warn');
    if (this._attempt > MAX_ATTEMPTS) this._fail('Lost the server. Carrying on alone.');
  }

  _fail(msg) { this.error = msg; this.state = NetState.FAILED; this._clearPlayers(); this._emit('state', this.state); this._emit('notice', msg, 'bad'); }

  disconnect(silent = false) {
    this._intentional = true; this._retryTimer = 0; this._attempt = 0;
    if (this.sock) { try { this.sock.close(1000, 'bye'); } catch {} }
    this.sock = null; this._clearPlayers(); this.code = ''; this.selfId = 0; this.isHost = false; this.publicSession = false;
    this.world = null; this.local = false; this._triedLocal = false; this._wantPublic = false; this.state = NetState.OFFLINE;
    if (!silent) { this._emit('state', this.state); this._emit('notice', 'Left the online game', ''); }
  }

  _clearPlayers() { for (const p of this.players.values()) p.dispose(); this.players.clear(); }
  rebindScene() {
    const scene = this.game.scene; if (!scene) return;
    for (const p of this.players.values()) p.dispose(); this.players.clear();
    for (const prof of this.roster.values()) if (prof.id !== this.selfId) this.players.set(prof.id, new RemotePlayer(prof, scene));
  }

  send(obj) { const s = this.sock; if (!s || s.readyState !== 1) return false; try { s.send(JSON.stringify(obj)); return true; } catch { return false; } }
  setName(name) { this.name = String(name || '').slice(0, 18) || 'OPERATOR'; saveName(this.name); this.send({ t: 'name', name: this.name }); }
  reportShot(from, dir, profile) { if (this.online) this.send({ t: 'shot', p: [r2(from.x), r2(from.y), r2(from.z)], d: [r3(dir.x), r3(dir.y), r3(dir.z)], w: profile || '' }); }
  reportBossHit(dmg) { if (this.online) this.send({ t: 'bosshit', d: Math.round(dmg * 10) / 10 }); }
  reportDown(cause) { if (this.online) this.send({ t: 'down', cause }); }
  reportAlive(hp) { if (this.online) this.send({ t: 'alive', hp }); }
  revive(id, hp = 35) { if (this.online) this.send({ t: 'revive', id, hp }); }
  ping(pos, label = '') { if (this.online) this.send({ t: 'evt', k: 'ping', p: [r2(pos.x), r2(pos.y), r2(pos.z)], v: label, self: false }); }
  say(text) { if (this.online) this.send({ t: 'chat', m: text }); }
  publishWorld(partial = {}) {
    if (!this.online || !this.isHost) return;
    const g = this.game;
    this.send({ t: 'world', biome: g.biomeId || g.biome?.id, depth: g.depth | 0, clock: g.time, riftOpen: !!g.riftOpen, route: g.route, ...partial });
  }
  descend(biome, depth) { if (this.online) this.send({ t: 'rift', biome, depth }); }

  _recv(m) {
    const g = this.game;
    switch (m.t) {
      case 'welcome':
        this.selfId = m.id; this.code = m.code; this.publicSession = !!m.public; this.isHost = !!m.host; this.hostId = m.hostId; this.tickHz = m.tickHz || 15;
        this.localGame = this.isLocal; this.world = m.world; this._attempt = 0; this.error = ''; this._intentional = false; this.roster.clear(); this.state = NetState.LOBBY;
        for (const p of m.players || []) this.roster.set(p.id, p);
        this._emit('state', this.state); this._emit('welcome', m); return;
      case 'join':
        this.roster.set(m.p.id, m.p); if (g.scene && !this.players.has(m.p.id)) this.players.set(m.p.id, new RemotePlayer(m.p, g.scene));
        this._emit('notice', `${m.p.name} joined`, 'good'); this._emit('roster'); return;
      case 'left':
        this.roster.delete(m.id); this.players.get(m.id)?.dispose(); this.players.delete(m.id); this._emit('notice', `${m.name} left`, ''); this._emit('roster'); return;
      case 'host': this.hostId = m.id; this.isHost = m.id === this.selfId; if (this.isHost) this._emit('notice', 'You are now the session host', 'warn'); this._emit('roster'); return;
      case 'snap': {
        const now_ = (now() - this._t0) / 1000;
        for (const row of m.ps) {
          const id = row[0]; if (id === this.selfId) continue;
          let p = this.players.get(id);
          if (!p) { const prof = this.roster.get(id); if (!prof || !g.scene) continue; p = new RemotePlayer(prof, g.scene); this.players.set(id, p); }
          p.push(now_, row[1], row[2], row[3], row[4], row[5], row[6], row[7]);
        }
        return;
      }
      case 'gun': { const p = this.players.get(m.id); if (p) p.weapon = m.w; const r = this.roster.get(m.id); if (r) r.w = m.w; return; }
      case 'reop': { const p = this.players.get(m.id); if (p) p.setOperator(m.op); const r = this.roster.get(m.id); if (r) r.op = m.op; return; }
      case 'named': { const p = this.players.get(m.id); if (p) p.setProfile({ name: m.name }); const r = this.roster.get(m.id); if (r) r.name = m.name; this._emit('roster'); return; }
      case 'shot': this._remoteShot(m); return;
      case 'boss': this._emit('boss', m); if (g.boss && m.b) { g.boss.netHealth = m.b.health; g.boss.netPhase = m.b.phase; } return;
      case 'bossdown': this._emit('notice', 'The thing is down. A way out has opened.', 'good'); this._emit('bossdown', m); return;
      case 'world': this.world = m.world; this._emit('world', m.world); return;
      case 'rift': this.world = m.world; this._emit('notice', 'The party steps through together', 'good'); this._emit('rift', m.world); return;
      case 'riftreq': if (this.isHost) this._emit('notice', `${m.name} is waiting at the rift`, 'warn'); return;
      case 'down': { const p = this.players.get(m.id); if (p) { p.down = true; p.health = 0; p._drawPlate(); } this._emit('notice', `${m.name} is down — get to them`, 'bad'); this._emit('down', m); return; }
      case 'up': { const p = this.players.get(m.id); if (p) { p.down = false; p.health = m.hp; p._drawPlate(); } if (m.id === this.selfId) this._emit('revived', m); else this._emit('notice', 'Back on their feet', 'good'); return; }
      case 'evt': this._emit('evt', m); if (m.k === 'ping') this._remotePing(m); return;
      case 'chat': this.chat.push(m); if (this.chat.length > 50) this.chat.shift(); this._emit('chat', m); return;
      case 'ping': this.send({ t: 'pong', n: m.n }); return;
      case 'err': this.error = m.m || 'The server refused the connection.'; if (!this.online) { this.state = NetState.FAILED; this._emit('state', this.state); } this._emit('notice', this.error, 'bad'); return;
      default:
    }
  }

  _remoteShot(m) {
    const g = this.game; if (!g.fx || !g.scene) return;
    const p = this.players.get(m.id); const from = p ? p.muzzle(this._muzzle) : this._muzzle.set(m.p[0], m.p[1], m.p[2]);
    this._hit.set(from.x + m.d[0] * 60, from.y + m.d[1] * 60, from.z + m.d[2] * 60); g.fx.tracer(from, this._hit, 0xffd2a0, 0.8); Audio.gunshot(m.w || 'ar', from);
  }
  _remotePing(m) { if (!m.p) return; const who = this.roster.get(m.id)?.name || 'Someone'; this.game.waypoints?.addNetPing?.(m.p[0], m.p[1], m.p[2], m.v || who); this._emit('notice', `${who} marked a spot`, 'warn'); }

  update(dt) {
    this._clock = (now() - this._t0) / 1000;
    if (this.state === NetState.RETRYING) { this._retryTimer -= dt; if (this._retryTimer <= 0) { this._intentional = false; this._dial(); } return; }
    if (!this.online) return;
    if (this.state === NetState.LOBBY && this.game.state === 'PLAYING') { this.state = NetState.PLAYING; this._emit('state', this.state); }
    const g = this.game; const cam = g.camera?.position;
    for (const p of this.players.values()) p.update(dt, this._clock, cam);
    this._sendAcc += dt; const step = 1 / SEND_HZ; if (this._sendAcc < step) return; this._sendAcc = 0; if (!g.player) return;
    const pl = g.player; let f = 0;
    if (pl.crouching) f |= FLAG.CROUCH; if (pl.sprinting) f |= FLAG.SPRINT; if (g.weapons?.aiming) f |= FLAG.AIM; if (g.flashlight?.on) f |= FLAG.LIGHT; if (g.stats?.dead) f |= FLAG.DOWN; if (pl.inWater) f |= FLAG.WATER;
    const gun = g.weapons?.currentId || ''; const changed = gun !== this._lastGun; this._lastGun = gun;
    this.send({ t: 'pos', p: [r2(pl.position.x), r2(pl.position.y), r2(pl.position.z)], y: r3(pl.yaw), pi: r3(pl.pitch), f, hp: Math.round(g.stats?.health ?? 100), ...(changed ? { w: gun } : {}) });
    if (this.isHost) { this._worldAcc = (this._worldAcc || 0) + step; if (this._worldAcc > 1) { this._worldAcc = 0; this.publishWorld(); } }
  }

  list() {
    const out = [{ id: this.selfId, name: this.name, you: true, host: this.isHost }];
    for (const p of this.roster.values()) if (p.id !== this.selfId) out.push({ id: p.id, name: p.name, you: false, host: p.id === this.hostId });
    return out;
  }
}

function normaliseUrl(raw) {
  let s = String(raw || '').trim(); if (!s) return defaultServer();
  if (!/^wss?:\/\//i.test(s)) {
    if (/^https:\/\//i.test(s)) s = s.replace(/^https:/i, 'wss:');
    else if (/^http:\/\//i.test(s)) s = s.replace(/^http:/i, 'ws:');
    else s = (typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss://' : 'ws://') + s;
  }
  const u = s.replace(/\/+$/, ''); return /\/net$/.test(u) ? u : `${u}/net`;
}
function loadName() { try { return localStorage.getItem('blackroot.callsign') || `OPERATOR-${Math.floor(Math.random() * 900 + 100)}`; } catch { return 'OPERATOR'; } }
function saveName(n) { try { localStorage.setItem('blackroot.callsign', n); } catch {} }
function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }
