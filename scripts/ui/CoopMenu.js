/**
 * CoopMenu — private co-op plus public BLACKROOT Online matchmaking.
 */
import { Audio } from '../core/AudioManager.js';
import { NetState, defaultServer } from '../net/NetClient.js';

const $ = (s) => document.querySelector(s);

export class CoopMenu {
  constructor(game) {
    this.game = game;
    this.net = game.net;
    this.el = {
      root: $('#coop'), status: $('#co-status'), name: $('#co-name'), server: $('#co-server'),
      code: $('#co-code'), codeBox: $('#co-codebox'), codeVal: $('#co-codeval'), roster: $('#co-roster'),
      count: $('#co-count'), chat: $('#co-chatlog'), chatIn: $('#co-chatin'), err: $('#co-err'),
      localRooms: $('#co-localrooms'), squad: $('#squad'), hudChat: $('#netchat'),
    };
    this.chatOpen = false;
    this._hudLines = [];
    this.el.name.value = this.net.name;
    this.el.server.value = loadServer();
    this.el.server.placeholder = defaultServer();
    this._bind(); this._bindNet(); this._renderRoster();
  }

  get open() { return !this.el.root.classList.contains('hidden'); }
  show() { this.el.root.classList.remove('hidden'); this.el.name.value = this.net.name; this._renderStatus(); this._renderRoster(); }
  hide() { this.el.root.classList.add('hidden'); }

  _bind() {
    const on = (sel, fn) => this.el.root.querySelector(sel)?.addEventListener('click', fn);
    on('[data-co="public"]', () => this._public());
    on('[data-co="host"]', () => this._host());
    on('[data-co="join"]', () => this._join());
    on('[data-co="local"]', () => this._host(true));
    on('[data-co="leave"]', () => { this.net.disconnect(); this._renderStatus(); this._renderRoster(); });
    on('[data-co="play"]', () => this._play());
    on('[data-co="copy"]', () => this._copy());
    on('[data-co="say"]', () => this._say());
    this.el.root.querySelector('[data-action="back"]')?.addEventListener('click', () => { Audio.uiClick(); this.hide(); });
    this.el.name.addEventListener('change', () => this.net.setName(this.el.name.value.trim()));
    this.el.server.addEventListener('change', () => saveServer(this.el.server.value.trim()));
    this.el.code.addEventListener('input', () => {
      const v = this.el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (v !== this.el.code.value) this.el.code.value = v;
    });
    this.el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._join(); e.stopPropagation(); });
    this.el.name.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.server.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._say(); e.stopPropagation(); });
  }

  _bindNet() {
    this.net.on('state', () => { this._renderStatus(); this._renderRoster(); });
    this.net.on('roster', () => this._renderRoster());
    this.net.on('welcome', (m) => {
      this._renderStatus(); this._renderRoster();
      if (m.public) {
        this._addChat(null, `Joined BLACKROOT ONLINE · session ${m.code} · ${m.limits.players}-player public world.`);
        this.game.ui.toast('Joined BLACKROOT ONLINE', 'good');
      } else {
        const where = this.net.isLocal ? ' on this computer' : '';
        this._addChat(null, m.host ? `Room ${m.code} is open${where}.` : `Joined ${m.code}${where}.`);
        this.game.ui.toast(m.host ? `Hosting — code ${m.code}` : `Joined ${m.code}`, 'good');
      }
    });
    this.net.on('notice', (msg, kind) => { this._addChat(null, msg); this._pushHud(null, msg); if (kind) this.game.ui.toast(msg, kind); if (kind === 'bad') this.el.err.textContent = msg; });
    this.net.on('chat', (m) => { this._addChat(m.name, m.m, m.id === this.net.selfId); this._pushHud(m.name, m.m); });
    this.net.on('world', () => this._renderStatus());
  }

  async _public() {
    Audio.uiClick();
    this.el.err.textContent = '';
    const url = this.el.server.value.trim() || defaultServer();
    saveServer(url);
    this.net.setName(this.el.name.value.trim() || this.net.name);
    this._renderStatus('FINDING A PUBLIC SESSION…');
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const ok = await this.net.joinPublic(url, { seed, route: this.game.routeFor(seed) });
    if (!ok) { this.el.err.textContent = this.net.error || 'Could not join BLACKROOT ONLINE.'; Audio.denied(); }
    this._renderStatus();
  }

  async _host(local = false) {
    Audio.uiClick(); this.el.err.textContent = '';
    const url = this.el.server.value.trim() || defaultServer(); if (!local) saveServer(url);
    this.net.setName(this.el.name.value.trim() || this.net.name);
    this._renderStatus(local ? 'OPENING A ROOM ON THIS COMPUTER…' : 'OPENING A PRIVATE ROOM…');
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const ok = await this.net.host(url, { seed, route: this.game.routeFor(seed), local });
    if (!ok) this.el.err.textContent = this.net.error || 'Could not open a room.';
    this._renderStatus();
  }

  async _join() {
    Audio.uiClick(); this.el.err.textContent = '';
    const code = this.el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { this.el.err.textContent = 'A game code is six characters.'; Audio.denied(); return; }
    const url = this.el.server.value.trim() || defaultServer(); saveServer(url);
    this.net.setName(this.el.name.value.trim() || this.net.name);
    const here = this.net.localRooms().includes(code);
    this._renderStatus(here ? 'JOINING A GAME ON THIS COMPUTER…' : 'JOINING PRIVATE SESSION…');
    const ok = await this.net.join(url, code, { local: here });
    if (!ok) { this.el.err.textContent = this.net.error || 'Could not join.'; Audio.denied(); }
    this._renderStatus();
  }

  async _play() {
    Audio.uiClick();
    if (!this.net.online) { this.el.err.textContent = 'Join BLACKROOT ONLINE or a private game first.'; Audio.denied(); return; }
    this.hide(); await this.game.startCoop();
  }

  async _copy() {
    Audio.uiClick(); const code = this.net.code; if (!code) return;
    try { await navigator.clipboard.writeText(code); this.game.ui.toast('Code copied', 'good'); } catch { this.game.ui.toast(`Code: ${code}`, ''); }
  }
  _say() { const text = this.el.chatIn.value.trim(); if (!text) return; this.net.say(text); this.el.chatIn.value = ''; }

  _renderStatus(override) {
    const s = this.el.status, n = this.net; let text = override || ''; let cls = 'co-status';
    if (!override) {
      switch (n.state) {
        case NetState.OFFLINE: text = 'NOT CONNECTED'; break;
        case NetState.CONNECTING: text = 'CONNECTING…'; cls += ' warn'; break;
        case NetState.RETRYING: text = 'RECONNECTING…'; cls += ' warn'; break;
        case NetState.FAILED: text = 'DISCONNECTED'; cls += ' bad'; break;
        default:
          text = n.publicSession ? `BLACKROOT ONLINE · ${n.count}/8` : `${n.isHost ? 'HOSTING' : 'CONNECTED'} · ${n.code} · ${n.count}/8${n.isLocal ? ' · THIS COMPUTER' : ''}`;
          cls += n.isLocal ? ' local' : ' live';
      }
    } else cls += ' warn';
    s.textContent = text; s.className = cls;
    const here = this.net.localRooms().filter((c) => c !== n.code);
    this.el.localRooms.textContent = here.length ? `Open on this computer: ${here.join(', ')}` : '';
    const showCode = !!n.code && n.online && !n.publicSession;
    this.el.codeBox.classList.toggle('hidden', !showCode); this.el.codeVal.textContent = n.code || '------';
    if (showCode && !this.el.code.value) this.el.code.value = n.code;
  }

  _renderRoster() {
    const ul = this.el.roster; ul.innerHTML = '';
    if (!this.net.online) {
      const li = document.createElement('li'); li.className = 'co-empty'; li.textContent = 'Nobody yet.'; ul.appendChild(li); this.el.count.textContent = ''; this._renderSquad(); return;
    }
    const list = this.net.list();
    for (const p of list) {
      const li = document.createElement('li'); li.className = p.you ? 'you' : '';
      li.innerHTML = `<span>${esc(p.name)}</span><span class="tagline">${p.host ? 'HOST' : ''}${p.you ? (p.host ? ' · YOU' : 'YOU') : ''}</span>`; ul.appendChild(li);
    }
    this.el.count.textContent = `${list.length}/8`; this._renderSquad();
  }

  _addChat(who, text, mine = false) {
    const d = document.createElement('div');
    if (who) d.innerHTML = `<b>${esc(who)}${mine ? ' (you)' : ''}</b> ${esc(text)}`; else { d.className = 'sys'; d.textContent = text; }
    this.el.chat.appendChild(d); while (this.el.chat.children.length > 80) this.el.chat.removeChild(this.el.chat.firstChild); this.el.chat.scrollTop = this.el.chat.scrollHeight;
  }

  _renderSquad() {
    const box = this.el.squad, n = this.net;
    if (!n.online || !n.players.size) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden'); const me = this.game.player?.position; const rows = [];
    for (const p of n.players.values()) {
      const d = me ? Math.round(p.group.position.distanceTo(me)) : 0; const hp = Math.max(0, Math.min(100, p.health));
      rows.push(`<div class="sq${p.down ? ' down' : ''}"><span class="sq-dist">${me ? d + 'm' : ''}</span><span>${esc(p.name)}</span><span class="sq-bar"><i style="width:${p.down ? 100 : hp}%"></i></span></div>`);
    }
    box.innerHTML = rows.join('');
  }

  _pushHud(who, text) { this._hudLines.push({ who, text, t: 7 }); if (this._hudLines.length > 6) this._hudLines.shift(); this._drawHudChat(); }
  _drawHudChat() {
    const box = this.el.hudChat; const parts = this._hudLines.map((l) => `<div class="line">${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.text)}</div>`);
    if (this.chatOpen) parts.push('<div class="entry"><input id="netchat-in" type="text" maxlength="160" placeholder="Say something…"/></div>');
    const empty = !parts.length; box.classList.toggle('hidden', empty); if (empty) { box.innerHTML = ''; return; } box.innerHTML = parts.join('');
    if (this.chatOpen) {
      const input = box.querySelector('#netchat-in');
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = input.value.trim(); if (v) this.net.say(v); this.closeChat(); } else if (e.key === 'Escape') this.closeChat(); }); input.focus();
    }
  }
  openChat() { if (!this.net.online || this.chatOpen) return false; this.chatOpen = true; this.game.input.exitLock(); this._drawHudChat(); return true; }
  closeChat() { if (!this.chatOpen) return; this.chatOpen = false; this._drawHudChat(); if (this.game.state === 'PLAYING') this.game.input.requestLock(); }
  update(dt) {
    if (!this.net.online) { if (!this.el.squad.classList.contains('hidden')) this._renderSquad(); return; }
    this._squadAcc = (this._squadAcc || 0) + dt; if (this._squadAcc > 0.25) { this._squadAcc = 0; this._renderSquad(); if (this.open) this._renderStatus(); }
    let dirty = false; for (let i = this._hudLines.length - 1; i >= 0; i--) { this._hudLines[i].t -= dt; if (this._hudLines[i].t <= 0) { this._hudLines.splice(i, 1); dirty = true; } } if (dirty) this._drawHudChat();
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function loadServer() { try { return localStorage.getItem('blackroot.server') || defaultServer(); } catch { return defaultServer(); } }
function saveServer(v) { try { localStorage.setItem('blackroot.server', v); } catch {} }
