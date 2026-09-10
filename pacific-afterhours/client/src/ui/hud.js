// HUD rendering. Everything here is DOM + 2D canvas; nothing touches the 3D scene.

import { fmtMoney, fmtClock, fmtTime, clamp } from '../core/util.js';
import { CITY, POIS, districtAtWorld, DISTRICTS, streetNameAt } from '../world/citymap.js';
import { settings } from '../core/settings.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      root: $('hud'),
      minimap: $('minimap'),
      wanted: $('wanted'),
      health: $('healthfill'),
      stamina: $('staminafill'),
      cash: $('cash'),
      clock: $('clock'),
      weather: $('weather'),
      objective: $('objective'),
      objTitle: $('objective-title'),
      objText: $('objective-text'),
      objTimer: $('objective-timer'),
      speedo: $('speedo'),
      speedoCanvas: $('speedo-canvas'),
      gear: $('gear'),
      weaponbox: $('weaponbox'),
      weaponName: $('weaponname'),
      ammo: $('ammo'),
      prompt: $('prompt'),
      crosshair: $('crosshair'),
      subtitle: $('subtitle'),
      toasts: $('toasts'),
      bigmsg: $('bigmsg'),
      roster: $('netroster'),
    };
    this.mm = this.el.minimap.getContext('2d');
    this.sp = this.el.speedoCanvas.getContext('2d');
    this.lastCash = null;
    this.subtitleTimer = 0;
    this.mmScale = 0.22;   // metres -> pixels
  }

  show() { this.el.root.classList.remove('hidden'); }
  hide() { this.el.root.classList.add('hidden'); }

  toast(text, tone = 'info') {
    const d = document.createElement('div');
    d.className = 'toast ' + (tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : '');
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => {
      d.style.transition = 'opacity .4s';
      d.style.opacity = '0';
      setTimeout(() => d.remove(), 420);
    }, 3600);
  }

  subtitle(speaker, text, seconds = 3) {
    if (!settings.subtitles) return;
    const el = this.el.subtitle;
    el.innerHTML = speaker ? `<b>${speaker}:</b> ${escapeHtml(text)}` : escapeHtml(text);
    el.style.fontSize = (19 * settings.subtitleSize) + 'px';
    el.classList.remove('hidden');
    this.subtitleTimer = seconds;
  }

  bigMessage(title, sub, seconds = 3) {
    const el = this.el.bigmsg;
    el.innerHTML = `<h1>${escapeHtml(title)}</h1>${sub ? `<p>${escapeHtml(sub)}</p>` : ''}`;
    el.classList.remove('hidden');
    if (seconds > 0) {
      clearTimeout(this._bigTimer);
      this._bigTimer = setTimeout(() => el.classList.add('hidden'), seconds * 1000);
    }
  }
  hideBigMessage() { this.el.bigmsg.classList.add('hidden'); }

  setObjective(title, text, hint) {
    if (!text && !hint) { this.el.objective.classList.add('hidden'); return; }
    this.el.objective.classList.remove('hidden');
    this.el.objTitle.textContent = title || '';
    this.el.objText.textContent = text || hint || '';
    this.el.objTimer.textContent = '';
  }

  setTimer(seconds, limit) {
    if (!seconds || seconds <= 0) { this.el.objTimer.textContent = ''; return; }
    this.el.objTimer.textContent = fmtTime(seconds);
    this.el.objTimer.classList.toggle('urgent', limit > 0 && seconds < limit * 0.25);
  }

  setPrompt(html) {
    if (!html) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.remove('hidden');
  }

  setRoster(lines) {
    if (!lines || !lines.length) { this.el.roster.classList.add('hidden'); return; }
    this.el.roster.classList.remove('hidden');
    this.el.roster.innerHTML = lines.join('<br>');
  }

  update(dt, g) {
    const p = g.player;

    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.el.subtitle.classList.add('hidden');
    }

    this.el.health.style.width = clamp(p.health / p.maxHealth * 100, 0, 100) + '%';
    this.el.stamina.style.width = clamp(p.stamina, 0, 100) + '%';

    const money = Math.round(g.economy.money);
    if (money !== this.lastCash) {
      this.el.cash.textContent = fmtMoney(money);
      if (this.lastCash !== null) {
        this.el.cash.classList.remove('flash');
        void this.el.cash.offsetWidth;
        this.el.cash.classList.add('flash');
      }
      this.lastCash = money;
    }

    this.el.clock.textContent = fmtClock(g.sky.hours);
    const district = DISTRICTS[districtAtWorld(p.pos.x, p.pos.z)];
    this.el.weather.textContent = `${g.sky.weatherLabel || 'Clear'} · ${streetNameAt(p.pos.x, p.pos.z)} · ${district ? district.name : ''}`;

    // Wanted stars.
    const stars = g.police.level;
    this.el.wanted.textContent = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '';

    // Vehicle instruments.
    if (p.vehicle) {
      this.el.speedo.classList.remove('hidden');
      this.drawSpeedo(p.vehicle);
      this.el.gear.textContent = p.vehicle.gear;
      this.el.weaponbox.classList.add('hidden');
      this.el.crosshair.classList.add('hidden');
    } else {
      this.el.speedo.classList.add('hidden');
      const w = p.weapons[p.weapon];
      if (p.weapon !== 'fists' && w) {
        this.el.weaponbox.classList.remove('hidden');
        this.el.weaponName.textContent = g.weaponName(p.weapon);
        this.el.ammo.textContent = `${w.ammo} / ${w.reserve}`;
      } else this.el.weaponbox.classList.add('hidden');
      this.el.crosshair.classList.toggle('hidden', !p.aiming);
    }

    this.drawMinimap(g);
  }

  drawSpeedo(v) {
    const c = this.sp, W = 260, H = 150;
    c.clearRect(0, 0, W, H);
    const cx = 120, cy = 120, r = 88;
    const maxKmh = v.spec.topSpeed * 3.6 * 1.12;
    const kmh = Math.abs(v.speed) * 3.6;

    // dial
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(201,210,214,0.22)';
    c.beginPath(); c.arc(cx, cy, r, Math.PI, Math.PI * 2); c.stroke();

    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI;
      const inner = i % 2 === 0 ? r - 13 : r - 7;
      c.strokeStyle = i >= 8 ? 'rgba(255,81,69,0.75)' : 'rgba(201,210,214,0.45)';
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      c.stroke();
    }

    // needle
    const t = clamp(kmh / maxKmh, 0, 1);
    const a = Math.PI + t * Math.PI;
    c.strokeStyle = '#ffb347';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
    c.stroke();
    c.fillStyle = '#ffb347';
    c.beginPath(); c.arc(cx, cy, 4.5, 0, Math.PI * 2); c.fill();

    // readout
    c.fillStyle = '#ffffff';
    c.font = '600 30px ui-monospace, Consolas, monospace';
    c.textAlign = 'center';
    c.fillText(String(Math.round(kmh)), cx, cy - 22);
    c.font = '300 11px Helvetica, Arial, sans-serif';
    c.fillStyle = '#7d8b93';
    c.fillText('KM/H', cx, cy - 8);

    // damage bar
    const dw = 150;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(cx - dw / 2, cy + 14, dw, 4);
    c.fillStyle = v.health > 55 ? '#7fe3cd' : v.health > 25 ? '#ffb347' : '#ff5145';
    c.fillRect(cx - dw / 2, cy + 14, dw * (v.health / 100), 4);
  }

  drawMinimap(g) {
    const c = this.mm, S = 220;
    const p = g.player.pos;
    const yaw = g.player.vehicle ? g.player.vehicle.yaw : g.player.camYaw;
    const scale = this.mmScale * (g.player.vehicle ? 0.78 : 1);

    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.rect(0, 0, S, S); c.clip();
    c.fillStyle = '#060d12'; c.fillRect(0, 0, S, S);

    c.translate(S / 2, S / 2);
    c.rotate(yaw);             // rotate the world so the player always faces up
    c.translate(-p.x * scale, p.z * scale);

    const view = S / scale;
    const i0 = Math.floor((p.x - view) / CITY.PITCH), i1 = Math.ceil((p.x + view) / CITY.PITCH);
    const j0 = Math.floor((p.z - view) / CITY.PITCH), j1 = Math.ceil((p.z + view) / CITY.PITCH);

    // blocks
    c.fillStyle = '#131d25';
    for (let i = Math.max(0, i0); i <= Math.min(CITY.CELLS - 2, i1); i++) {
      for (let j = Math.max(0, j0); j <= Math.min(CITY.CELLS - 2, j1); j++) {
        const x = (i * CITY.PITCH + CITY.KERB_HALF) * scale;
        const z = -(j * CITY.PITCH + CITY.KERB_HALF) * scale;
        const w = (CITY.PITCH - CITY.KERB_HALF * 2) * scale;
        c.fillRect(x, z - w, w, w);
      }
    }

    // roads
    c.strokeStyle = '#2f3d47';
    c.lineWidth = CITY.ROAD_HALF * 2 * scale;
    c.beginPath();
    for (let i = Math.max(0, i0); i <= Math.min(CITY.CELLS - 1, i1); i++) {
      c.moveTo(i * CITY.PITCH * scale, 0);
      c.lineTo(i * CITY.PITCH * scale, -(CITY.CELLS - 1) * CITY.PITCH * scale);
    }
    for (let j = Math.max(0, j0); j <= Math.min(CITY.CELLS - 1, j1); j++) {
      c.moveTo(0, -j * CITY.PITCH * scale);
      c.lineTo((CITY.CELLS - 1) * CITY.PITCH * scale, -j * CITY.PITCH * scale);
    }
    c.stroke();

    // points of interest
    for (const poi of POIS) {
      const dx = poi.x - p.x, dz = poi.z - p.z;
      if (Math.hypot(dx, dz) > view) continue;
      c.fillStyle = poi.kind === 'police' ? '#7fb4ff' : poi.kind === 'hospital' ? '#ff8a8a' : '#c9d2d6';
      c.fillRect(poi.x * scale - 2, -poi.z * scale - 2, 4, 4);
    }

    // traffic
    c.fillStyle = '#5d6d78';
    for (const v of g.allVehicles()) {
      if (v === g.player.vehicle) continue;
      const dx = v.pos.x - p.x, dz = v.pos.z - p.z;
      if (Math.hypot(dx, dz) > view) continue;
      c.fillRect(v.pos.x * scale - 1.5, -v.pos.z * scale - 1.5, 3, 3);
    }

    // police
    c.fillStyle = '#4b8cff';
    for (const u of g.police.units) {
      c.beginPath();
      c.arc(u.vehicle.pos.x * scale, -u.vehicle.pos.z * scale, 3, 0, Math.PI * 2);
      c.fill();
    }

    // markers (jobs, missions)
    for (const m of g.activeMarkers()) {
      c.fillStyle = '#ffb347';
      c.beginPath();
      c.arc(m.x * scale, -m.z * scale, 4.5, 0, Math.PI * 2);
      c.fill();
    }

    // remote players
    for (const r of g.net.remotePlayers()) {
      c.fillStyle = '#7fe3cd';
      c.beginPath();
      c.arc(r.x * scale, -r.z * scale, 4, 0, Math.PI * 2);
      c.fill();
    }

    c.restore();

    // player arrow, always centred and pointing up
    c.save();
    c.translate(S / 2, S / 2);
    c.fillStyle = '#ffb347';
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6);
    c.closePath(); c.fill();
    c.restore();

    // north indicator
    c.save();
    c.translate(S - 18, 18);
    c.rotate(yaw);
    c.fillStyle = '#ff5145';
    c.beginPath(); c.moveTo(0, -8); c.lineTo(3.5, 2); c.lineTo(-3.5, 2); c.closePath(); c.fill();
    c.restore();
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
