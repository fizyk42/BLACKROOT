/**
 * Armoury — the loadout, attachment, finish, upgrade and operator hub.
 *
 * The preview is a real 3D render, drawn by the main renderer into a small
 * scene of its own rather than a second WebGL context: a second context costs
 * a whole extra GL state machine and, on integrated graphics, frequently costs
 * you the first one. Because the preview is assembled by the same `dressModel`
 * the first-person weapon uses, the gun on the turntable and the gun in your
 * hands are the same object with the same attachments and the same finish.
 *
 * The armoury owns the *build* data (fits, finishes, upgrades, operator, the
 * chosen loadout), because a build has to outlive any one run — you can open
 * this from the main menu with no world loaded at all. The weapon system reads
 * its build from here rather than keeping a second copy.
 */
import * as THREE from 'three';
import { Settings } from '../core/Settings.js';
import { Audio } from '../core/AudioManager.js';
import { WEAPONS, ITEMS } from './ItemDatabase.js';
import { buildViewModel } from './ViewModels.js';
import { dressModel, camoTextureSize } from './GunDress.js';
import {
  SLOTS, SLOT_LABEL, ATTACHMENTS, defaultLoadoutFor, getAttachment, describeMods, resolveWeapon,
} from './Attachments.js';
import { camoInfo, camoSwatch, camoPage, camoName, CAMO_SPACE } from './CamoGenerator.js';
import {
  UPGRADE_TRACKS, upgradeCost, emptyUpgrades, investedIn, applyUpgrades, earnedPoints,
} from './Upgrades.js';
import {
  CHASSIS_LIST, forgeWeapon, forgePageFor, forgeId, ensureForgedIn, FORGE_SPACE,
} from './WeaponForge.js';
import {
  OPERATOR_OPTIONS, defaultOperator, buildOperator, poseIdle, poseReady, disposeOperator,
} from '../entities/OperatorModel.js';

const CAMO_PER_PAGE = 40;
const FORGE_PER_PAGE = 14;

const MELEE_IDS = ['knife', 'machete', 'axe'];

export class Armoury {
  constructor(game) {
    this.game = game;

    /* ---- persistent build data ---- */
    this.fits = new Map();          // weaponId -> attachment fit
    this.camos = new Map();         // weaponId -> camo seed or null
    this.upgrades = new Map();      // weaponId -> { trackId: level }
    this.spent = 0;                 // armoury points spent
    this.operator = defaultOperator();
    this.primary = 'pistol9';       // what a new run starts you holding
    this.unlocked = new Set();      // forged weapons the player has taken

    /* ---- ui state ---- */
    this.tab = 'weapons';
    this.chassis = 'sidearm';
    this.selected = 'pistol9';
    this.openSlot = null;
    this.camoPageNo = 0;
    this.camoSalt = 0;
    this.forgePageNo = 0;
    this.forgeSalt = (Math.random() * 1e9) | 0;
    this._open = false;
    this._t = 0;
    this.spin = 0.55;
    this.yaw = 0.42;
    this.pitch = 0.12;

    this._buildScene();
    this._buildDom();
  }

  /* ================= scene ================= */

  _buildScene() {
    const S = new THREE.Scene();
    S.environment = this.game.envMap || null;
    S.environmentIntensity = 0.7;

    // A display rig, not a night forest: the armoury is the one place the
    // player is allowed to actually see the thing they are building.
    const key = new THREE.DirectionalLight(0xfff2df, 6.4);
    key.position.set(1.1, 1.4, 1.0);
    const fill = new THREE.DirectionalLight(0x9fb6d4, 3.0);
    fill.position.set(-1.3, 0.4, 0.9);
    const rim = new THREE.DirectionalLight(0xffd9a8, 4.2);
    rim.position.set(-0.6, 0.7, -1.4);
    const kick = new THREE.DirectionalLight(0x7fa8c8, 1.1);
    kick.position.set(0.2, -1.0, 0.5);
    const amb = new THREE.AmbientLight(0x6c7684, 1.15);
    S.add(key, fill, rim, kick, amb);

    // A soft pool of light under the subject grounds it without a floor plane
    // eating the frame.
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 48),
      new THREE.MeshBasicMaterial({ color: 0x0a0d11, transparent: true, opacity: 0.85 })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -0.001;
    S.add(pool);
    this.pool = pool;

    this.scene = S;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);
    this.pivot = new THREE.Group();
    S.add(this.pivot);

    // Weapons are modelled facing -Z (down the barrel). Turned a quarter to
    // the left they present a side profile, which is how a gun is looked at.
    this.gunHolder = new THREE.Group();
    this.gunHolder.rotation.y = -Math.PI / 2;
    this.opHolder = new THREE.Group();
    this.pivot.add(this.gunHolder, this.opHolder);

    this.gunModels = new Map();     // viewModel key -> Group
    this.gunModel = null;
    this.opModel = null;
  }

  /** Frame the subject for the current tab, keeping it clear of the panel. */
  _frameCamera(aspect) {
    const operatorView = this.tab === 'operator';
    const dist = operatorView ? 5.0 : 0.90;
    const targetY = operatorView ? 0.98 : 0.0;
    this.camera.aspect = aspect;
    this.camera.position.set(0, targetY, dist);
    this.camera.lookAt(0, targetY, 0);
    this.camera.updateProjectionMatrix();

    const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * dist;
    const halfW = halfH * aspect;

    // The panel owns the left ~46% of the window, so the subject is placed in
    // the middle of what is left rather than the middle of the screen.
    const x = halfW * 0.44;
    this.pivot.position.set(x, operatorView ? 0 : targetY, 0);
    this.pool.position.set(x, operatorView ? 0 : -0.16, 0);
    this.pool.scale.setScalar(operatorView ? 1 : 0.16);

    // Fit the weapon to the free space rather than to a fixed number, so a
    // pistol and a rifle both read at a sensible size on any window shape.
    if (!operatorView && this._gunSpan > 0.001) {
      const fit = Math.min(halfH * 2 * 0.48, halfW * 2 * 0.30);
      this.gunHolder.scale.setScalar(fit / this._gunSpan);
    }
  }

  /* ================= build data accessors ================= */

  fitFor(id) {
    if (!this.fits.has(id)) {
      const w = ITEMS[id];
      const preset = w && w.forgeInfo ? { ...w.forgeInfo.fit } : defaultLoadoutFor();
      this.fits.set(id, preset);
    }
    return this.fits.get(id);
  }

  camoFor(id) {
    if (!this.camos.has(id)) {
      const w = ITEMS[id];
      this.camos.set(id, w && w.forgeInfo ? w.forgeInfo.presetCamo : null);
    }
    return this.camos.get(id);
  }

  upgradesFor(id) {
    if (!this.upgrades.has(id)) this.upgrades.set(id, emptyUpgrades());
    return this.upgrades.get(id);
  }

  get points() {
    return Math.max(0, earnedPoints(this.game.stats) + this.grantedPoints() - this.spent);
  }

  /** Points the player starts with so the hub is usable before a first kill. */
  grantedPoints() { return 12; }

  /** Fully resolved stats for a weapon id, attachments and upgrades folded in. */
  resolve(id) {
    const base = WEAPONS[id];
    if (!base) return null;
    const stats = resolveWeapon(base, this.fitFor(id));
    if (base.kind === 'gun') applyUpgrades(stats, this.upgradesFor(id), base.mag);
    return stats;
  }

  /* ================= open / close ================= */

  // Derived from the DOM as well as the flag: if any other screen hides the
  // armoury, the preview must stop taking the frame with it.
  get isOpen() { return this._open && !this.el.root.classList.contains('hidden'); }

  open(from) {
    this._open = true;
    this._returnTo = from || 'menu';
    this.el.root.classList.remove('hidden');
    document.body.classList.remove('playing');
    if (this.game.weapons && this.game.weapons.currentId) this.selected = this.game.weapons.currentId;
    const w = ITEMS[this.selected];
    if (w && w.forgeInfo) this.chassis = w.forgeInfo.chassis.id;
    else this.chassis = chassisForBase(this.selected);
    this.renderPanel();
    this._swapModel(true);
  }

  close() {
    this._open = false;
    this.el.root.classList.add('hidden');
    if (this._returnTo === 'pause') {
      this.game.ui.showPause();
    } else if (this._returnTo === 'menu') {
      this.game.ui.showMainMenu();
    }
  }

  /* ================= per-frame ================= */

  update(dt) {
    this._t += dt;
    if (!this._dragging) this.yaw += this.spin * dt * 0.35;
    this.pivot.rotation.y = this.yaw;
    this.pivot.rotation.x = this.pitch * 0.5;

    this.gunHolder.visible = this.tab !== 'operator';
    this.opHolder.visible = this.tab === 'operator';

    if (this.opHolder.visible && this.opModel) {
      poseIdle(this.opModel, this._t);
    }
    if (this.gunHolder.visible && this.gunModel) {
      // a slow breathing float, so the turntable does not read as a static mesh
      this.gunModel.position.y = this._gunCenterY + Math.sin(this._t * 0.9) * 0.004;
    }
  }

  /** Draw the turntable. Called by GameManager in place of the world pass. */
  renderPreview(renderer) {
    if (!renderer) return;
    const size = renderer.getSize(_size);
    const aspect = size.x / Math.max(1, size.y);
    this._frameCamera(aspect);
    renderer.setRenderTarget(null);
    // The world is graded for a moonless forest; a display case is not.
    const exposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1.65;
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.toneMappingExposure = exposure;
  }

  /* ================= model swapping ================= */

  /**
   * Put `this.selected` on the turntable. This is the thing the player asked
   * for: pick a shotgun in the list and a shotgun appears, wearing that build.
   */
  _swapModel(force) {
    const id = this.selected;
    const w = ITEMS[id];
    if (!w) return;
    const key = w.viewModel || 'none';

    if (force || this._modelKey !== key) {
      if (this.gunModel) this.gunHolder.remove(this.gunModel);
      if (!this.gunModels.has(key)) this.gunModels.set(key, buildViewModel(key));
      this.gunModel = this.gunModels.get(key);
      this.gunHolder.add(this.gunModel);
      this._modelKey = key;
    }

    dressModel(this.gunModel, this.fitFor(id), this.camoFor(id),
      camoTextureSize(Settings.get('textureQuality')));

    // Recentre: models are authored around the grip, not their own middle.
    // The box has to be measured with the model detached, or `setFromObject`
    // reports world coordinates — including the turntable's own offset and
    // rotation — and the correction sends the weapon off across the screen.
    this.gunModel.position.set(0, 0, 0);
    this.gunHolder.remove(this.gunModel);
    this.gunModel.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.gunModel);
    this.gunHolder.add(this.gunModel);
    const c = box.getCenter(new THREE.Vector3());
    this.gunModel.position.set(-c.x, -c.y, -c.z);
    this._gunCenterY = -c.y;

    // the longest axis decides the scale; _frameCamera turns it into a fit
    this._gunSpan = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  }

  _rebuildOperator() {
    if (this.opModel) { this.opHolder.remove(this.opModel); disposeOperator(this.opModel); }
    this.opModel = buildOperator(this.operator);
    this.opHolder.add(this.opModel);
  }

  /* ================= dom ================= */

  _buildDom() {
    const root = document.getElementById('armoury');
    this.el = {
      root,
      body: root.querySelector('#ar-body'),
      name: root.querySelector('#ar-name'),
      sub: root.querySelector('#ar-sub'),
      stats: root.querySelector('#ar-stats'),
      points: root.querySelector('#ar-points'),
      stage: root.querySelector('.ar-stage'),
    };

    root.querySelectorAll('[data-artab]').forEach((t) => {
      t.addEventListener('click', () => {
        root.querySelectorAll('[data-artab]').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        this.tab = t.dataset.artab;
        this.openSlot = null;
        if (this.tab === 'operator' && !this.opModel) this._rebuildOperator();
        Audio.uiClick();
        this.renderPanel();
      });
    });

    root.querySelector('[data-action="back"]').addEventListener('click', () => {
      Audio.uiClick();
      this.close();
    });

    // drag to turn the subject
    const stage = this.el.stage;
    stage.addEventListener('pointerdown', (e) => {
      this._dragging = true; this._lastX = e.clientX; this._lastY = e.clientY;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      this.yaw += (e.clientX - this._lastX) * 0.008;
      this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch - (e.clientY - this._lastY) * 0.005));
      this._lastX = e.clientX; this._lastY = e.clientY;
    });
    const stop = (e) => {
      this._dragging = false;
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
  }

  /** Rebuild the whole panel for the current tab. */
  renderPanel() {
    if (!this.el) return;
    const body = this.el.body;
    body.innerHTML = '';
    this.el.points.textContent = String(this.points);

    const w = ITEMS[this.selected];
    const info = w && w.forgeInfo;
    if (this.tab === 'operator') {
      // the caption names whatever the turntable is actually showing
      const o = this.operator;
      this.el.name.textContent = 'OPERATOR';
      this.el.sub.textContent = [
        optLabel('headgear', o.headgear), optLabel('face', o.face),
        optLabel('torso', o.torso), optLabel('palette', o.palette),
      ].join(' · ').toUpperCase();
    } else {
      this.el.name.textContent = w ? w.name : '—';
      this.el.sub.innerHTML = info
        ? `<span style="color:${info.tier.color}">${info.tier.label.toUpperCase()}</span> · ${info.chassis.label.toUpperCase()} · POWER ${info.rating}`
        : (w ? `${(w.rarity || 'standard').toUpperCase()} · ${w.kind === 'melee' ? 'MELEE' : 'STANDARD ISSUE'}` : '');
    }

    if (this.tab === 'weapons') this._renderWeapons(body);
    else if (this.tab === 'attach') this._renderAttachments(body);
    else if (this.tab === 'camo') this._renderCamo(body);
    else if (this.tab === 'upgrades') this._renderUpgrades(body);
    else if (this.tab === 'operator') this._renderOperator(body);

    this._renderStatline();
  }

  _renderStatline() {
    const s = this.resolve(this.selected);
    if (!s) { this.el.stats.textContent = ''; return; }
    const cells = s.kind === 'gun' ? [
      ['DMG', s.pellets ? `${Math.round(s.damage)}×${s.pellets}` : Math.round(s.damage)],
      ['RPM', Math.round(s.rate * 60)],
      ['MAG', s.mag],
      ['RNG', `${Math.round(s.range)}m`],
      ['ADS', `${s.adsTime.toFixed(2)}s`],
      ['RCL', s.recoil.toFixed(2)],
    ] : [
      ['DMG', Math.round(s.damage)],
      ['REACH', `${s.range.toFixed(1)}m`],
      ['RATE', s.rate.toFixed(1)],
      ['STAM', s.staminaCost],
    ];
    this.el.stats.innerHTML = cells.map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('');
  }

  /* ---------------- weapons tab ---------------- */

  _renderWeapons(body) {
    const wrap = div('ar-cols');

    /* class rail */
    const rail = div('ar-rail');
    rail.appendChild(railHead('CLASS'));
    for (const c of CHASSIS_LIST) {
      const b = document.createElement('button');
      b.className = 'lo-item ar-class' + (this.chassis === c.id ? ' sel' : '');
      b.innerHTML = `<span class="n">${c.label}</span><span class="c">${WEAPONS[c.base].name}</span>`;
      b.addEventListener('click', () => {
        this.chassis = c.id; this.forgePageNo = 0; Audio.uiMove(); this.renderPanel();
      });
      rail.appendChild(b);
    }
    const mb = document.createElement('button');
    mb.className = 'lo-item ar-class' + (this.chassis === 'melee' ? ' sel' : '');
    mb.innerHTML = '<span class="n">Melee</span><span class="c">Silent, endless</span>';
    mb.addEventListener('click', () => { this.chassis = 'melee'; Audio.uiMove(); this.renderPanel(); });
    rail.appendChild(mb);
    wrap.appendChild(rail);

    /* weapon list */
    const list = div('ar-list');
    if (this.chassis === 'melee') {
      list.appendChild(railHead('SIDEARM ALTERNATIVES'));
      for (const id of MELEE_IDS) list.appendChild(this._weaponRow(id));
    } else {
      const c = CHASSIS_LIST.find((x) => x.id === this.chassis);
      list.appendChild(railHead('STANDARD PATTERN'));
      list.appendChild(this._weaponRow(c.base));

      list.appendChild(railHead(`FORGED — ${FORGE_SPACE.toLocaleString()} VARIANTS`));
      const seeds = forgePageFor(this.chassis, this.forgePageNo, FORGE_PER_PAGE, this.forgeSalt);
      for (const seed of seeds) {
        forgeWeapon(seed);
        list.appendChild(this._weaponRow(forgeId(seed)));
      }
      const more = document.createElement('button');
      more.className = 'lo-item ar-more';
      more.textContent = 'FORGE MORE ▸';
      more.addEventListener('click', () => {
        this.forgePageNo++; Audio.uiClick(); this.renderPanel();
        list.scrollTop = 0;
      });
      list.appendChild(more);
    }
    wrap.appendChild(list);
    body.appendChild(wrap);

    const note = div('set-note');
    note.textContent = 'Forged weapons are generated from a seed, so the list never runs out and any '
      + 'weapon you keep can be recovered from eight hex digits. Selecting one issues it to you.';
    body.appendChild(note);
  }

  _weaponRow(id) {
    const w = ITEMS[id] || WEAPONS[id];
    const s = this.resolve(id);
    const info = w.forgeInfo;
    const b = document.createElement('button');
    b.className = 'lo-item ar-weapon' + (this.selected === id ? ' sel' : '');
    if (info) b.style.setProperty('--tier', info.tier.color);
    const traits = info && info.traits.length
      ? `<span class="tr">${info.traits.map((t) => t.label).join(' · ')}</span>` : '';
    const meta = w.kind === 'gun'
      ? `${Math.round(s.damage)}<i>dmg</i> ${Math.round(s.rate * 60)}<i>rpm</i> ${s.mag}<i>rds</i>`
      : `${Math.round(s.damage)}<i>dmg</i> ${s.range.toFixed(1)}<i>m</i>`;
    b.innerHTML =
      `<span class="row1"><span class="nm">${escapeHtml(w.name)}</span>` +
      (info ? `<span class="pw">${info.rating}</span>` : '') + '</span>' +
      `<span class="row2">${meta}</span>${traits}`;
    b.addEventListener('click', () => this.selectWeapon(id));
    return b;
  }

  selectWeapon(id) {
    if (!ITEMS[id]) return;
    this.selected = id;
    this.unlocked.add(id);
    this.primary = id;
    Audio.uiClick();
    this._swapModel();
    this.issue(id);
    this.renderPanel();
  }

  /**
   * Put the selected weapon in the player's hands. In a live run this is an
   * immediate swap; from the main menu it is remembered and applied when the
   * run starts.
   */
  issue(id) {
    const G = this.game;
    if (!G.inventory || !G.weapons || G.state !== 'PLAYING') return;
    const w = ITEMS[id];
    if (!w) return;
    if (!G.inventory.has(id)) G.inventory.add(id, 1);
    if (w.kind === 'gun' && G.inventory.count(w.ammo) < w.mag) {
      G.inventory.add(w.ammo, w.mag * 2);
    }
    G.inventory.equip(id);
    G.weapons.equip(id);
    G.ui.toast(`${w.name} issued`, 'good');
  }

  /* ---------------- attachments tab ---------------- */

  _renderAttachments(body) {
    const id = this.selected;
    const w = ITEMS[id];
    if (!w || w.kind !== 'gun') {
      body.appendChild(makeNote('Melee weapons take no attachments. Pick a firearm to build it out.'));
      return;
    }
    const fit = this.fitFor(id);

    for (const slot of SLOTS) {
      const cur = getAttachment(slot, fit[slot]);
      const head = document.createElement('button');
      head.className = 'lo-item ar-slot' + (this.openSlot === slot ? ' open' : '');
      head.innerHTML = `<span class="sl">${SLOT_LABEL[slot]}</span><span class="cu">${escapeHtml(cur.name)}</span><span class="ch">${this.openSlot === slot ? '▾' : '▸'}</span>`;
      head.addEventListener('click', () => {
        this.openSlot = this.openSlot === slot ? null : slot;
        Audio.uiMove();
        this.renderPanel();
      });
      body.appendChild(head);

      if (this.openSlot !== slot) continue;
      const opts = div('ar-opts');
      for (const a of Object.values(ATTACHMENTS[slot])) {
        const o = document.createElement('button');
        o.className = 'lo-item ar-opt' + (fit[slot] === a.id ? ' sel' : '');
        const mods = describeMods(a).map((m) =>
          `<i class="${m.good ? 'up' : 'dn'}">${m.delta > 0 ? '+' : ''}${m.delta}% ${m.label}</i>`).join('');
        o.innerHTML = `<span class="nm">${escapeHtml(a.name)}</span>` +
          (a.desc ? `<span class="ds">${escapeHtml(a.desc)}</span>` : '') +
          (mods ? `<span class="md">${mods}</span>` : '');
        o.addEventListener('click', () => {
          fit[slot] = a.id;
          Audio.uiClick();
          this._swapModel();
          this._syncLiveWeapon();
          this.renderPanel();
        });
        opts.appendChild(o);
      }
      body.appendChild(opts);
    }
  }

  /* ---------------- camo tab ---------------- */

  _renderCamo(body) {
    const id = this.selected;
    const cur = this.camoFor(id);

    const head = div('ar-camohead');
    head.innerHTML =
      `<div class="cnt"><b>${CAMO_SPACE.toLocaleString()}</b> generated finishes</div>` +
      `<div class="now">${cur === null || cur === undefined ? 'Factory finish' : escapeHtml(camoName(cur))}</div>`;
    body.appendChild(head);

    const tools = div('ar-tools');

    const bare = button('FACTORY', () => { this.camos.set(id, null); this._afterCamo(); });
    const rand = button('RANDOMISE', () => { this.camos.set(id, (Math.random() * CAMO_SPACE) >>> 0); this._afterCamo(); });
    const shuffle = button('NEW PAGE', () => { this.camoSalt = (Math.random() * 1e9) | 0; this.camoPageNo = 0; this.renderPanel(); });
    tools.append(bare, rand, shuffle);

    const seedBox = document.createElement('input');
    seedBox.type = 'text';
    seedBox.className = 'ar-seed';
    seedBox.placeholder = 'finish code';
    seedBox.value = cur === null || cur === undefined ? '' : (cur >>> 0).toString(16).toUpperCase().padStart(8, '0');
    seedBox.addEventListener('change', () => {
      const v = parseInt(seedBox.value.trim(), 16);
      if (!Number.isNaN(v)) { this.camos.set(id, v >>> 0); this._afterCamo(); }
    });
    tools.appendChild(seedBox);
    body.appendChild(tools);

    const grid = div('ar-camogrid');
    for (const seed of camoPage(this.camoPageNo, CAMO_PER_PAGE, this.camoSalt)) {
      const info = camoInfo(seed);
      const b = document.createElement('button');
      b.className = 'lo-item ar-swatch' + (cur === seed ? ' sel' : '');
      b.style.backgroundImage = `url(${camoSwatch(seed, 56)})`;
      b.style.setProperty('--rar', info.rarity.color);
      b.title = `${info.name} — ${info.rarity.label} · ${info.familyLabel}`;
      b.addEventListener('click', () => { this.camos.set(id, seed); this._afterCamo(); });
      grid.appendChild(b);
    }
    body.appendChild(grid);

    const pager = div('ar-tools');
    pager.append(
      button('◂ PREV', () => { this.camoPageNo = Math.max(0, this.camoPageNo - 1); this.renderPanel(); }),
      label(`PAGE ${this.camoPageNo + 1}`),
      button('NEXT ▸', () => { this.camoPageNo++; this.renderPanel(); })
    );
    body.appendChild(pager);

    body.appendChild(makeNote('Every finish is drawn from its code, not stored — the code is the camo. '
      + 'Type a code above to recover any of them exactly.'));
  }

  _afterCamo() {
    Audio.uiClick();
    this._swapModel();
    this._syncLiveWeapon();
    this.renderPanel();
  }

  /* ---------------- upgrades tab ---------------- */

  _renderUpgrades(body) {
    const id = this.selected;
    const w = ITEMS[id];
    if (!w || w.kind !== 'gun') {
      body.appendChild(makeNote('Melee weapons cannot be tuned in the armoury.'));
      return;
    }
    const levels = this.upgradesFor(id);

    body.appendChild(makeNote('Points come from surviving: two a kill, four a landmark, one every two minutes '
      + 'on your feet. They are spent per weapon, so commit to something.'));

    for (const t of UPGRADE_TRACKS) {
      const n = levels[t.id] || 0;
      const cost = upgradeCost(t, n);
      const maxed = n >= t.max;
      const afford = this.points >= cost;

      const row = document.createElement('button');
      row.className = 'lo-item ar-upg' + (maxed ? ' maxed' : afford ? '' : ' poor');
      const pips = Array.from({ length: t.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      row.innerHTML =
        `<span class="row1"><span class="nm">${t.label}</span><span class="pips">${pips}</span></span>` +
        `<span class="ds">${escapeHtml(t.desc)}</span>` +
        `<span class="row2">${n ? `<i class="up">${t.line(n)}</i>` : '<i class="none">Not tuned</i>'}` +
        `<span class="cost">${maxed ? 'MAX' : `${cost} PT`}</span></span>`;
      row.addEventListener('click', () => {
        if (maxed) { Audio.denied(); return; }
        if (this.points < cost) { Audio.denied(); this.game.ui.toast('Not enough armoury points', 'bad'); return; }
        levels[t.id] = n + 1;
        this.spent += cost;
        Audio.uiClick();
        this._syncLiveWeapon();
        this.renderPanel();
      });
      body.appendChild(row);
    }

    const invested = investedIn(levels);
    if (invested > 0) {
      const reset = document.createElement('button');
      reset.className = 'lo-item ar-reset';
      reset.textContent = `STRIP TUNING — REFUND ${invested} PT`;
      reset.addEventListener('click', () => {
        this.spent = Math.max(0, this.spent - invested);
        this.upgrades.set(id, emptyUpgrades());
        Audio.uiClick();
        this._syncLiveWeapon();
        this.renderPanel();
      });
      body.appendChild(reset);
    }
  }

  /* ---------------- operator tab ---------------- */

  _renderOperator(body) {
    body.appendChild(makeNote('The figure on the right is you. Nothing here changes your hitbox — the '
      + 'silhouette is for the player, not the mutants.'));

    for (const kind of ['headgear', 'face', 'torso', 'legs', 'skin', 'palette']) {
      const wrap = div('ar-opgroup');
      wrap.appendChild(railHead(LABELS[kind]));
      const rowEl = div('ar-chips');
      for (const o of OPERATOR_OPTIONS[kind]) {
        const b = document.createElement('button');
        b.className = 'lo-item ar-chip' + (this.operator[kind] === o.id ? ' sel' : '');
        b.textContent = o.label;
        if (kind === 'palette') b.style.setProperty('--sw', '#' + o.cloth.toString(16).padStart(6, '0'));
        if (kind === 'skin') b.style.setProperty('--sw', '#' + o.color.toString(16).padStart(6, '0'));
        if (kind === 'palette' || kind === 'skin') b.classList.add('hasw');
        b.addEventListener('click', () => {
          this.operator[kind] = o.id;
          Audio.uiClick();
          this._rebuildOperator();
          this.renderPanel();
        });
        rowEl.appendChild(b);
      }
      wrap.appendChild(rowEl);
      body.appendChild(wrap);
    }

    const tools = div('ar-tools');
    tools.append(
      button('RANDOMISE', () => {
        for (const kind of Object.keys(OPERATOR_OPTIONS)) {
          const list = OPERATOR_OPTIONS[kind];
          this.operator[kind] = list[Math.floor(Math.random() * list.length)].id;
        }
        Audio.uiClick(); this._rebuildOperator(); this.renderPanel();
      }),
      button('RESET', () => { this.operator = defaultOperator(); Audio.uiClick(); this._rebuildOperator(); this.renderPanel(); }),
      button('WEAPON READY POSE', () => { if (this.opModel) poseReady(this.opModel, this._t); })
    );
    body.appendChild(tools);
  }

  /* ================= plumbing ================= */

  /** Push a build change into the weapon the player is actually holding. */
  _syncLiveWeapon() {
    const W = this.game.weapons;
    if (W && W.currentId === this.selected) W.refit();
  }

  /** Apply the chosen loadout at the start of a run. */
  applyToRun() {
    const G = this.game;
    if (!G.inventory || !G.weapons) return;
    const id = this.primary;
    const w = ITEMS[id];
    if (!w || id === 'pistol9') return;
    if (!G.inventory.has(id)) G.inventory.add(id, 1);
    if (w.kind === 'gun') G.inventory.add(w.ammo, w.mag * 2);
    G.inventory.equip(id);
    G.inventory.assignQuick(0, id);
    G.weapons.equip(id);
  }

  serialize() {
    return {
      fits: Array.from(this.fits.entries()),
      camos: Array.from(this.camos.entries()),
      upgrades: Array.from(this.upgrades.entries()),
      spent: this.spent,
      operator: { ...this.operator },
      primary: this.primary,
      unlocked: Array.from(this.unlocked),
    };
  }

  deserialize(d) {
    if (!d) return;
    ensureForgedIn(d);
    this.fits = new Map(d.fits || []);
    this.camos = new Map(d.camos || []);
    this.upgrades = new Map(d.upgrades || []);
    this.spent = d.spent || 0;
    this.operator = { ...defaultOperator(), ...(d.operator || {}) };
    this.primary = d.primary || 'pistol9';
    this.unlocked = new Set(d.unlocked || []);
  }
}

/* ------------------------------------------------------------------ */

const LABELS = {
  headgear: 'HEADGEAR', face: 'FACE', torso: 'TORSO', legs: 'LEGS',
  skin: 'COMPLEXION', palette: 'COLOURWAY',
};

function optLabel(kind, id) {
  const o = OPERATOR_OPTIONS[kind].find((x) => x.id === id);
  return o ? o.label : id;
}

function chassisForBase(id) {
  const c = CHASSIS_LIST.find((x) => x.base === id);
  return c ? c.id : (MELEE_IDS.includes(id) ? 'melee' : 'sidearm');
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
function railHead(text) { const d = div('ar-head2'); d.textContent = text; return d; }
function label(text) { const d = div('ar-label'); d.textContent = text; return d; }
function button(text, fn) {
  const b = document.createElement('button');
  b.className = 'lo-item ar-btn';
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}
function makeNote(text) { const d = div('set-note'); d.textContent = text; return d; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const _size = new THREE.Vector2();
