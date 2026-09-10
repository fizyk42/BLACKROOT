// Main menu, including the online lobby panel.

import { listSaves } from '../core/save.js';
import { settings, saveSettings, PRESETS, store } from '../core/settings.js';
import { fmtMoney } from '../core/util.js';
import { escapeHtml } from './hud.js';

const $ = (id) => document.getElementById(id);

export class Menu {
  constructor(game) {
    this.game = game;
    this.el = $('menu');
    this.panel = $('menupanel');
    this.buttons = [...$('mainmenu').querySelectorAll('button')];
    this.tab = 'story';
    for (const b of this.buttons) {
      b.addEventListener('click', () => this.select(b.dataset.act));
    }
    this.select('story');
  }

  show() { this.el.classList.remove('hidden'); this.select(this.tab); }
  hide() { this.el.classList.add('hidden'); }

  select(act) {
    this.tab = act;
    for (const b of this.buttons) b.setAttribute('aria-current', b.dataset.act === act ? 'true' : 'false');
    this.panel.innerHTML = '';
    ({
      story: () => this.renderStory(),
      freeroam: () => this.renderFreeRoam(),
      online: () => this.renderOnline(),
      settings: () => this.renderSettings(),
      quit: () => this.renderQuit(),
    })[act]();
  }

  cta(label, onClick, ghost = false, disabled = false) {
    const b = document.createElement('button');
    b.className = 'cta' + (ghost ? ' ghost' : '');
    b.textContent = label;
    if (disabled) b.setAttribute('disabled', '');
    else b.addEventListener('click', onClick);
    this.panel.appendChild(b);
    return b;
  }

  renderStory() {
    const saves = listSaves().filter((s) => !s.empty && !s.corrupt);
    this.panel.innerHTML = `
      <h3>Story Mode</h3>
      <p>Alex Vega comes home to San Aurelio to find the family garage two months from closing.
      Twenty missions are written; the first three are playable now, and the journal is honest
      about which is which.</p>
      <p>Start a new game, or continue from a save.</p>`;
    this.cta('New game', () => this.game.startGame('story'));
    for (const s of saves) {
      this.cta(`Continue — ${s.slot} · ${fmtMoney(s.money)} · ${s.missions} missions`,
        () => this.game.startGame('story', s.slot), true);
    }
    if (!saves.length) {
      this.panel.insertAdjacentHTML('beforeend', '<p style="margin-top:1rem">No saves yet.</p>');
    }
  }

  renderFreeRoam() {
    this.panel.innerHTML = `
      <h3>Free Roam</h3>
      <p>The whole city, no story. You start with twenty-five thousand, a fast car and a sidearm.
      Freelance work, races and the police system are all active.</p>`;
    this.cta('Start free roam', () => this.game.startGame('freeroam'));
  }

  renderOnline() {
    const g = this.game;
    const needsServer = document.body.dataset.hosted === 'true' || location.protocol === 'pacific:';
    this.panel.innerHTML = `
      <h3>Online</h3>
      ${needsServer ? '<p>A shared multiplayer server is required. Story Mode and Free Roam work immediately; online rooms are available when you connect a server.</p><div class="row"><label for="server-address">Server address</label><input id="server-address" type="url" placeholder="wss://your-server.example/ws"></div><p id="server-status" role="status"></p>' : ''}
      <p>Two to eight players share one city. One player hosts and reads out the six-digit code;
      everyone else types it in. Money, jobs and vehicle ownership are decided by the server,
      not by your browser.</p>
      <div class="row">
        <label>Your name</label>
        <input type="text" id="net-name" maxlength="20" value="${escapeHtml(g.net.name)}">
      </div>
      <div class="row">
        <label>Allow player versus player<span class="hint">Host only. Off by default.</span></label>
        <input type="checkbox" id="net-pvp">
      </div>
      <div id="net-actions"></div>
      <div class="row"><label>Join with a code</label>
        <input class="code-in" id="net-code" inputmode="numeric" maxlength="6" placeholder="000000"></div>
      <div id="net-join"></div>
      <div id="net-room"></div>
      <div class="netlog" id="net-log"></div>`;

    if (needsServer) {
      const serverInput = $('server-address');
      serverInput.value = store.getItem('pa_server_url') || '';
      serverInput.addEventListener('change', () => {
        const value = serverInput.value.trim();
        try {
          if (value && !['ws:', 'wss:'].includes(new URL(value).protocol)) throw new Error();
          if (location.protocol === 'https:' && value && !value.startsWith('wss://')) throw new Error();
          store.setItem('pa_server_url', value);
          g.net.disconnect();
          $('server-status').textContent = value ? 'Server saved. You can now host or join a room.' : 'Enter a shared server address to play online.';
        } catch { $('server-status').textContent = 'Enter a valid WebSocket URL (wss://).'; }
      });
    }
    const logEl = $('net-log');
    const paint = (lines) => {
      logEl.innerHTML = lines.map((l) => `<div class="${l.cls}">${escapeHtml(l.text)}</div>`).join('');
      logEl.scrollTop = logEl.scrollHeight;
    };
    g.net.onLog = paint;
    paint(g.net.log);

    const actions = $('net-actions');
    const hostBtn = document.createElement('button');
    hostBtn.className = 'cta';
    hostBtn.textContent = 'Host a room';
    hostBtn.addEventListener('click', async () => {
      if (needsServer && !store.getItem('pa_server_url')) { g.net._log('Enter a shared server address first.', 'err'); return; }
      hostBtn.disabled = true;
      hostBtn.textContent = 'Connecting…';
      try {
        await g.net.connect($('net-name').value.trim() || 'Driver');
        g.net.createRoom($('net-pvp').checked);
      } catch (e) {
        g.net._log('Could not reach the server. Check the server address and try again.', 'err');
      }
      hostBtn.disabled = false;
      hostBtn.textContent = 'Host a room';
    });
    actions.appendChild(hostBtn);

    const joinWrap = $('net-join');
    const joinBtn = document.createElement('button');
    joinBtn.className = 'cta ghost';
    joinBtn.textContent = 'Join room';
    joinBtn.addEventListener('click', async () => {
      const code = ($('net-code').value || '').trim();
      if (!/^\d{6}$/.test(code)) { g.net._log('A room code is exactly six digits.', 'err'); return; }
      if (needsServer && !store.getItem('pa_server_url')) { g.net._log('Enter a shared server address first.', 'err'); return; }
      joinBtn.disabled = true;
      try {
        await g.net.connect($('net-name').value.trim() || 'Driver');
        g.net.joinRoom(code);
      } catch (e) {
        g.net._log('Could not reach the server. Check the server address and try again.', 'err');
      }
      joinBtn.disabled = false;
    });
    joinWrap.appendChild(joinBtn);

    const roomEl = $('net-room');
    g.net.onRoom = (room) => {
      if (!room) { roomEl.innerHTML = ''; return; }
      roomEl.innerHTML = `
        <hr>
        <p>Room code — read this out to the others:</p>
        <div class="roomcode">${room.code}</div>
        <p>${room.roster.length} of 8 in the city${room.pvp ? ' · PvP on' : ' · PvP off'}</p>
        <div>${room.roster.map((r) => `<div class="row"><label>${escapeHtml(r.name)}${r.host ? ' (host)' : ''}</label><span>${fmtMoney(r.money)}</span></div>`).join('')}</div>`;
      const enter = document.createElement('button');
      enter.className = 'cta';
      enter.textContent = 'Enter the city';
      enter.addEventListener('click', () => g.startGame('online'));
      roomEl.appendChild(enter);
    };
    g.net.onError = (msg) => {
      const human = {
        'no-such-room': 'No room with that code. Check the digits and that the host is still connected.',
        'room-full': 'That room already has eight players.',
        'server-full': 'The server is at capacity.',
      }[msg] || msg;
      g.net._log(human, 'err');
    };
  }

  renderSettings() {
    this.panel.innerHTML = `
      <h3>Settings</h3>
      <p>The full settings list — graphics, audio, input, accessibility and key bindings — is
      inside the pause menu once you are in the city. The essentials are here.</p>
      <div class="row"><label>Graphics preset<span class="hint">Start Low if you are unsure, then work up.</span></label>
        <select id="m-preset">${Object.entries(PRESETS).map(([k, v]) =>
    `<option value="${k}" ${settings.preset === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="row"><label>Resolution scale</label>
        <input type="range" id="m-res" min="0.5" max="1.5" step="0.05" value="${settings.resolutionScale}"></div>
      <div class="row"><label>Subtitles</label>
        <input type="checkbox" id="m-subs" ${settings.subtitles ? 'checked' : ''}></div>
      <div class="row"><label>Reduce camera shake</label>
        <input type="checkbox" id="m-shake" ${settings.reducedCameraShake ? 'checked' : ''}></div>`;
    $('m-preset').addEventListener('change', (e) => { settings.preset = e.target.value; saveSettings(); });
    $('m-res').addEventListener('input', (e) => { settings.resolutionScale = parseFloat(e.target.value); saveSettings(); });
    $('m-subs').addEventListener('change', (e) => { settings.subtitles = e.target.checked; saveSettings(); });
    $('m-shake').addEventListener('change', (e) => { settings.reducedCameraShake = e.target.checked; saveSettings(); });
  }

  renderQuit() {
    this.panel.innerHTML = `
      <h3>Quit</h3>
      <p>A browser cannot close a tab it did not open, so this button may do nothing depending on
      your browser. Closing the tab is the reliable way out. Your progress is already saved.</p>`;
    this.cta('Close the tab', () => { window.close(); }, true);
  }
}
