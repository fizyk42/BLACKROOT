// Client networking. Remote players are drawn with the same rig as the local player
// and interpolated between the 20 Hz snapshots the server sends.

import * as THREE from 'three';
import { Character, locomotionFor, OUTFITS } from '../entities/character.js';
import { Vehicle } from '../entities/vehicle.js';
import { damp, dampAngle, angleDiff } from '../core/util.js';
import { store } from '../core/settings.js';

const TOKEN_KEY = 'pa_net_token';

class RemotePlayer {
  constructor(scene, data) {
    this.id = data.id;
    this.name = data.name;
    this.scene = scene;
    this.character = new Character({ outfit: OUTFITS[0] });
    scene.add(this.character.root);
    this.pos = new THREE.Vector3(data.x, data.y, data.z);
    this.target = this.pos.clone();
    this.yaw = data.yaw;
    this.targetYaw = data.yaw;
    this.speed = 0;
    this.anim = 'idle';
    this.vehicle = null;
    this.vehicleSpec = null;
    this.label = makeLabel(data.name);
    this.label.position.y = 2.15;
    this.character.root.add(this.label);
  }

  apply(data, scene) {
    this.target.set(data.x, data.y, data.z);
    this.targetYaw = data.yaw;
    this.speed = data.speed || 0;
    this.anim = data.anim || 'idle';

    if (data.veh && !this.vehicle) {
      this.vehicle = new Vehicle(data.veh.spec, { colour: data.veh.colour });
      this.vehicle.attach(scene);
      this.vehicle.driver = 'remote';
    } else if (!data.veh && this.vehicle) {
      this.vehicle.detach(scene);
      this.vehicle = null;
    }
    if (this.vehicle && data.veh) {
      this.vehicle.targetPos = { x: data.x, z: data.z };
      this.vehicle.targetYaw = data.veh.yaw;
      this.vehicle.speed = data.speed || 0;
    }
    if (data.outfit) {
      const o = OUTFITS.find((x) => x.id === data.outfit);
      if (o && this.character.outfit.id !== o.id) this.character.setOutfit(o, this.character.skin);
    }
  }

  update(dt) {
    // Interpolate toward the last snapshot; 12/s is a good compromise between
    // responsiveness and smoothness at 20 Hz.
    this.pos.x = damp(this.pos.x, this.target.x, 12, dt);
    this.pos.y = damp(this.pos.y, this.target.y, 12, dt);
    this.pos.z = damp(this.pos.z, this.target.z, 12, dt);
    this.yaw = dampAngle(this.yaw, this.targetYaw, 12, dt);

    if (this.vehicle) {
      this.vehicle.pos.set(this.pos.x, 0, this.pos.z);
      this.vehicle.yaw = dampAngle(this.vehicle.yaw, this.vehicle.targetYaw ?? this.yaw, 12, dt);
      this.vehicle.wheelSpin += (this.speed / this.vehicle.spec.wheelR) * dt;
      this.vehicle.syncMesh(dt);
      this.character.root.visible = false;
      this.label.visible = true;
      this.label.position.set(0, 0, 0);
      this.character.root.position.set(this.pos.x, 0.35, this.pos.z);
      this.character.root.visible = false;
    } else {
      this.character.root.visible = true;
      this.character.setPosition(this.pos.x, this.pos.y, this.pos.z);
      this.character.setYaw(this.yaw);
      const loco = locomotionFor(Math.abs(this.speed), false);
      this.character.play(loco.key, 0.2, { speed: loco.speed });
    }
    this.character.update(dt);
  }

  dispose(scene) {
    this.character.dispose(scene);
    if (this.vehicle) this.vehicle.detach(scene);
  }
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(7,16,22,0.75)';
  x.fillRect(0, 14, 256, 36);
  x.fillStyle = '#7fe3cd';
  x.font = '600 24px Helvetica, Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(text).slice(0, 16), 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(1.6, 0.4, 1);
  spr.renderOrder = 30;
  return spr;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.code = null;
    this.host = false;
    this.pvp = false;
    this.roster = [];
    this.remotes = new Map();
    this.name = store.getItem('pa_net_name') || 'Driver';
    this.token = store.getItem(TOKEN_KEY) || null;
    this.wallet = null;
    this.ping = 0;
    this.sendTimer = 0;
    this.log = [];
    this.onLog = () => {};
    this.onRoom = () => {};
    this.onError = () => {};
    this.pendingClaims = new Map();
  }

  remotePlayers() { return [...this.remotes.values()].map((r) => ({ x: r.pos.x, z: r.pos.z, name: r.name })); }

  _log(text, cls = '') {
    this.log.push({ text, cls });
    if (this.log.length > 40) this.log.shift();
    this.onLog(this.log);
  }

  url() {
    const custom = store.getItem('pa_server_url');
    if (custom) return custom;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect(name) {
    return new Promise((resolve, reject) => {
      if (name) { this.name = name; store.setItem('pa_net_name', name); }
      if (this.connected) return resolve();
      let ws;
      try { ws = new WebSocket(this.url()); } catch (e) { return reject(e); }
      this.ws = ws;
      const timeout = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('timeout')); }, 8000);

      ws.onopen = () => {
        this.connected = true;
        this._log('Connected to the server.');
        ws.send(JSON.stringify({ t: 'hello', name: this.name, token: this.token }));
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'welcome') {
          clearTimeout(timeout);
          this.id = m.id;
          this.token = m.token;
          store.setItem(TOKEN_KEY, m.token);
          this.wallet = m.wallet;
          this._log(`Signed in as ${m.name}. Online balance ${m.wallet.money}.`);
          resolve();
        }
        this.handle(m);
      };
      ws.onerror = () => { this._log('Connection error.', 'err'); };
      ws.onclose = () => {
        this.connected = false;
        this.code = null;
        this._log('Disconnected.', 'err');
        this.clearRemotes();
        this.onRoom(null);
      };
    });
  }

  handle(m) {
    const g = this.game;
    switch (m.t) {
      case 'room':
        this.code = m.code;
        this.host = m.host;
        this.pvp = m.pvp;
        this.roster = m.roster;
        this.wallet = m.wallet;
        g.economy.applyAuthoritative(m.wallet);
        this._log(m.created ? `Room created. Code ${m.code}` : `Joined room ${m.code}`);
        this.onRoom({ code: m.code, host: m.host, roster: m.roster, pvp: m.pvp });
        break;

      case 'joined':
        this.roster = m.roster;
        this._log(`${m.name} joined.`);
        g.hud.toast(`${m.name} joined`, 'good');
        this.onRoom({ code: this.code, host: this.host, roster: m.roster, pvp: this.pvp });
        break;

      case 'left': {
        this.roster = m.roster;
        const r = this.remotes.get(m.id);
        if (r) { r.dispose(g.scene); this.remotes.delete(m.id); }
        this._log(`${m.name} left.`);
        g.hud.toast(`${m.name} left`, 'info');
        this.onRoom({ code: this.code, host: this.host, roster: m.roster, pvp: this.pvp });
        break;
      }

      case 'left-room':
        this.code = null;
        this.clearRemotes();
        this.onRoom(null);
        break;

      case 'roster':
        this.roster = m.roster;
        this.onRoom({ code: this.code, host: this.host, roster: m.roster, pvp: this.pvp });
        break;

      case 'snapshot':
        this.applySnapshot(m);
        break;

      case 'chat':
        g.hud.toast(`${m.from}: ${m.text}`, 'info');
        this._log(`${m.from}: ${m.text}`);
        break;

      case 'claim-result': {
        this.wallet = m.wallet;
        g.economy.applyAuthoritative(m.wallet);
        const cb = this.pendingClaims.get(m.id);
        if (cb) { cb(m); this.pendingClaims.delete(m.id); }
        if (!m.ok && m.reason === 'already-claimed') {
          this._log(`Server refused a duplicate reward claim (${m.id}).`, 'err');
        }
        break;
      }

      case 'spend-result':
      case 'buy-result':
      case 'wallet':
        if (m.wallet) { this.wallet = m.wallet; g.economy.applyAuthoritative(m.wallet); }
        if (m.ok === false) g.hud.toast('Server refused: ' + m.reason, 'bad');
        break;

      case 'error':
        this._log('Server: ' + m.message, 'err');
        this.onError(m.message);
        break;

      case 'pong':
        this.ping = Math.round(performance.now() - m.ts);
        break;
    }
  }

  applySnapshot(m) {
    const g = this.game;
    const seen = new Set();
    for (const p of m.players) {
      if (p.id === this.id) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        r = new RemotePlayer(g.scene, p);
        this.remotes.set(p.id, r);
      }
      r.apply(p, g.scene);
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) { r.dispose(g.scene); this.remotes.delete(id); }
    }
  }

  clearRemotes() {
    for (const r of this.remotes.values()) r.dispose(this.game.scene);
    this.remotes.clear();
  }

  createRoom(pvp = false) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ t: 'create', pvp }));
  }

  joinRoom(code) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ t: 'join', code: String(code).trim() }));
  }

  leaveRoom() {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ t: 'leave' }));
  }

  chat(text) {
    if (!this.connected || !this.code) return;
    this.ws.send(JSON.stringify({ t: 'chat', text }));
  }

  /** Ask the server to bank a reward. The server decides the amount and may refuse. */
  claim(id, kind, amount, cb) {
    if (!this.connected) return false;
    if (cb) this.pendingClaims.set(id, cb);
    this.ws.send(JSON.stringify({ t: 'claim', id, kind, amount }));
    return true;
  }

  buyVehicle(id, spec, colour, price) {
    if (!this.connected) return false;
    this.ws.send(JSON.stringify({ t: 'buy-vehicle', id, spec, colour, price }));
    return true;
  }

  spend(amount, reason) {
    if (!this.connected) return false;
    this.ws.send(JSON.stringify({ t: 'spend', amount, reason }));
    return true;
  }

  update(dt) {
    for (const r of this.remotes.values()) r.update(dt);
    if (!this.connected || !this.code) return;

    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 1 / 20;
      const p = this.game.player;
      this.ws.send(JSON.stringify({
        t: 'state',
        x: p.pos.x, y: p.pos.y, z: p.pos.z,
        yaw: p.yaw,
        speed: p.vehicle ? p.vehicle.speed : Math.hypot(p.vel.x, p.vel.z),
        health: p.health,
        anim: p.character.currentName,
        outfit: p.character.outfit.id,
        veh: p.vehicle ? { spec: p.vehicle.spec.id, colour: p.vehicle.colour, yaw: p.vehicle.yaw } : null,
      }));
    }
    this.pingTimer = (this.pingTimer || 0) - dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 3;
      this.ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
    }
  }

  disconnect() {
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.connected = false;
    this.clearRemotes();
  }
}
