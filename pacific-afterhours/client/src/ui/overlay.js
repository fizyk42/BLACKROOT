// The pause overlay: map, mission journal, settings, controls and saves.

import { CITY, POIS, DISTRICTS, districtAt } from '../world/citymap.js';
import { settings, saveSettings, PRESETS, DIFFICULTY } from '../core/settings.js';
import { input, ACTIONS } from '../core/input.js';
import { listSaves, deleteSave } from '../core/save.js';
import { fmtMoney, fmtClock } from '../core/util.js';
import { escapeHtml } from './hud.js';

const $ = (id) => document.getElementById(id);

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'journal', label: 'Journal' },
  { id: 'stats', label: 'Progress' },
  { id: 'settings', label: 'Settings' },
  { id: 'controls', label: 'Controls' },
  { id: 'saves', label: 'Saves' },
];

export class Overlay {
  constructor(game) {
    this.game = game;
    this.el = $('overlay');
    this.tabsEl = $('overlay-tabs');
    this.bodyEl = $('overlay-body');
    this.tab = 'map';
    this.open = false;
    this.buildTabs();
  }

  buildTabs() {
    this.tabsEl.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.addEventListener('click', () => { this.tab = t.id; this.render(); });
      this.tabsEl.appendChild(b);
    }
  }

  show(tab) {
    if (tab) this.tab = tab;
    this.open = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  toggle(tab) {
    if (this.open && (!tab || tab === this.tab)) this.hide();
    else this.show(tab);
  }

  render() {
    [...this.tabsEl.children].forEach((b, i) =>
      b.setAttribute('aria-current', TABS[i].id === this.tab ? 'true' : 'false'));
    this.bodyEl.innerHTML = '';
    ({
      map: () => this.renderMap(),
      journal: () => this.renderJournal(),
      stats: () => this.renderStats(),
      settings: () => this.renderSettings(),
      controls: () => this.renderControls(),
      saves: () => this.renderSaves(),
    })[this.tab]();
  }

  // ---------------------------------------------------------------- map
  renderMap() {
    const g = this.game;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<h3>San Aurelio</h3><p>Click anywhere on the map to drop a waypoint. Click the waypoint again to clear it.</p>';
    const canvas = document.createElement('canvas');
    canvas.id = 'bigmap';
    const size = Math.min(this.bodyEl.clientWidth - 8, 640);
    canvas.width = size; canvas.height = size;
    wrap.appendChild(canvas);
    this.bodyEl.appendChild(wrap);

    const span = CITY.PITCH * (CITY.CELLS - 1);
    const pad = 40;
    const s = (size - pad * 2) / span;
    const toPx = (x, z) => [pad + x * s, pad + z * s];

    const c = canvas.getContext('2d');
    c.fillStyle = '#060d12'; c.fillRect(0, 0, size, size);

    // districts
    for (let i = 0; i < CITY.CELLS - 1; i++) {
      for (let j = 0; j < CITY.CELLS - 1; j++) {
        const d = DISTRICTS[districtAt(i, j)];
        c.fillStyle = d.colour;
        c.globalAlpha = 0.35;
        const [x, y] = toPx(i * CITY.PITCH + CITY.KERB_HALF, j * CITY.PITCH + CITY.KERB_HALF);
        const w = (CITY.PITCH - CITY.KERB_HALF * 2) * s;
        c.fillRect(x, y, w, w);
        c.globalAlpha = 1;
      }
    }
    // ocean
    c.fillStyle = '#12303d';
    c.fillRect(0, 0, pad - 6, size);

    // roads
    c.strokeStyle = '#39474f';
    c.lineWidth = Math.max(1.5, CITY.ROAD_HALF * 2 * s);
    c.beginPath();
    for (let i = 0; i < CITY.CELLS; i++) {
      const [x0, y0] = toPx(i * CITY.PITCH, 0);
      const [, y1] = toPx(0, span);
      c.moveTo(x0, y0); c.lineTo(x0, y1);
    }
    for (let j = 0; j < CITY.CELLS; j++) {
      const [x0, y0] = toPx(0, j * CITY.PITCH);
      const [x1] = toPx(span, 0);
      c.moveTo(x0, y0); c.lineTo(x1, y0);
    }
    c.stroke();

    // points of interest
    c.font = '10px Helvetica, Arial, sans-serif';
    for (const p of POIS) {
      const [x, y] = toPx(p.x, p.z);
      c.fillStyle = p.kind === 'police' ? '#7fb4ff' : p.kind === 'hospital' ? '#ff8a8a' : '#ffb347';
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(201,210,214,0.8)';
      c.fillText(p.name, x + 7, y + 3);
    }

    // markers
    for (const m of g.activeMarkers()) {
      const [x, y] = toPx(m.x, m.z);
      c.strokeStyle = '#ff5145'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.stroke();
    }

    // waypoint
    if (g.waypoint) {
      const [x, y] = toPx(g.waypoint.x, g.waypoint.z);
      c.strokeStyle = '#7fe3cd'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x - 7, y - 7); c.lineTo(x + 7, y + 7);
      c.moveTo(x + 7, y - 7); c.lineTo(x - 7, y + 7); c.stroke();
    }

    // player
    const [px, py] = toPx(g.player.pos.x, g.player.pos.z);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#071016'; c.lineWidth = 1.5; c.stroke();

    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (canvas.width / r.width);
      const my = (e.clientY - r.top) * (canvas.height / r.height);
      const wx = (mx - pad) / s, wz = (my - pad) / s;
      if (g.waypoint && Math.hypot(g.waypoint.x - wx, g.waypoint.z - wz) < 25) g.setWaypoint(null);
      else g.setWaypoint({ x: wx, z: wz });
      this.render();
    });
  }

  // ---------------------------------------------------------------- journal
  renderJournal() {
    const g = this.game;
    const entries = g.missions.journal();
    const wrap = document.createElement('div');
    wrap.innerHTML = `<h3>Story</h3><p>Missions 1 to 3 are playable. The rest are written and designed but not built yet — they are listed so you can see where the story goes.</p>`;
    for (const e of entries) {
      const d = document.createElement('div');
      d.className = 'journal-entry' + (e.state === 'done' ? ' done' : '');
      const badge = { done: 'Complete', available: 'Available now', locked: 'Locked', planned: 'Planned — not implemented' }[e.state];
      d.innerHTML = `<h4>${e.number}. ${escapeHtml(e.title)}</h4>
        <span>${escapeHtml(e.blurb)}</span><br>
        <span style="color:${e.state === 'planned' ? '#7d8b93' : e.state === 'available' ? '#ffb347' : '#7fe3cd'}">${badge} · ${fmtMoney(e.reward)}</span>`;
      wrap.appendChild(d);
    }
    this.bodyEl.appendChild(wrap);
  }

  renderStats() {
    const g = this.game;
    const e = g.economy;
    const rows = [
      ['Money', fmtMoney(e.money)],
      ['Total earned', fmtMoney(e.stats.earned)],
      ['Total spent', fmtMoney(e.stats.spent)],
      ['Fines paid', fmtMoney(e.stats.fines)],
      ['Freelance jobs completed', String(e.stats.jobs)],
      ['Missions completed', `${g.missions.completed.size} of 20`],
      ['Film reels found', `${g.jobs.collected.size} of 20`],
      ['Vehicles owned', `${e.vehicleList.length} of ${e.garageCapacity()}`],
      ['Properties', [...e.properties].join(', ') || 'none'],
      ['Businesses', [...e.businesses.keys()].join(', ') || 'none'],
      ['Uncollected business takings', fmtMoney(e.totalAccrued())],
      ['City time', fmtClock(g.sky.hours)],
      ['Weather', g.sky.weatherLabel || '—'],
      ['Wanted level', String(g.police.level)],
    ];
    const wrap = document.createElement('div');
    wrap.innerHTML = '<h3>Progress</h3>' + rows.map(([k, v]) =>
      `<div class="row"><label>${escapeHtml(k)}</label><span>${escapeHtml(v)}</span></div>`).join('');
    this.bodyEl.appendChild(wrap);
  }

  // ---------------------------------------------------------------- settings
  renderSettings() {
    const g = this.game;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<h3>Settings</h3>';
    this.bodyEl.appendChild(wrap);

    const row = (label, hint, controlHtml) => {
      const d = document.createElement('div');
      d.className = 'row';
      d.innerHTML = `<label>${escapeHtml(label)}${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ''}</label>${controlHtml}`;
      wrap.appendChild(d);
      return d;
    };

    const sel = row('Graphics preset', 'Changes shadows, draw distance, traffic and pedestrian counts.',
      `<select>${Object.entries(PRESETS).map(([k, v]) =>
        `<option value="${k}" ${settings.preset === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`);
    sel.querySelector('select').addEventListener('change', (e) => {
      settings.preset = e.target.value; saveSettings(); g.applyGraphics();
      g.hud.toast('Graphics preset applied. Traffic and pedestrian density update immediately; shadow resolution needs a restart.', 'info');
    });

    const res = row('Resolution scale', 'Below 1.0 renders smaller and upscales — the easiest way to gain frames.',
      `<input type="range" min="0.5" max="1.5" step="0.05" value="${settings.resolutionScale}"><span>${settings.resolutionScale.toFixed(2)}</span>`);
    res.querySelector('input').addEventListener('input', (e) => {
      settings.resolutionScale = parseFloat(e.target.value);
      res.querySelector('span').textContent = settings.resolutionScale.toFixed(2);
      saveSettings(); g.applyGraphics();
    });

    const fov = row('Field of view', '', `<input type="range" min="55" max="100" step="1" value="${settings.fov}"><span>${settings.fov}</span>`);
    fov.querySelector('input').addEventListener('input', (e) => {
      settings.fov = parseInt(e.target.value, 10);
      fov.querySelector('span').textContent = settings.fov;
      saveSettings();
    });

    const diff = row('Difficulty', 'Affects damage taken, police response, payouts and job timers.',
      `<select>${Object.entries(DIFFICULTY).map(([k, v]) =>
        `<option value="${k}" ${settings.difficulty === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`);
    diff.querySelector('select').addEventListener('change', (e) => { settings.difficulty = e.target.value; saveSettings(); });

    const traf = row('Traffic density', '', `<input type="range" min="0" max="2" step="0.1" value="${settings.trafficDensity}"><span>${settings.trafficDensity.toFixed(1)}</span>`);
    traf.querySelector('input').addEventListener('input', (e) => {
      settings.trafficDensity = parseFloat(e.target.value);
      traf.querySelector('span').textContent = settings.trafficDensity.toFixed(1);
      saveSettings();
    });

    wrap.insertAdjacentHTML('beforeend', '<hr><h3>Audio</h3>');
    for (const [key, label] of [['masterVolume', 'Master'], ['sfxVolume', 'Effects'], ['musicVolume', 'Music']]) {
      const r = row(label, '', `<input type="range" min="0" max="1" step="0.05" value="${settings[key]}">`);
      r.querySelector('input').addEventListener('input', (e) => {
        settings[key] = parseFloat(e.target.value); saveSettings(); g.audio.applyVolumes();
      });
    }

    wrap.insertAdjacentHTML('beforeend', '<hr><h3>Input</h3>');
    const ms = row('Mouse sensitivity', '', `<input type="range" min="0.2" max="3" step="0.05" value="${settings.mouseSensitivity}">`);
    ms.querySelector('input').addEventListener('input', (e) => { settings.mouseSensitivity = parseFloat(e.target.value); saveSettings(); });
    const ps = row('Controller sensitivity', '', `<input type="range" min="0.2" max="3" step="0.05" value="${settings.padSensitivity}">`);
    ps.querySelector('input').addEventListener('input', (e) => { settings.padSensitivity = parseFloat(e.target.value); saveSettings(); });
    const dz = row('Stick deadzone', '', `<input type="range" min="0" max="0.4" step="0.01" value="${settings.stickDeadzone}">`);
    dz.querySelector('input').addEventListener('input', (e) => { settings.stickDeadzone = parseFloat(e.target.value); saveSettings(); });
    const iv = row('Invert vertical look', '', `<input type="checkbox" ${settings.invertY ? 'checked' : ''}>`);
    iv.querySelector('input').addEventListener('change', (e) => { settings.invertY = e.target.checked; saveSettings(); });
    const pt = row('Controller glyphs', '', `<select>
      <option value="auto" ${settings.padType === 'auto' ? 'selected' : ''}>Detect automatically</option>
      <option value="xbox" ${settings.padType === 'xbox' ? 'selected' : ''}>Xbox</option>
      <option value="playstation" ${settings.padType === 'playstation' ? 'selected' : ''}>PlayStation</option></select>`);
    pt.querySelector('select').addEventListener('change', (e) => { settings.padType = e.target.value; saveSettings(); });

    wrap.insertAdjacentHTML('beforeend', '<hr><h3>Accessibility</h3>');
    const toggles = [
      ['subtitles', 'Subtitles', 'Show spoken dialogue as text.'],
      ['reducedCameraShake', 'Reduce camera shake', 'Cuts screen shake to a quarter.'],
      ['reducedFlashing', 'Reduce flashing', 'Slows police lights and removes strobing.'],
      ['aimAssist', 'Aim assist', 'Tightens weapon spread.'],
      ['holdToSprint', 'Hold to sprint', 'Off means sprint toggles instead.'],
    ];
    for (const [key, label, hint] of toggles) {
      const r = row(label, hint, `<input type="checkbox" ${settings[key] ? 'checked' : ''}>`);
      r.querySelector('input').addEventListener('change', (e) => { settings[key] = e.target.checked; saveSettings(); });
    }
    const ss = row('Subtitle size', '', `<input type="range" min="0.8" max="1.8" step="0.05" value="${settings.subtitleSize}">`);
    ss.querySelector('input').addEventListener('input', (e) => { settings.subtitleSize = parseFloat(e.target.value); saveSettings(); });
  }

  // ---------------------------------------------------------------- controls
  renderControls() {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<h3>Controls</h3><p>Click a binding to change it. Press Escape while listening to cancel. Controllers use the standard layout and are detected automatically.</p>';
    this.bodyEl.appendChild(wrap);

    for (const [action, def] of Object.entries(ACTIONS)) {
      const d = document.createElement('div');
      d.className = 'row';
      const bound = (input.bindings[action] || []).join(', ') || (def.mouse !== undefined ? `Mouse ${def.mouse === 0 ? 'left' : 'right'}` : '—');
      d.innerHTML = `<label>${escapeHtml(def.label)}</label><button class="cta ghost">${escapeHtml(bound)}</button>`;
      const b = d.querySelector('button');
      b.addEventListener('click', () => {
        b.textContent = 'Press a key…';
        input.captureBinding(action, () => this.render());
      });
      wrap.appendChild(d);
    }
    const reset = document.createElement('button');
    reset.className = 'cta';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => { input.resetBindings(); this.render(); });
    wrap.appendChild(reset);
  }

  // ---------------------------------------------------------------- saves
  renderSaves() {
    const g = this.game;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<h3>Saves</h3><p>Story progress, money, vehicles and property are stored in your browser. Online play uses a separate profile held by the server.</p>';
    this.bodyEl.appendChild(wrap);

    for (const s of listSaves()) {
      const d = document.createElement('div');
      d.className = 'row';
      const label = s.empty ? 'Empty'
        : s.corrupt ? 'Unreadable'
          : `${fmtMoney(s.money)} · ${s.missions} missions · ${new Date(s.savedAt).toLocaleString()}`;
      d.innerHTML = `<label>${s.slot}<span class="hint">${escapeHtml(label)}</span></label>
        <span><button class="cta ghost" data-a="save">Save</button>
        <button class="cta ghost" data-a="load" ${s.empty ? 'disabled' : ''}>Load</button>
        <button class="cta ghost" data-a="del" ${s.empty ? 'disabled' : ''}>Delete</button></span>`;
      d.querySelector('[data-a=save]').addEventListener('click', () => {
        const r = g.saveGame(s.slot);
        g.hud.toast(r.ok ? 'Saved.' : 'Save failed: ' + r.error, r.ok ? 'good' : 'bad');
        this.render();
      });
      const lb = d.querySelector('[data-a=load]');
      if (!s.empty) lb.addEventListener('click', () => { this.hide(); g.loadGame(s.slot); });
      const db = d.querySelector('[data-a=del]');
      if (!s.empty) db.addEventListener('click', () => { deleteSave(s.slot); this.render(); });
      wrap.appendChild(d);
    }

    const back = document.createElement('button');
    back.className = 'cta';
    back.textContent = 'Quit to main menu';
    back.addEventListener('click', () => { this.hide(); g.quitToMenu(); });
    wrap.appendChild(back);
  }
}
