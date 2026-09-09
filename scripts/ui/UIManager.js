/**
 * UIManager — all DOM: HUD, prompts, toasts, compass, inventory, boot
 * sequence, menus, settings, note reader and the death screen.
 *
 * The renderer never draws UI, which keeps text crisp at any resolution and
 * makes the HUD trivially restyleable.
 */
import { Settings, QUALITY_PRESETS, DEFAULTS } from '../core/Settings.js';
import { Audio } from '../core/AudioManager.js';
import { ITEMS } from '../systems/ItemDatabase.js';
import { BINDINGS, PAD_BINDINGS, Input } from '../core/Input.js';
import { Pad, BUTTON_LAYOUTS, STICK_LAYOUTS } from '../core/Gamepad.js';

const $ = (s) => document.querySelector(s);

/**
 * Four-component vector and 4x4 matrix, just enough to project a world point
 * to the screen. The UI layer deliberately does not import three: it is the
 * one part of the game that has to keep working if the renderer does not.
 */
class Vec4 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; this.w = 1; return this; }
  applyMatrix4(m) {
    const { x, y, z } = this, e = m.elements;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const iw = w === 0 ? 1 : 1 / w;
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * iw;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * iw;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * iw;
    this.w = w;
    return this;
  }
}
class Mat4 {
  constructor() { this.elements = new Float64Array(16); }
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    for (let c = 0; c < 4; c++) {
      const b0 = be[c * 4], b1 = be[c * 4 + 1], b2 = be[c * 4 + 2], b3 = be[c * 4 + 3];
      for (let r = 0; r < 4; r++) {
        te[c * 4 + r] = ae[r] * b0 + ae[4 + r] * b1 + ae[8 + r] * b2 + ae[12 + r] * b3;
      }
    }
    return this;
  }
}
const $$ = (s) => Array.from(document.querySelectorAll(s));

const LOAD_TIPS = [
  'They do not like the light. Keep the lamp on, even when it feels wasteful.',
  'Ammunition does not grow in the forest. Berries do.',
  'Crouching in cover makes you very hard to see, and almost impossible to hear.',
  'A Screamer is barely a threat by itself. That is not the problem with Screamers.',
  'Brutes cannot corner. Trees can.',
  'The radio tower light turns all night. If you can see it, you are not lost.',
  'Bleeding will kill you slowly while you are busy being killed quickly.',
  'Shotguns are for the first metre. Rifles are for everything past thirty.',
  'Do not drink from the creek unless you have to.',
];

export class UIManager {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('#hud'), boot: $('#boot'), menu: $('#mainmenu'), pause: $('#pause'),
      settings: $('#settings'), credits: $('#credits'), death: $('#death'),
      armoury: $('#armoury'), coop: $('#coop'),
      loading: $('#loading'), inventory: $('#inventory'), reader: $('#reader'),
      prompt: $('#interact-prompt'), promptText: $('#interact-text'),
      barHealth: $('#bar-health'), barStamina: $('#bar-stamina'),
      barHunger: $('#bar-hunger'), barThirst: $('#bar-thirst'),
      weaponName: $('#weapon-name'), ammoMag: $('#ammo-mag'), ammoRes: $('#ammo-res'),
      ammoLine: $('#ammo-line'), fireMode: $('#fire-mode'),
      quickbar: $('#quickbar'), toasts: $('#toasts'), subtitles: $('#subtitles'),
      objective: $('#objective-text'), compassStrip: $('#compass-strip'),
      crosshair: $('#crosshair'), hitmarker: $('#hitmarker'), fps: $('#fps-counter'),
      damageFlash: $('#damage-flash'), lowHealth: $('#lowhealth'),
      loadFill: $('#load-fill'), loadStep: $('#load-step'), loadTip: $('#load-tip'),
      invGrid: $('#inv-grid'), invDetail: $('#inv-detail'), invWeight: $('#inv-weight'),
      deathCause: $('#death-cause'), deathStats: $('#death-stats'),
      noteTitle: $('#note-title'), noteBody: $('#note-body'),
      seedTag: $('#seed-tag'), pauseStats: $('#pause-stats'),
      btnContinue: $('#btn-continue'), btnDeathLoad: $('#btn-death-load'),
      fatal: $('#fatal'), fatalMsg: $('#fatal-msg'),
      bossbar: $('#bossbar'), biomeCard: $('#biome-card'),
      wpLayer: $('#waypoint-layer'),
      lookEdge: $('#lookedge'),
    };
    this._toasts = [];
    this._subtitleTimer = 0;
    this._settingsReturn = 'menu';
    this.selectedItem = null;
    this.buildQuickbar();
    this.bindMenus();
    this.buildSettings('graphics');
  }

  /* ================= boot sequence ================= */

  async runBootSequence() {
    const stages = ['#splash-studio', '#splash-notice', '#splash-title'];
    const el = (s) => document.querySelector(s);
    const wait = (ms) => new Promise((r) => {
      const t = setTimeout(r, ms);
      const skip = () => { clearTimeout(t); cleanup(); r(); };
      const cleanup = () => {
        window.removeEventListener('keydown', skip);
        window.removeEventListener('mousedown', skip);
      };
      window.addEventListener('keydown', skip);
      window.addEventListener('mousedown', skip);
      setTimeout(cleanup, ms + 20);
    });

    for (let i = 0; i < stages.length; i++) {
      const s = el(stages[i]);
      s.classList.remove('hidden');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      s.classList.add('in');
      await wait(i === 1 ? 5200 : 2600);
      s.classList.remove('in');
      await wait(750);
      s.classList.add('hidden');
    }
    this.el.boot.classList.add('hidden');
    this.showMainMenu();
  }

  /* ================= screen switching ================= */

  hideAll() {
    for (const k of ['menu', 'pause', 'settings', 'credits', 'death', 'loading', 'inventory', 'reader', 'coop']) {
      this.el[k].classList.add('hidden');
    }
  }

  /** Called between biomes: nothing from the last place should linger. */
  resetRunHud() {
    this.hideBossBar();
    this.el.biomeCard.classList.add('hidden');
    this.el.biomeCard.classList.remove('show');
  }

  showMainMenu() {
    this.hideAll();
    this.el.hud.classList.add('hidden');
    this.el.menu.classList.remove('hidden');
    document.body.classList.remove('playing');
    this.el.btnContinue.disabled = !this.game.save.hasSave();
    this.el.seedTag.textContent = this.game.seedLabel ? 'SEED ' + this.game.seedLabel : '';
  }

  showLoading(label) {
    this.hideAll();
    this.el.loading.classList.remove('hidden');
    this.el.loadTip.textContent = LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];
    this.setLoadProgress(0, label || 'Preparing');
  }

  setLoadProgress(p, label) {
    this.el.loadFill.style.width = Math.round(p * 100) + '%';
    if (label) this.el.loadStep.textContent = label.toUpperCase();
  }

  showHUD() {
    this.hideAll();
    this.el.hud.classList.remove('hidden');
    document.body.classList.add('playing');
  }

  showPause() {
    this.el.pause.classList.remove('hidden');
    document.body.classList.remove('playing');
    const s = this.game.stats;
    this.el.pauseStats.textContent =
      `${Math.floor(s.timeAlive / 60)}m ${Math.floor(s.timeAlive % 60)}s survived · ${s.kills} killed · ` +
      `${Math.round(s.distance)} m travelled · ${s.landmarksFound}/${this.game.world.landmarks.length} landmarks`;
  }

  hidePause() {
    this.el.pause.classList.add('hidden');
    document.body.classList.add('playing');
  }

  showSettings(from) {
    this._settingsReturn = from;
    this.el.settings.classList.remove('hidden');
  }

  showCredits() { this.el.credits.classList.remove('hidden'); }

  showDeath(cause) {
    this.hideAll();
    this.el.hud.classList.add('hidden');
    this.el.death.classList.remove('hidden');
    document.body.classList.remove('playing');
    this.el.deathCause.textContent = cause ? `KILLED BY ${String(cause).toUpperCase()}` : '';
    const s = this.game.stats;
    const acc = s.shotsFired ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0;
    this.el.deathStats.innerHTML =
      `Survived ${Math.floor(s.timeAlive / 60)} minutes ${Math.floor(s.timeAlive % 60)} seconds<br/>` +
      `${s.kills} creatures killed · ${acc}% of shots on target<br/>` +
      `${Math.round(s.distance)} metres walked · ${s.itemsLooted} items scavenged<br/>` +
      `${s.landmarksFound} of ${this.game.world.landmarks.length} landmarks found`;
    this.el.btnDeathLoad.disabled = !this.game.save.hasSave();
  }

  showNote(note) {
    this.el.noteTitle.textContent = note.title;
    this.el.noteBody.innerHTML = escapeHtml(note.text) + (note.sig ? `<span class="sig">${escapeHtml(note.sig)}</span>` : '');
    this.el.reader.classList.remove('hidden');
    document.body.classList.remove('playing');
    this.game.setPaused(true, 'reader');
  }

  closeNote() {
    this.el.reader.classList.add('hidden');
    this.game.setPaused(false, 'reader');
    document.body.classList.add('playing');
  }

  fatal(msg) {
    this.el.fatal.classList.remove('hidden');
    this.el.fatalMsg.textContent = msg;
  }

  /* ================= HUD ================= */

  buildQuickbar() {
    this.el.quickbar.innerHTML = '';
    this.quickEls = [];
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'qslot empty';
      d.innerHTML = `<span class="qnum">${i + 1}</span><span class="qico"></span><span class="qcount"></span>`;
      this.el.quickbar.appendChild(d);
      this.quickEls.push(d);
    }
  }

  updateQuickbar() {
    const inv = this.game.inventory;
    for (let i = 0; i < 5; i++) {
      const id = inv.quick[i];
      const el = this.quickEls[i];
      const item = id ? ITEMS[id] : null;
      const count = id ? inv.count(id) : 0;
      el.classList.toggle('empty', !item || count === 0);
      el.classList.toggle('active', !!id && id === inv.equipped);
      el.querySelector('.qico').textContent = item ? item.icon : '';
      el.querySelector('.qcount').textContent = item && item.stack > 1 ? count : '';
    }
  }

  updateHUD(dt) {
    this.updateLookEdge();
    const s = this.game.stats;
    const w = this.game.weapons;
    const set = (el, v, crit) => {
      el.style.width = Math.max(0, Math.min(100, v * 100)) + '%';
      el.parentElement.classList.toggle('crit', crit);
    };
    set(this.el.barHealth, s.healthPct, s.healthPct < 0.25);
    set(this.el.barStamina, s.staminaPct, s.staminaPct < 0.12);
    set(this.el.barHunger, s.hungerPct, s.hungerPct < 0.15);
    set(this.el.barThirst, s.thirstPct, s.thirstPct < 0.15);
    this.el.barThirst.parentElement.parentElement.style.display = Settings.get('thirstEnabled') ? '' : 'none';

    const item = w.current;
    this.el.weaponName.textContent = item ? item.name.toUpperCase() : 'UNARMED';
    if (item && item.kind === 'gun') {
      this.el.ammoMag.textContent = w.magazine;
      this.el.ammoRes.textContent = w.reserve;
      this.el.ammoLine.style.visibility = 'visible';
      this.el.ammoLine.classList.toggle('empty', w.magazine === 0);
      this.el.fireMode.textContent = w.state === 'reloading' ? 'RELOADING…'
        : item.auto ? 'AUTO' : item.boltAction ? 'BOLT' : item.shellReload ? 'PUMP' : 'SEMI';
    } else if (item) {
      this.el.ammoMag.textContent = '—';
      this.el.ammoRes.textContent = '';
      this.el.ammoLine.classList.remove('empty');
      this.el.fireMode.textContent = 'MELEE';
    } else {
      this.el.ammoMag.textContent = '—';
      this.el.ammoRes.textContent = '';
      this.el.fireMode.textContent = 'FISTS';
    }

    // crosshair
    this.el.crosshair.style.display = Settings.get('crosshair') ? '' : 'none';
    this.el.crosshair.classList.toggle('ads', w.ads > 0.6);
    const sp = w.current ? w.spread : 0;
    this.el.crosshair.classList.toggle('spread-lg', sp > 0.035);
    this.el.crosshair.classList.toggle('spread-md', sp > 0.016 && sp <= 0.035);

    // low health overlay
    const lh = s.healthPct < 0.4 ? (0.4 - s.healthPct) / 0.4 : 0;
    this.el.lowHealth.style.opacity = (lh * 0.85 + (s.bleeding > 0 ? 0.12 : 0)).toFixed(3);

    // compass
    this.el.compassStrip.parentElement.style.display = Settings.get('compass') ? '' : 'none';
    if (Settings.get('compass')) this.updateCompass();

    // subtitles
    if (this._subtitleTimer > 0) {
      this._subtitleTimer -= dt;
      if (this._subtitleTimer <= 0) this.el.subtitles.classList.remove('show');
    }

    // toasts
    for (let i = this._toasts.length - 1; i >= 0; i--) {
      const t = this._toasts[i];
      t.life -= dt;
      if (t.life <= 0.5 && !t.fading) { t.fading = true; t.el.classList.add('fade'); }
      if (t.life <= 0) { t.el.remove(); this._toasts.splice(i, 1); }
    }

    this.updateQuickbar();
    this.updateObjective();
    this.updateBossBar();
    this.updateWaypoints();
  }

  updateCompass() {
    const yaw = this.game.player.yaw;
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const width = 330, span = 140; // degrees visible
    let html = '';
    const marks = [
      [0, 'N', 'card'], [45, 'NE', ''], [90, 'E', 'card'], [135, 'SE', ''],
      [180, 'S', 'card'], [225, 'SW', ''], [270, 'W', 'card'], [315, 'NW', ''],
    ];
    for (const [ang, label, cls] of marks) {
      let d = ang - deg;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) > span / 2) continue;
      const x = width / 2 + (d / span) * width;
      html += `<span class="${cls}" style="left:${x.toFixed(1)}px">${label}</span>`;
    }
    // discovered landmarks
    const p = this.game.player.position;
    for (const lm of this.game.world.landmarks) {
      if (!lm.discovered) continue;
      const dist = Math.hypot(lm.x - p.x, lm.z - p.z);
      if (dist > 400) continue;
      const bearing = ((Math.atan2(lm.x - p.x, -(lm.z - p.z)) * 180 / Math.PI) % 360 + 360) % 360;
      let d = bearing - deg;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) > span / 2) continue;
      const x = width / 2 + (d / span) * width;
      html += `<span class="lm" style="left:${x.toFixed(1)}px">${lm.label.toUpperCase()} ${Math.round(dist)}m</span>`;
    }
    this.el.compassStrip.innerHTML = html;
  }

  updateObjective() {
    const G = this.game;
    let text = '';
    if (G.stats.bleeding > 0) text = 'You are bleeding — use a bandage';
    else if (G.stats.health < 35) text = 'Badly hurt — find medical supplies';
    else if (G.stats.hunger < 20) text = 'Starving — forage for food';
    else if (Settings.get('thirstEnabled') && G.stats.thirst < 20) text = 'Dehydrated — find water';
    else if (G.flashlight.battery < 15) text = 'Lamp cell nearly dead — find a replacement';
    else {
      const n = G.world.nearestUndiscovered(G.player.position);
      if (G.riftOpen) text = 'The rift is open — find it and go through';
      else if (G.bossAlive) text = `Something enormous is awake ${Math.round(G.bossDistance())} m away`;
      else if (n && n.dist < 220) text = `Unexplored: something ${Math.round(n.dist)} m away`;
      else text = `Explore ${G.biome ? G.biome.name.toLowerCase() : 'the Hollow'} · find what is keeping it here`;
    }
    if (this.el.objective.textContent !== text) this.el.objective.textContent = text;
  }

  /** Rebuild anything that shows controller glyphs after a pad connects. */
  refreshGlyphs() {
    const active = document.querySelector('#settings .tab.active');
    if (active && !this.el.settings.classList.contains('hidden')) this.buildSettings(active.dataset.tab);
    this._promptGlyph = null;
  }

  /** The screen the controller should be driving right now, if any. */
  _activePadScreen() {
    for (const id of ['reader', 'settings', 'credits', 'death', 'pause', 'armoury', 'inventory', 'mainmenu']) {
      const el = this.el[id] || document.getElementById(id);
      if (el && !el.classList.contains('hidden')) return el;
    }
    return null;
  }

  /** Drive menus from the controller when no gameplay is running. */
  padMenuTick(dt) {
    if (!Pad.connected) return;
    const screen = this._activePadScreen();
    if (!screen) { this._padFocus = null; return; }
    const nav = Input.menuNav(dt);

    const items = Array.from(screen.querySelectorAll(
      '.mbtn:not(:disabled), .tab, .toggle, .set-row select, .set-row input[type=range], .inv-cell, .lo-item'
    )).filter((el) => el.offsetParent !== null);
    if (!items.length) return;

    if (screen !== this._padScreen) {
      // Focus must not linger on a screen that has since been hidden, or the
      // new screen never takes focus at all.
      for (const x of document.querySelectorAll('.pad-focus')) x.classList.remove('pad-focus');
      this._padScreen = screen;
      this._padIndex = 0;
    }
    let i = items.indexOf(screen.querySelector('.pad-focus'));
    if (i < 0) {
      for (const x of document.querySelectorAll('.pad-focus')) x.classList.remove('pad-focus');
      i = Math.min(this._padIndex || 0, items.length - 1);
    }

    if (nav.up) i = (i - 1 + items.length) % items.length;
    if (nav.down) i = (i + 1) % items.length;

    const el = items[i];
    this._padIndex = i;
    if (nav.up || nav.down || !screen.querySelector('.pad-focus')) {
      for (const x of document.querySelectorAll('.pad-focus')) x.classList.remove('pad-focus');
      el.classList.add('pad-focus');
      el.scrollIntoView({ block: 'nearest' });
      if (nav.up || nav.down) Audio.uiMove();
    }

    // Left/right adjusts sliders and cycles selects in place.
    if (nav.left || nav.right) {
      const dir = nav.right ? 1 : -1;
      if (el.tagName === 'INPUT' && el.type === 'range') {
        const step = parseFloat(el.step) || 0.05;
        el.value = String(Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), parseFloat(el.value) + step * dir)));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.tagName === 'SELECT') {
        el.selectedIndex = (el.selectedIndex + dir + el.options.length) % el.options.length;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.classList.contains('tab')) {
        const tabs = Array.from(screen.querySelectorAll('.tab'));
        const ti = (tabs.indexOf(el) + dir + tabs.length) % tabs.length;
        tabs[ti].click();
      }
    }

    if (nav.confirm) { Audio.uiClick(); el.click(); }
    if (nav.back) {
      Audio.uiClick();
      const backBtn = screen.querySelector('[data-action="back"], [data-action="resume"], [data-action="close"]');
      if (backBtn) backBtn.click();
      else if (screen === this.el.inventory) this.game.onKeyDown('Tab', { preventDefault() {} });
    }
  }

  /**
   * Light the side of the screen that is currently driving a cursor-look turn.
   * With the pointer hidden there is otherwise no way to tell the difference
   * between "the view is rotating because I pushed the edge" and "the view is
   * rotating on its own", which is exactly the confusion the fallback exists
   * to avoid.
   */
  updateLookEdge() {
    const el = this.el.lookEdge;
    if (!el) return;
    const on = Input.softLook && Settings.get('edgeTurn') > 0;
    el.classList.toggle('hidden', !on);
    if (!on) { this._edgeShown = null; return; }
    const e = Input.edge;
    const set = (sel, v) => {
      const n = el.querySelector(sel);
      const o = Math.min(1, Math.abs(v) * 1.25);
      if (n) n.style.opacity = o.toFixed(2);
    };
    set('.l', e.x < 0 ? e.x : 0);
    set('.r', e.x > 0 ? e.x : 0);
    set('.t', e.y < 0 ? e.y : 0);
    set('.b', e.y > 0 ? e.y : 0);
  }

  /* ================= waypoints ================= */

  /**
   * Project every waypoint to the screen. Anything in front of the camera and
   * inside the frame gets a marker where it actually is; anything else gets an
   * arrow pinned to the edge of the screen pointing at it, which is the part
   * that stops a player wandering in the wrong direction for five minutes.
   */
  updateWaypoints() {
    const G = this.game;
    const layer = this.el.wpLayer;
    if (!G.waypoints || !Settings.get('waypoints')) {
      if (this._wpEls && this._wpEls.length) { layer.innerHTML = ''; this._wpEls = []; }
      return;
    }
    const marks = G.waypoints.markers();
    if (!this._wpEls) this._wpEls = [];

    // Pool the DOM nodes: markers come and go every frame and rebuilding the
    // layer would thrash the document.
    while (this._wpEls.length < marks.length) {
      const el = document.createElement('div');
      el.className = 'wp';
      el.innerHTML = '<span class="wp-ico"></span><span class="wp-label"></span><span class="wp-dist"></span>';
      layer.appendChild(el);
      this._wpEls.push(el);
    }
    for (let i = marks.length; i < this._wpEls.length; i++) this._wpEls[i].style.display = 'none';

    const cam = G.camera;
    const W = window.innerWidth, H = window.innerHeight;
    // Edge markers carry a label, so they need enough room not to run off the
    // side of the screen they are pinned to.
    const pad = 46;
    const edgePad = Math.min(150, Math.max(90, W * 0.10));
    cam.updateMatrixWorld();
    _wpMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      const el = this._wpEls[i];
      el.style.display = '';
      el.className = 'wp' + (m.primary ? '' : ' secondary');
      el.style.setProperty('--wc', '#' + m.style.color.toString(16).padStart(6, '0'));

      _wpV.set(m.x, (m.y ?? 0) + (m.primary ? 2.6 : 1.6), m.z).applyMatrix4(_wpMat);
      // w < 0 means the point is behind the camera; the projected x/y are then
      // mirrored, which is why they have to be flipped before clamping.
      const behind = _wpV.z > 1 || _wpV.w < 0;
      let sx = (behind ? -_wpV.x : _wpV.x) * 0.5 + 0.5;
      let sy = (behind ? _wpV.y : -_wpV.y) * 0.5 + 0.5;
      let px = sx * W, py = sy * H;

      const off = behind || px < pad || px > W - pad || py < pad || py > H - pad;
      let icon = m.style.icon;
      if (off) {
        // Clamp to the screen edge and point the arrow along the direction to
        // the marker from the middle of the screen.
        const dx = px - W / 2, dy = py - H / 2;
        const ang = Math.atan2(dy, dx);
        const hw = W / 2 - edgePad, hh = H / 2 - pad;
        const scale = Math.min(hw / Math.max(0.001, Math.abs(Math.cos(ang))), hh / Math.max(0.001, Math.abs(Math.sin(ang))));
        px = W / 2 + Math.cos(ang) * scale;
        py = H / 2 + Math.sin(ang) * scale;
        icon = ARROWS[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
        el.className += ' edge' + (behind ? ' behind' : '');
      }

      el.style.left = px.toFixed(0) + 'px';
      el.style.top = py.toFixed(0) + 'px';
      const kids = el.children;
      if (kids[0].textContent !== icon) kids[0].textContent = icon;
      const label = m.primary ? (m.label || '').toUpperCase() : (m.label || '').toUpperCase();
      if (kids[1].textContent !== label) kids[1].textContent = label;
      const dtxt = Settings.get('waypointDistance') ? `${Math.round(m.dist)} m` : '';
      if (kids[2].textContent !== dtxt) kids[2].textContent = dtxt;
    }
  }

  /* ================= boss bar ================= */

  /** Attach the bar to a boss; it then follows that boss until it dies. */
  bossBar(boss) {
    this._boss = boss;
    const el = this.el.bossbar;
    el.querySelector('.bb-name').textContent = boss.def.name;
    el.querySelector('.bb-title').textContent = boss.def.title;
    el.querySelector('.bb-phase').textContent = '';
    el.querySelector('.bb-fill').style.width = '100%';
    el.querySelector('.bb-chip').style.width = '100%';
    el.classList.remove('hidden');
  }

  hideBossBar() {
    this._boss = null;
    this.el.bossbar.classList.add('hidden');
  }

  updateBossBar() {
    const b = this._boss;
    if (!b) return;
    if (!b.alive) { this.hideBossBar(); return; }
    const f = Math.max(0, b.health / b.maxHealth);
    const el = this.el.bossbar;
    // The pale chip trails the red bar, so a big hit reads as a big hit.
    el.querySelector('.bb-fill').style.width = (f * 100).toFixed(1) + '%';
    el.querySelector('.bb-chip').style.width = (f * 100).toFixed(1) + '%';
    const phase = b.def.phases[b.phase];
    const revealed = b.weakPoints.filter((w) => w.revealed).map((w) => w.name.toUpperCase()).join(' · ');
    const line = `PHASE ${b.phase + 1}/${b.def.phases.length}` + (revealed ? `   WEAK: ${revealed}` : '');
    const el2 = el.querySelector('.bb-phase');
    if (el2.textContent !== line) el2.textContent = line;
  }

  /* ================= biome title card ================= */

  showBiomeCard(biome, depth) {
    const el = this.el.biomeCard;
    el.querySelector('.bc-kicker').textContent = depth === 0 ? 'BEGIN' : `RIFT ${depth} · DEEPER`;
    el.querySelector('.bc-name').textContent = biome.name;
    el.querySelector('.bc-sub').textContent = biome.sub;
    el.querySelector('.bc-blurb').textContent = biome.blurb;
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(this._biomeCardTimer);
    this._biomeCardTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 1300);
    }, 5200);
  }

  showPrompt(label) {
    this.el.promptText.textContent = label;
    // Show the controller glyph instead of "E" while the player is on a pad.
    const key = this.el.prompt.querySelector('b');
    const glyph = Input.usingGamepad && Pad.connected ? (Pad.glyphFor('use') || 'X') : 'E';
    if (key && this._promptGlyph !== glyph) {
      key.textContent = glyph;
      key.classList.toggle('pad', glyph.length > 1);
      this._promptGlyph = glyph;
    }
    this.el.prompt.classList.remove('hidden');
  }
  hidePrompt() { this.el.prompt.classList.add('hidden'); }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    this.el.toasts.appendChild(el);
    this._toasts.push({ el, life: 3.4 });
    while (this._toasts.length > 6) { const t = this._toasts.shift(); t.el.remove(); }
  }

  subtitle(text) {
    if (!Settings.get('subtitles')) return;
    this.el.subtitles.textContent = text;
    this.el.subtitles.classList.add('show');
    this._subtitleTimer = 5.5;
  }

  hitmarker(kill) {
    if (!Settings.get('hitmarkers')) return;
    const h = this.el.hitmarker;
    h.classList.remove('show');
    h.classList.toggle('kill', !!kill);
    void h.offsetWidth;
    h.classList.add('show');
  }

  damageFlash(intensity) {
    const el = this.el.damageFlash;
    el.style.transition = 'none';
    el.style.opacity = Math.min(1, intensity).toFixed(2);
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .55s ease-out';
      el.style.opacity = '0';
    });
  }

  setFps(fps, extra) {
    this.el.fps.classList.toggle('hidden', !Settings.get('showFps'));
    if (Settings.get('showFps')) this.el.fps.textContent = `${fps} FPS${extra ? '\n' + extra : ''}`;
  }

  /* ================= inventory ================= */

  toggleInventory(force) {
    const open = force !== undefined ? force : this.el.inventory.classList.contains('hidden');
    if (open) {
      this.renderInventory();
      this.el.inventory.classList.remove('hidden');
      document.body.classList.remove('playing');
    } else {
      this.el.inventory.classList.add('hidden');
      document.body.classList.add('playing');
    }
    return open;
  }

  get inventoryOpen() { return !this.el.inventory.classList.contains('hidden'); }

  renderInventory() {
    const inv = this.game.inventory;
    const grid = this.el.invGrid;
    grid.innerHTML = '';
    inv.slots.forEach((slot, idx) => {
      const item = ITEMS[slot.id];
      if (!item) return;
      const cell = document.createElement('div');
      cell.className = 'inv-cell' + (this.selectedItem === slot.id ? ' sel' : '');
      const q = inv.quick.indexOf(slot.id);
      cell.innerHTML =
        `<span class="ico">${item.icon}</span><span class="nm">${item.name}</span>` +
        (slot.qty > 1 ? `<span class="cnt">${slot.qty}</span>` : '') +
        (inv.equipped === slot.id ? '<span class="eq">EQ</span>' : '') +
        (q >= 0 ? `<span class="qs">${q + 1}</span>` : '');
      cell.addEventListener('click', () => { this.selectItem(slot.id); this.useSelected(); });
      cell.addEventListener('mouseenter', () => this.selectItem(slot.id, true));
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); this.dropSelected(slot.id); });
      grid.appendChild(cell);
    });
    if (!inv.slots.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;color:#5a5851;font-size:12px;padding:20px">Your pack is empty.</div>';
    }
    this.el.invWeight.textContent = `CARRY ${inv.weight.toFixed(1)} / ${inv.maxWeight.toFixed(1)} kg`;
    this.el.invWeight.style.color = inv.weight > inv.maxWeight * 0.9 ? '#c9463a' : '';
    this.renderDetail();
  }

  selectItem(id, hoverOnly) {
    this.selectedItem = id;
    this.renderDetail();
    if (!hoverOnly) Audio.uiMove();
    $$('.inv-cell').forEach((c) => c.classList.remove('sel'));
  }

  renderDetail() {
    const id = this.selectedItem;
    const item = id ? ITEMS[id] : null;
    const d = this.el.invDetail;
    if (!item) { d.innerHTML = '<div class="inv-detail-empty">Select an item.</div>'; return; }
    const rows = [];
    const inv = this.game.inventory;
    rows.push(['Weight', `${item.weight.toFixed(2)} kg`]);
    rows.push(['Carried', `${inv.count(id)}`]);
    if (item.cat === 'weapon' && item.kind === 'gun') {
      rows.push(['Damage', item.damage + (item.pellets ? ` ×${item.pellets}` : '')]);
      rows.push(['Magazine', item.mag]);
      rows.push(['Rate', item.rate.toFixed(1) + '/s']);
      rows.push(['Reload', item.reload.toFixed(1) + 's']);
      rows.push(['Ammunition', ITEMS[item.ammo].name]);
      rows.push(['Reserve', inv.count(item.ammo)]);
      rows.push(['Effective range', item.range + ' m']);
    } else if (item.cat === 'weapon') {
      rows.push(['Damage', item.damage]);
      rows.push(['Reach', item.range.toFixed(1) + ' m']);
      rows.push(['Stamina', item.staminaCost]);
    } else if (item.cat === 'food') {
      if (item.hunger) rows.push(['Restores hunger', '+' + item.hunger]);
      if (item.thirst) rows.push(['Thirst', (item.thirst > 0 ? '+' : '') + item.thirst]);
      if (item.health) rows.push(['Health', '+' + item.health]);
    } else if (item.cat === 'medical') {
      if (item.health) rows.push(['Immediate healing', '+' + item.health]);
      if (item.healOverTime) rows.push(['Over time', `+${item.healOverTime} / ${item.healDuration}s`]);
      if (item.stopsBleed) rows.push(['Bleeding', 'Stopped']);
      if (item.damageResist) rows.push(['Damage taken', `−${Math.round(item.damageResist * 100)}%`]);
    } else if (item.battery) {
      rows.push(['Lamp charge', '+' + item.battery + '%']);
    }

    const canUse = item.cat === 'weapon' || item.cat === 'food' || item.cat === 'medical' || item.battery;
    d.innerHTML =
      `<h3>${item.name}</h3><div class="cat">${item.cat.toUpperCase()}</div>` +
      `<p>${item.desc}</p>` +
      `<div class="stats">${rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>` +
      `<div class="inv-actions">` +
      (canUse ? `<button class="mbtn small primary" data-inv="use">${item.cat === 'weapon' ? 'EQUIP' : 'USE'}</button>` : '') +
      `<button class="mbtn small" data-inv="drop">DROP ONE</button></div>` +
      `<div class="set-note">Press 1–5 to assign this to a quick slot.</div>`;
    d.querySelector('[data-inv="use"]')?.addEventListener('click', () => this.useSelected());
    d.querySelector('[data-inv="drop"]')?.addEventListener('click', () => this.dropSelected(id));
  }

  useSelected() {
    if (!this.selectedItem) return;
    this.game.useItem(this.selectedItem);
    this.renderInventory();
  }

  dropSelected(id) {
    this.game.dropItem(id || this.selectedItem);
    this.renderInventory();
  }

  /* ================= settings ================= */

  buildSettings(tab) {
    const body = $('#settings-body');
    body.innerHTML = '';
    const row = (label, desc, control, valueEl) => {
      const r = document.createElement('div');
      r.className = 'set-row';
      const l = document.createElement('label');
      l.innerHTML = `${label}${desc ? `<span class="desc">${desc}</span>` : ''}`;
      r.appendChild(l);
      r.appendChild(control);
      const v = document.createElement('div');
      v.className = 'val';
      if (valueEl) v.textContent = valueEl;
      r.appendChild(v);
      body.appendChild(r);
      return { row: r, val: v };
    };
    const slider = (key, min, max, step, fmt) => {
      const i = document.createElement('input');
      i.type = 'range'; i.min = min; i.max = max; i.step = step;
      i.value = Settings.get(key);
      const holder = { val: null };
      i.addEventListener('input', () => {
        const v = parseFloat(i.value);
        Settings.set(key, v);
        if (holder.val) holder.val.textContent = fmt(v);
        Audio.uiMove();
      });
      return { el: i, holder, fmt };
    };
    const select = (key, options) => {
      const s = document.createElement('select');
      for (const [v, label] of options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = label;
        if (String(Settings.get(key)) === String(v)) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener('change', () => {
        const raw = s.value;
        const num = parseFloat(raw);
        Settings.set(key, Number.isNaN(num) || String(num) !== raw ? raw : num);
        Audio.uiClick();
        if (key === 'quality') { Settings.applyPreset(raw); this.buildSettings('graphics'); }
      });
      return s;
    };
    const toggle = (key) => {
      const t = document.createElement('div');
      t.className = 'toggle' + (Settings.get(key) ? ' on' : '');
      t.innerHTML = '<i></i>';
      t.addEventListener('click', () => {
        Settings.set(key, !Settings.get(key));
        t.classList.toggle('on', Settings.get(key));
        Audio.uiClick();
      });
      return t;
    };

    if (tab === 'graphics') {
      body.appendChild(makeNote('Presets change every setting below. Adjust anything afterwards and the preset becomes "custom" in effect.'));
      row('Quality preset', 'Overall graphics target', select('quality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']]));
      const rs = slider('renderScale', 0.5, 2.0, 0.05, (v) => Math.round(v * 100) + '%');
      const r1 = row('Render scale', 'Internal resolution multiplier. 2.00 supersamples for 4K output.', rs.el, Math.round(Settings.get('renderScale') * 100) + '%');
      rs.holder.val = r1.val;
      row('Fullscreen', 'Toggle with F11 as well', toggle('fullscreen'));
      row('Shadows', 'Shadow map resolution and casters', select('shadows', [['off', 'OFF'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']]));
      row('Anti-aliasing', 'MSAA (requires restart of the renderer)', toggle('antialias'));
      row('Ambient occlusion', 'Contact darkening term', toggle('ao'));
      row('Fog quality', 'Density falloff detail', select('fogQuality', [['low', 'LOW'], ['high', 'HIGH']]));
      const vd = slider('viewDistance', 70, 320, 5, (v) => v + ' m');
      const r2 = row('View distance', 'Forest chunk streaming radius', vd.el, Settings.get('viewDistance') + ' m');
      vd.holder.val = r2.val;
      const fo = slider('foliage', 0.2, 1.4, 0.05, (v) => Math.round(v * 100) + '%');
      const r3 = row('Foliage density', 'Applies on the next new game', fo.el, Math.round(Settings.get('foliage') * 100) + '%');
      fo.holder.val = r3.val;
      row('Texture quality', 'Procedural texture resolution', select('textureQuality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']]));
      row('VSync', 'Sync to display refresh', toggle('vsync'));
      row('FPS limit', '0 = unlimited', select('fpsLimit', [[0, 'UNLIMITED'], [30, '30'], [60, '60'], [90, '90'], [120, '120'], [144, '144']]));
      row('Time of day', 'MORNING is the playable grade. NIGHT is the original moonless one — much darker, and much harder to navigate.',
        select('timeOfDay', [['morning', 'MORNING'], ['night', 'NIGHT']]));
      const br = slider('brightness', 0.6, 3.0, 0.05, (v) => v.toFixed(2) + '×');
      const r4 = row('Brightness', '0.60 is the original moonless grade. Raise it until you can navigate.', br.el, Settings.get('brightness').toFixed(2) + '×');
      br.holder.val = r4.val;
      const af = slider('ambientFill', 0, 1.5, 0.05, (v) => (v === 0 ? 'OFF' : Math.round(v * 100) + '%'));
      const r5 = row('Ambient fill', 'A floor of light so shapes still read where nothing is lit', af.el,
        Settings.get('ambientFill') === 0 ? 'OFF' : Math.round(Settings.get('ambientFill') * 100) + '%');
      af.holder.val = r5.val;
      row('Show FPS', '', toggle('showFps'));
    } else if (tab === 'audio') {
      const mk = (key, label, desc) => {
        const s = slider(key, 0, 1, 0.01, (v) => Math.round(v * 100) + '%');
        const r = row(label, desc, s.el, Math.round(Settings.get(key) * 100) + '%');
        s.holder.val = r.val;
      };
      mk('volMaster', 'Master volume', 'All audio');
      mk('volSfx', 'Effects volume', 'Weapons, creatures, footsteps');
      mk('volAmbient', 'Ambient volume', 'Wind, insects, forest');
      mk('volMusic', 'Score volume', 'Tension drones');
      row('Subtitles', 'On-screen text for important sounds', toggle('subtitles'));
      body.appendChild(makeNote('All audio in this build is synthesised at runtime — there are no sound files. Every cue can be swapped for a sample later via AudioManager.replaceWithSample().'));
    } else if (tab === 'controls') {
      // The look system is the one input that can break outright, so its
      // state is reported here rather than left for the player to guess at.
      const d = Input.lookDiagnostics;
      const note = document.createElement('div');
      note.className = 'set-note';
      note.innerHTML = d.softLook
        ? `<b style="color:#c0a15a">CURSOR LOOK</b> — mouse capture is unavailable`
          + `${d.lockBroken ? ' (it was granted but reported no movement)' : ''}, so the game is`
          + ' reading the plain cursor instead. Move to look, and <b>push the pointer into the edge'
          + ' of the screen</b> to keep turning past it.'
        : d.locked
          ? '<b style="color:#6f8f52">MOUSE CAPTURED</b> — normal look. If it ever stops working the'
            + ' game falls back to cursor look on its own and tells you.'
          : 'Look mode is chosen when a game starts. <b>AUTO</b> captures the mouse and falls back to'
            + ' cursor look if the browser refuses; <b>CURSOR</b> skips the capture entirely and works'
            + ' everywhere, including trackpads and remote sessions.';
      body.appendChild(note);

      row('Look mode', 'Change this if you cannot turn at all',
        select('lookMode', [['auto', 'AUTO'], ['lock', 'MOUSE CAPTURE'], ['cursor', 'CURSOR / TRACKPAD']]));
      row('Trackpad boost', Input.trackpadDetected
        ? 'A trackpad was detected on this machine'
        : 'Trackpads move the pointer much less than a mouse for the same gesture',
        select('trackpad', [['auto', 'AUTO'], ['on', 'ON'], ['off', 'OFF']]));
      const et = slider('edgeTurn', 0, 2.5, 0.05, (v) => (v === 0 ? 'OFF' : v.toFixed(2) + '×'));
      const r0 = row('Edge turn speed', 'Cursor look only: how fast the screen edges keep you turning',
        et.el, Settings.get('edgeTurn') === 0 ? 'OFF' : Settings.get('edgeTurn').toFixed(2) + '×');
      et.holder.val = r0.val;

      const sn = slider('sensitivity', 0.2, 3.0, 0.05, (v) => v.toFixed(2) + '×');
      const r1 = row('Mouse sensitivity', '', sn.el, Settings.get('sensitivity').toFixed(2) + '×');
      sn.holder.val = r1.val;
      const ad = slider('adsSensitivity', 0.2, 1.0, 0.05, (v) => v.toFixed(2) + '×');
      const r2 = row('ADS sensitivity multiplier', 'Applied while aiming', ad.el, Settings.get('adsSensitivity').toFixed(2) + '×');
      ad.holder.val = r2.val;
      const hb = slider('headBob', 0, 1.5, 0.05, (v) => Math.round(v * 100) + '%');
      const r3 = row('Head bob', '', hb.el, Math.round(Settings.get('headBob') * 100) + '%');
      hb.holder.val = r3.val;
      row('Invert Y axis', '', toggle('invertY'));
      row('Toggle sprint', 'Otherwise hold Shift', toggle('toggleSprint'));
      row('Toggle crouch', 'Otherwise hold Ctrl / C', toggle('toggleCrouch'));
      row('Toggle aim', 'Otherwise hold right mouse', toggle('toggleAds'));
      const t = document.createElement('table');
      t.className = 'keys-table';
      t.innerHTML = BINDINGS.map(([a, k]) => `<tr><td>${a}</td><td><kbd>${k}</kbd></td></tr>`).join('');
      body.appendChild(t);
    } else if (tab === 'controller') {
      const status = document.createElement('div');
      status.className = 'set-note';
      const brandName = Pad.brand === 'playstation' ? 'PlayStation (DualSense / DualShock)' : 'Xbox / XInput';
      status.innerHTML = Pad.connected
        ? `<b style="color:#6f8f52">CONNECTED</b> — ${escapeHtml(Pad.id || brandName)}<br/>Detected as ${brandName}. Buttons use the standard mapping, so both pads share one layout.`
        : '<b style="color:#c0a15a">NO CONTROLLER DETECTED</b><br/>Plug in or pair an Xbox or PlayStation controller, then <b>press any button on it</b> — browsers hide gamepads until they receive input. Bluetooth DualSense works; so does USB.';
      body.appendChild(status);

      row('Button layout', 'Same presets Call of Duty ships',
        select('padButtonLayout', Object.entries(BUTTON_LAYOUTS).map(([k, v]) => [k, v.label.toUpperCase()])));
      row('Stick layout', '', select('padStickLayout', Object.entries(STICK_LAYOUTS).map(([k, v]) => [k, v.label.toUpperCase()])));
      row('Aim response curve', 'How stick tilt maps to turn speed',
        select('padCurve', [['standard', 'STANDARD'], ['linear', 'LINEAR'], ['dynamic', 'DYNAMIC']]));
      const ps = slider('padSensitivity', 0.2, 3.0, 0.05, (v) => v.toFixed(2) + '×');
      const r1 = row('Look sensitivity', '', ps.el, Settings.get('padSensitivity').toFixed(2) + '×');
      ps.holder.val = r1.val;
      const pa = slider('padAdsSensitivity', 0.2, 1.0, 0.05, (v) => v.toFixed(2) + '×');
      const r2 = row('ADS sensitivity multiplier', '', pa.el, Settings.get('padAdsSensitivity').toFixed(2) + '×');
      pa.holder.val = r2.val;
      const aa = slider('padAimAssist', 0, 1.5, 0.05, (v) => (v === 0 ? 'OFF' : Math.round(v * 100) + '%'));
      const r3 = row('Aim assist', 'Reticle slowdown plus rotational tracking', aa.el,
        Settings.get('padAimAssist') === 0 ? 'OFF' : Math.round(Settings.get('padAimAssist') * 100) + '%');
      aa.holder.val = r3.val;
      const dl = slider('padDeadzoneLeft', 0, 0.4, 0.01, (v) => Math.round(v * 100) + '%');
      const r4 = row('Left stick deadzone', 'Raise if your stick drifts', dl.el, Math.round(Settings.get('padDeadzoneLeft') * 100) + '%');
      dl.holder.val = r4.val;
      const dr = slider('padDeadzoneRight', 0, 0.4, 0.01, (v) => Math.round(v * 100) + '%');
      const r5 = row('Right stick deadzone', '', dr.el, Math.round(Settings.get('padDeadzoneRight') * 100) + '%');
      dr.holder.val = r5.val;
      row('Vibration', 'Weapon recoil, hits and damage', toggle('padRumble'));

      const t = document.createElement('table');
      t.className = 'keys-table';
      t.innerHTML = PAD_BINDINGS.map(([action, key]) => {
        const glyph = /^[a-z]/.test(key) ? Pad.glyphFor(key) || key : key;
        return `<tr><td>${action}</td><td><kbd>${escapeHtml(glyph)}</kbd></td></tr>`;
      }).join('');
      body.appendChild(t);
      body.appendChild(makeNote('Menus are controller-navigable: sticks or D-pad to move, ' +
        (Pad.brand === 'playstation' ? '✕ to confirm, ○ to go back.' : 'A to confirm, B to go back.')));
    } else if (tab === 'gameplay') {
      row('Difficulty',
        'STORY is a walk in the woods. NORMAL is forgiving: you heal up between fights. '
        + 'HARSH is the original balance — no healing worth the name. BRUTAL is worse.',
        select('difficulty', [['story', 'STORY'], ['normal', 'NORMAL'], ['harsh', 'HARSH'], ['brutal', 'BRUTAL']]));
      row('Thirst system', 'Disable for a simpler survival loop', toggle('thirstEnabled'));
      row('Encounter director', 'Dynamic tension events and stalking spawns', toggle('directorEnabled'));
      row('Crosshair', '', toggle('crosshair'));
      row('Hit markers', '', toggle('hitmarkers'));
      row('Compass', '', toggle('compass'));
      row('Waypoints', 'Objective beacon in the world and markers on screen (N)', toggle('waypoints'));
      row('Guide light', 'A lantern that goes on ahead and leads you to the objective', toggle('guide'));
      row('Waypoint distances', '', toggle('waypointDistance'));
      body.appendChild(makeNote('Difficulty applies immediately. Foliage density and world seed apply on the next new game.'));
    }
  }

  /* ================= menu wiring ================= */

  bindMenus() {
    const G = () => this.game;

    // Any interaction with the menu is the gesture that lets the browser start
    // audio at all, so the theme comes up on the first hover or click rather
    // than waiting for the player to commit to something.
    const wake = () => {
      Audio.init();
      Audio.resume();
      if (!Audio._menuMusic && this.game.state !== 'PLAYING') {
        Audio._menuMusic = true;
        Audio.startMusic('menu');
        Audio.setDread(0.12);
      }
    };
    $$('#mainmenu .mbtn').forEach((b) => b.addEventListener('mouseenter', wake));
    window.addEventListener('pointerdown', wake, { once: false });
    window.addEventListener('keydown', wake, { once: false });

    $$('#mainmenu .mbtn').forEach((b) => b.addEventListener('click', () => {
      Audio.init(); Audio.resume(); Audio.uiClick();
      const a = b.dataset.action;
      if (a === 'new') G().startNewGame();
      else if (a === 'sandbox') G().startSandbox();
      else if (a === 'coop') G().coop.show();
      else if (a === 'continue') G().loadGame();
      else if (a === 'armoury') G().openArmoury('menu');
      else if (a === 'settings') this.showSettings('menu');
      else if (a === 'credits') this.showCredits();
      else if (a === 'quit') G().quit();
    }));

    $$('#pause .mbtn').forEach((b) => b.addEventListener('click', () => {
      Audio.uiClick();
      const a = b.dataset.action;
      if (a === 'resume') G().resume();
      else if (a === 'armoury') G().openArmoury('pause');
      else if (a === 'save') { G().saveGame(); this.toast('Progress saved', 'good'); }
      else if (a === 'settings') this.showSettings('pause');
      else if (a === 'restart') G().restart();
      else if (a === 'menu') G().toMainMenu();
    }));

    $$('#death .mbtn').forEach((b) => b.addEventListener('click', () => {
      Audio.uiClick();
      const a = b.dataset.action;
      if (a === 'loadsave') G().loadGame();
      else if (a === 'restart') G().restart();
      else if (a === 'menu') G().toMainMenu();
    }));

    $$('#settings .tab').forEach((t) => t.addEventListener('click', () => {
      $$('#settings .tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      this.buildSettings(t.dataset.tab);
      Audio.uiClick();
    }));

    $$('#settings footer .mbtn').forEach((b) => b.addEventListener('click', () => {
      Audio.uiClick();
      if (b.dataset.action === 'defaults') {
        Settings.reset();
        this.buildSettings($('#settings .tab.active').dataset.tab);
        this.toast('Settings restored to defaults');
      } else {
        this.el.settings.classList.add('hidden');
        if (this._settingsReturn === 'pause') this.showPause();
      }
    }));

    $$('#credits .mbtn').forEach((b) => b.addEventListener('click', () => {
      Audio.uiClick();
      this.el.credits.classList.add('hidden');
    }));

    $$('#reader .mbtn').forEach((b) => b.addEventListener('click', () => {
      Audio.uiClick();
      this.closeNote();
    }));
  }
}

/** Eight-way arrow glyphs, indexed by octant, starting at "pointing right". */
const ARROWS = ['▶', '◢', '▼', '◣', '◀', '◤', '▲', '◥'];
const _wpV = new Vec4();
const _wpMat = new Mat4();

function makeNote(text) {
  const d = document.createElement('div');
  d.className = 'set-note';
  d.textContent = text;
  return d;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
