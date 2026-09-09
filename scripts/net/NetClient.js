/**
 * NetClient — the co-op session on the game's side.
 *
 * The contract with the server is deliberately small. You send where you are
 * twelve times a second and shout when something happens; the server keeps
 * the things everyone has to agree on (the seed, the road through the biomes,
 * the boss's health, who is down) and fans the rest out. Everything else —
 * the forest, the wildlife, your own footing — is simulated locally from the
 * shared seed, which is why two people on the same code walk the same map
 * without the server ever sending a single tree.
 *
 * Failure is expected, not exceptional. A dedicated server is a machine
 * somewhere else, and the game has to stay playable when it goes away: a
 * dropped socket puts the run into single-player and tries to come back in
 * the background, and nothing in the game loop is allowed to depend on a
 * message having arrived.
 */
import * as THREE from 'three';
import { Audio } from '../core/AudioManager.js';
import { RemotePlayer, FLAG } from './RemotePlayer.js';
import { LocalSocket, localRooms } from './LocalHub.js';

export const NetState = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  LOBBY: 'LOBBY',
  PLAYING: 'PLAYING',
  RETRYING: 'RETRYING',
  FAILED: 'FAILED',
};

const SEND_HZ = 12;
// Ten attempts with a short ceiling rather than six with a long one: the
// thing a client is usually recovering from is its own main thread having
// been blocked for a minute building a world, and it needs to still be trying
// when it comes back.
const MAX_BACKOFF = 8;
const MAX_ATTEMPTS = 10;

/** Where the server is, if the player has not said otherwise. */
export function defaultServer() {
  if (typeof location === 'undefined') return 'ws://localhost:8787/net';
  // Served by the dedicated server itself? Then it is right here. A page on
  // https must use wss, or the browser refuses the socket outright.
  const secure = location.protocol === 'https:';
  if (location.protocol.startsWith('http') && location.host) {
    return `${secure ? 'wss' : 'ws'}://${location.host}/net`;
  }
  // Opened from a file:// build. localhost is the only sane guess.
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
    this.name = loadName();
    this.players = new Map();     // id -> RemotePlayer
    this.roster = new Map();      // id -> profile (survives a world rebuild)
    this.world = null;            // { seed, route, depth, biome, ... }
    this.error = '';
    this.rtt = 0;
    this.tickHz = 15;
    this.chat = [];

    // Interpolation runs on wall-clock time, never on the simulation clock:
    // snapshots arrive at a steady 15 Hz of *real* time, and on a machine
    // rendering at 4 fps a simulation clock advances in coarse jumps, so every
    // packet inside one frame would be stamped identically and thrown away as
    // a duplicate. The avatar would then crawl along seconds behind the truth.
    this._t0 = now();
    this._clock = 0;
    this._sendAcc = 0;
    this._attempt = 0;
    this._retryTimer = 0;
    this._wantCode = '';
    this._wantHost = false;
    this._lastGun = '';
    this._listeners = new Map();
    this._muzzle = new THREE.Vector3();
    this._hit = new THREE.Vector3();
  }

  get online() { return this.state === NetState.PLAYING || this.state === NetState.LOBBY; }
  get count() { return this.players.size + (this.online ? 1 : 0); }

  /* ================= tiny event bus ================= */

  on(k, fn) { (this._listeners.get(k) || this._listeners.set(k, []).get(k)).push(fn); return this; }
  _emit(k, ...a) { for (const fn of this._listeners.get(k) || []) { try { fn(...a); } catch (e) { console.warn('[net]', e); } } }

  /* ================= connecting ================= */

  /** Open a brand new game and get a code back. */
  host(url, opts = {}) { return this._open(url, { host: true, ...opts }); }

  /** Join an existing game by its code. */
  join(url, code, opts = {}) { return this._open(url, { host: false, code, ...opts }); }

  /** True when this session is running on the in-browser hub, not a server. */
  get isLocal() { return !!(this.sock && this.sock.local); }

  /** Codes hosted by other windows on this computer. */
  localRooms() { return localRooms(); }

  _open(url, opts) {
    this.disconnect(true);
    this.local = opts.local === true;
    this.url = normaliseUrl(url || defaultServer());
    this._wantHost = !!opts.host;
    this._wantCode = (opts.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    this._seed = opts.seed;
    this._route = opts.route;
    this._attempt = 0;
    this._triedLocal = this.local;
    this.error = '';
    return this._dial();
  }

  _dial() {
    this.state = NetState.CONNECTING;
    this._emit('state', this.state);
    return new Promise((resolve) => {
      let sock;
      if (this.local) {
        // No server involved at all: the room runs in a browser window on this
        // computer, over the same protocol.
        sock = new LocalSocket({
          t: 'hello', name: this.name, host: this._wantHost, code: this._wantCode,
          seed: this._seed, route: this._route,
          op: this.game.armoury ? this.game.armoury.operator : undefined,
          w: this.game.weapons?.currentId || '',
        });
      } else {
        try { sock = new WebSocket(this.url); } catch (e) {
          this._fail(`That does not look like a server address: ${e.message}`);
          resolve(false); return;
        }
      }
      this.sock = sock;
      let settled = false;

      // A server that is not there does not always fail fast — some networks
      // black-hole the SYN — so the attempt gets its own deadline.
      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { sock.close(); } catch { /* already dead */ }
        this._unreachable(resolve, 'No answer from the server.');
      }, this.local ? 4000 : 8000);

      // Every callback below is guarded against being the *previous* socket.
      // A refused join leaves a socket whose close event has not fired yet;
      // when it does, unguarded handlers would null out `this.sock`, clear the
      // roster and reset the state of the connection that replaced it — a
      // session that can receive but never send, which is a maddening bug to
      // find from the outside.
      const mine = () => this.sock === sock;

      sock.onopen = () => {
        if (!mine()) return;
        // The local socket carried its hello in at construction time.
        if (this.local) return;
        this.send({
          t: 'hello',
          name: this.name,
          host: this._wantHost,
          code: this._wantCode,
          seed: this._seed,
          route: this._route,
          op: this.game.armoury ? this.game.armoury.operator : undefined,
          w: this.game.weapons?.currentId || '',
        });
      };

      sock.onmessage = (ev) => {
        if (!mine()) return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!settled && (m.t === 'welcome' || m.t === 'err')) {
          settled = true;
          clearTimeout(deadline);
          if (m.t === 'welcome') sock.accepted?.();
          resolve(m.t === 'welcome');
        }
        this._recv(m);
      };

      sock.onerror = () => { /* onclose carries the outcome */ };

      sock.onclose = (ev) => {
        clearTimeout(deadline);
        if (!mine()) {
          // A socket we already replaced. Settle its promise if it never
          // resolved, and otherwise leave the live connection alone.
          if (!settled) { settled = true; resolve(false); }
          return;
        }
        const wasIn = this.online;
        this.sock = null;
        this._clearPlayers();
        if (!settled) {
          settled = true;
          this._unreachable(resolve, this.error || 'Could not reach the server.');
          return;
        }
        if (this._intentional) { this._intentional = false; this.state = NetState.OFFLINE; this._emit('state', this.state); return; }
        // A room that refused us (bad code, full) must not be retried in a
        // loop — that is a user error, and the lobby should say so.
        if (ev.code >= 4400 || ev.code === 4005 || ev.code === 4004) { this._fail(this.error || 'The server closed the connection.'); return; }
        if (wasIn) this._scheduleRetry(ev.reason || 'Connection lost');
        else this._fail(this.error || 'The server closed the connection.');
      };
    });
  }

  /**
   * The socket did not come up.
   *
   * "Could not reach the server" is a true statement and a dead end: the
   * player has no server, was never told they needed one, and has nothing to
   * click. So a failed *network* attempt falls through to the in-browser hub
   * automatically, which gives them a working code on this computer, and says
   * plainly what that does and does not cover.
   */
  _unreachable(resolve, reason) {
    if (this.local || this._triedLocal) {
      this._fail(this.local
        ? reason
        : `${reason} Co-op needs a server: run "npm run server" on any machine and put its address in.`);
      resolve(false);
      return;
    }
    this._triedLocal = true;
    this.local = true;
    this.error = '';
    this._emit('notice', `${reason} Falling back to co-op on this computer.`, 'warn');
    this._dial().then(resolve);
  }

  _scheduleRetry(reason) {
    this._attempt++;
    this.state = NetState.RETRYING;
    // The code is what we reconnect to, so a retry is always a join even if we
    // originally opened the room.
    this._wantHost = false;
    this._wantCode = this.code || this._wantCode;
    const wait = Math.min(MAX_BACKOFF, 1.2 * Math.pow(1.7, this._attempt - 1));
    this._retryTimer = wait;
    this.error = `${reason}. Reconnecting to ${this.code} in ${wait.toFixed(0)}s…`;
    this._emit('state', this.state);
    this._emit('notice', this.error, 'warn');
    if (this._attempt > MAX_ATTEMPTS) this._fail('Lost the server. Carrying on alone.');
  }

  _fail(msg) {
    this.error = msg;
    this.state = NetState.FAILED;
    this._clearPlayers();
    this._emit('state', this.state);
    this._emit('notice', msg, 'bad');
  }

  disconnect(silent = false) {
    this._intentional = true;
    this._retryTimer = 0;
    this._attempt = 0;
    // Close the socket rather than announcing a departure first: telling the
    // server to hang up and then hanging up ourselves means two close frames
    // cross on the wire, which is a protocol error at both ends.
    if (this.sock) { try { this.sock.close(1000, 'bye'); } catch { /* gone */ } }
    this.sock = null;
    this._clearPlayers();
    this.code = '';
    this.selfId = 0;
    this.isHost = false;
    this.world = null;
    this.local = false;
    this._triedLocal = false;
    this.state = NetState.OFFLINE;
    if (!silent) { this._emit('state', this.state); this._emit('notice', 'Left the co-op game', ''); }
  }

  _clearPlayers() {
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
  }

  /** Re-create every avatar after the world scene has been thrown away. */
  rebindScene() {
    const scene = this.game.scene;
    if (!scene) return;
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
    for (const prof of this.roster.values()) {
      if (prof.id === this.selfId) continue;
      this.players.set(prof.id, new RemotePlayer(prof, scene));
    }
  }

  /* ================= outbound ================= */

  send(obj) {
    const s = this.sock;
    if (!s || s.readyState !== 1) return false;
    try { s.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  setName(name) {
    this.name = String(name || '').slice(0, 18) || 'OPERATOR';
    saveName(this.name);
    this.send({ t: 'name', name: this.name });
  }

  /** Tell the room about a shot so it is heard and seen where it happened. */
  reportShot(from, dir, profile) {
    if (!this.online) return;
    this.send({ t: 'shot', p: [r2(from.x), r2(from.y), r2(from.z)], d: [r3(dir.x), r3(dir.y), r3(dir.z)], w: profile || '' });
  }

  /** Damage on the shared boss goes through the server so it only lands once. */
  reportBossHit(dmg) { if (this.online) this.send({ t: 'bosshit', d: Math.round(dmg * 10) / 10 }); }

  reportDown(cause) { if (this.online) this.send({ t: 'down', cause }); }
  reportAlive(hp) { if (this.online) this.send({ t: 'alive', hp }); }
  revive(id, hp = 35) { if (this.online) this.send({ t: 'revive', id, hp }); }

  /** A map ping: the one piece of communication that works without a mic. */
  ping(pos, label = '') {
    if (!this.online) return;
    this.send({ t: 'evt', k: 'ping', p: [r2(pos.x), r2(pos.y), r2(pos.z)], v: label, self: false });
  }

  say(text) { if (this.online) this.send({ t: 'chat', m: text }); }

  /** The host publishes the shared world whenever it changes underneath it. */
  publishWorld(partial = {}) {
    if (!this.online || !this.isHost) return;
    const g = this.game;
    this.send({
      t: 'world',
      biome: g.biomeId || g.biome?.id,
      depth: g.depth | 0,
      clock: g.time,
      riftOpen: !!g.riftOpen,
      route: g.route,
      ...partial,
    });
  }

  descend(biome, depth) { if (this.online) this.send({ t: 'rift', biome, depth }); }

  /* ================= inbound ================= */

  _recv(m) {
    const g = this.game;
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.id;
        this.code = m.code;
        this.isHost = !!m.host;
        this.hostId = m.hostId;
        this.tickHz = m.tickHz || 15;
        this.localGame = this.isLocal;
        this.world = m.world;
        this._attempt = 0;
        this.error = '';
        // We are in. Any earlier deliberate disconnect is spent: a close from
        // here on is a real one and should reconnect, not quietly go offline.
        this._intentional = false;
        this.roster.clear();
        this.state = NetState.LOBBY;
        for (const p of m.players || []) this.roster.set(p.id, p);
        this._emit('state', this.state);
        this._emit('welcome', m);
        return;
      }
      case 'join': {
        this.roster.set(m.p.id, m.p);
        if (g.scene && !this.players.has(m.p.id)) this.players.set(m.p.id, new RemotePlayer(m.p, g.scene));
        this._emit('notice', `${m.p.name} joined`, 'good');
        this._emit('roster');
        return;
      }
      case 'left': {
        this.roster.delete(m.id);
        this.players.get(m.id)?.dispose();
        this.players.delete(m.id);
        this._emit('notice', `${m.name} left`, '');
        this._emit('roster');
        return;
      }
      case 'host': {
        this.hostId = m.id;
        this.isHost = m.id === this.selfId;
        if (this.isHost) this._emit('notice', 'You are now the host', 'warn');
        this._emit('roster');
        return;
      }
      case 'snap': {
        // Stamped on arrival, not on the next frame: at four frames a second
        // fifteen snapshots share a frame, and a frame-stamped buffer keeps
        // one of them.
        const now_ = (now() - this._t0) / 1000;
        for (const row of m.ps) {
          const id = row[0];
          if (id === this.selfId) continue;
          let p = this.players.get(id);
          if (!p) {
            const prof = this.roster.get(id);
            if (!prof || !g.scene) continue;
            p = new RemotePlayer(prof, g.scene);
            this.players.set(id, p);
          }
          p.push(now_, row[1], row[2], row[3], row[4], row[5], row[6], row[7]);
        }
        return;
      }
      case 'gun': { const p = this.players.get(m.id); if (p) p.weapon = m.w; const r = this.roster.get(m.id); if (r) r.w = m.w; return; }
      case 'reop': { const p = this.players.get(m.id); if (p) p.setOperator(m.op); const r = this.roster.get(m.id); if (r) r.op = m.op; return; }
      case 'named': { const p = this.players.get(m.id); if (p) p.setProfile({ name: m.name }); const r = this.roster.get(m.id); if (r) r.name = m.name; this._emit('roster'); return; }

      case 'shot': { this._remoteShot(m); return; }

      case 'boss': {
        this._emit('boss', m);
        if (g.boss && m.b) { g.boss.netHealth = m.b.health; g.boss.netPhase = m.b.phase; }
        return;
      }
      case 'bossdown': { this._emit('notice', 'The thing is down. A way out has opened.', 'good'); this._emit('bossdown', m); return; }

      case 'world': { this.world = m.world; this._emit('world', m.world); return; }
      case 'rift': {
        this.world = m.world;
        this._emit('notice', 'The party steps through together', 'good');
        this._emit('rift', m.world);
        return;
      }
      case 'riftreq': { if (this.isHost) this._emit('notice', `${m.name} is waiting at the rift`, 'warn'); return; }

      case 'down': {
        const p = this.players.get(m.id);
        if (p) { p.down = true; p.health = 0; p._drawPlate(); }
        this._emit('notice', `${m.name} is down — get to them`, 'bad');
        this._emit('down', m);
        return;
      }
      case 'up': {
        const p = this.players.get(m.id);
        if (p) { p.down = false; p.health = m.hp; p._drawPlate(); }
        if (m.id === this.selfId) this._emit('revived', m);
        else this._emit('notice', 'Back on their feet', 'good');
        return;
      }

      case 'evt': { this._emit('evt', m); if (m.k === 'ping') this._remotePing(m); return; }

      case 'chat': {
        this.chat.push(m);
        if (this.chat.length > 50) this.chat.shift();
        this._emit('chat', m);
        return;
      }

      case 'ping': { this.send({ t: 'pong', n: m.n }); return; }
      case 'err': {
        this.error = m.m || 'The server refused the connection.';
        // A refusal during the handshake is final: mark it now rather than
        // waiting for the close frame, so the lobby can say so immediately.
        if (!this.online) { this.state = NetState.FAILED; this._emit('state', this.state); }
        this._emit('notice', this.error, 'bad');
        return;
      }
      default: /* forward compatible: ignore what we do not know */
    }
  }

  _remoteShot(m) {
    const g = this.game;
    if (!g.fx || !g.scene) return;
    const p = this.players.get(m.id);
    const from = p ? p.muzzle(this._muzzle) : this._muzzle.set(m.p[0], m.p[1], m.p[2]);
    this._hit.set(from.x + m.d[0] * 60, from.y + m.d[1] * 60, from.z + m.d[2] * 60);
    g.fx.tracer(from, this._hit, 0xffd2a0, 0.8);
    Audio.gunshot(m.w || 'ar', from);
  }

  _remotePing(m) {
    if (!m.p) return;
    const who = this.roster.get(m.id)?.name || 'Someone';
    this.game.waypoints?.addNetPing?.(m.p[0], m.p[1], m.p[2], m.v || who);
    this._emit('notice', `${who} marked a spot`, 'warn');
  }

  /* ================= per-frame ================= */

  update(dt) {
    this._clock = (now() - this._t0) / 1000;

    if (this.state === NetState.RETRYING) {
      this._retryTimer -= dt;
      if (this._retryTimer <= 0) { this._intentional = false; this._dial(); }
      return;
    }
    if (!this.online) return;
    if (this.state === NetState.LOBBY && this.game.state === 'PLAYING') {
      this.state = NetState.PLAYING;
      this._emit('state', this.state);
    }

    const g = this.game;
    const cam = g.camera?.position;
    for (const p of this.players.values()) p.update(dt, this._clock, cam);

    this._sendAcc += dt;
    const step = 1 / SEND_HZ;
    if (this._sendAcc < step) return;
    this._sendAcc = 0;
    if (!g.player) return;

    const pl = g.player;
    let f = 0;
    if (pl.crouching) f |= FLAG.CROUCH;
    if (pl.sprinting) f |= FLAG.SPRINT;
    if (g.weapons?.aiming) f |= FLAG.AIM;
    if (g.flashlight?.on) f |= FLAG.LIGHT;
    if (g.stats?.dead) f |= FLAG.DOWN;
    if (pl.inWater) f |= FLAG.WATER;

    const gun = g.weapons?.currentId || '';
    const changed = gun !== this._lastGun;
    this._lastGun = gun;

    this.send({
      t: 'pos',
      p: [r2(pl.position.x), r2(pl.position.y), r2(pl.position.z)],
      y: r3(pl.yaw), pi: r3(pl.pitch), f,
      hp: Math.round(g.stats?.health ?? 100),
      ...(changed ? { w: gun } : {}),
    });

    // The host is the source of truth for the shared clock and the rift; once
    // a second is plenty for something that changes on the scale of minutes.
    if (this.isHost) {
      this._worldAcc = (this._worldAcc || 0) + step;
      if (this._worldAcc > 1) { this._worldAcc = 0; this.publishWorld(); }
    }
  }

  /** The roster as the lobby wants to show it, self included and first. */
  list() {
    const out = [{ id: this.selfId, name: this.name, you: true, host: this.isHost }];
    for (const p of this.roster.values()) {
      if (p.id === this.selfId) continue;
      out.push({ id: p.id, name: p.name, you: false, host: p.id === this.hostId });
    }
    return out;
  }
}

/* ================= helpers ================= */

function normaliseUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return defaultServer();
  if (!/^wss?:\/\//i.test(s)) {
    if (/^https:\/\//i.test(s)) s = s.replace(/^https:/i, 'wss:');
    else if (/^http:\/\//i.test(s)) s = s.replace(/^http:/i, 'ws:');
    else s = (typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss://' : 'ws://') + s;
  }
  // A bare host means the default port and the standard path, so a player can
  // type "coop.example.com" and have it work.
  const u = s.replace(/\/+$/, '');
  if (/\/net$/.test(u)) return u;
  return /^wss?:\/\/[^/]+$/.test(u) ? `${u}/net` : `${u}/net`;
}

function loadName() {
  try { return localStorage.getItem('blackroot.callsign') || `OPERATOR-${Math.floor(Math.random() * 900 + 100)}`; }
  catch { return 'OPERATOR'; }
}
function saveName(n) { try { localStorage.setItem('blackroot.callsign', n); } catch { /* private mode */ } }

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }
