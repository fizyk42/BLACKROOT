/**
 * ModMenu — the sandbox UI, generated entirely from the MODS table.
 *
 * There is no hand-written markup for any individual switch: adding a toy to
 * Sandbox.js makes it appear here, in the right group, with its label, help
 * text, range and formatting, and the automated test picks it up too. The menu
 * is a *view* of the mod list, which is the only way a list this long stays in
 * step with the code behind it.
 *
 * It deliberately does not pause the game. Half the value of a sandbox is
 * watching a slider take effect on something that is still moving.
 */
import { MODS, MOD_GROUPS, TUTORIAL } from '../systems/Sandbox.js';
import { Audio } from '../core/AudioManager.js';

export class ModMenu {
  constructor(game) {
    this.game = game;
    this.group = 'Player';
    this.tutorialStep = -1;
    this.el = {
      root: document.getElementById('modmenu'),
      tabs: document.getElementById('mm-tabs'),
      body: document.getElementById('mm-body'),
      hint: document.getElementById('mm-hint'),
      tut: document.getElementById('sbtut'),
    };
    this._buildTabs();
    this._bind();
  }

  get sandbox() { return this.game.sandbox; }
  get open() { return !this.el.root.classList.contains('hidden'); }

  /* ================= chrome ================= */

  _buildTabs() {
    this.el.tabs.innerHTML = '';
    for (const g of MOD_GROUPS) {
      const b = document.createElement('button');
      b.className = 'tab' + (g === this.group ? ' active' : '');
      b.textContent = g.toUpperCase();
      b.dataset.group = g;
      b.addEventListener('click', () => {
        this.group = g;
        Audio.uiClick();
        this._buildTabs();
        this.render();
      });
      this.el.tabs.appendChild(b);
    }
  }

  _bind() {
    this.el.root.querySelector('[data-mm="reset"]').addEventListener('click', () => {
      this.sandbox.reset();
      this.render();
      this.game.ui.toast('Every mod reset', '');
      Audio.uiClick();
    });
    this.el.root.querySelector('[data-mm="tutorial"]').addEventListener('click', () => this.startTutorial());
    this.el.tut.querySelector('[data-sbt="next"]').addEventListener('click', () => this.tutorialNext(1));
    this.el.tut.querySelector('[data-sbt="back"]').addEventListener('click', () => this.tutorialNext(-1));
    this.el.tut.querySelector('[data-sbt="skip"]').addEventListener('click', () => this.endTutorial());
  }

  /* ================= open / close ================= */

  toggle(force) {
    const want = force !== undefined ? force : !this.open;
    this.el.root.classList.toggle('hidden', !want);
    if (want) {
      this.render();
      // The mouse has to be free to use the menu, but the game keeps running.
      this.game.input.exitLock();
    } else if (this.game.state === 'PLAYING') {
      this.game.input.requestLock();
    }
    Audio.uiClick();
    return want;
  }

  /* ================= rendering ================= */

  render() {
    if (!this.open) return;
    const body = this.el.body;
    body.innerHTML = '';
    const sb = this.sandbox;

    for (const mod of MODS) {
      if (mod.group !== this.group) continue;
      const row = document.createElement('div');
      row.className = 'mm-row' + (mod.type === 'action' ? ' action' : '');
      row.dataset.mod = mod.id;

      if (mod.type === 'action') {
        const b = document.createElement('button');
        b.className = 'mm-btn';
        b.textContent = mod.label;
        b.addEventListener('click', () => {
          sb.run(mod.id);
          this.render();
        });
        row.appendChild(b);
        if (mod.help) {
          const h = document.createElement('span');
          h.className = 'help';
          h.textContent = mod.help;
          row.appendChild(h);
        }
        body.appendChild(row);
        continue;
      }

      const label = document.createElement('div');
      label.innerHTML = `<span class="lbl">${mod.label}</span>` +
        (mod.help ? `<span class="help">${mod.help}</span>` : '');
      row.appendChild(label);

      if (mod.type === 'toggle') {
        const t = document.createElement('div');
        t.className = 'toggle' + (sb.get(mod.id) ? ' on' : '');
        t.innerHTML = '<i></i>';
        t.addEventListener('click', () => {
          const v = !sb.get(mod.id);
          sb.set(mod.id, v);
          t.classList.toggle('on', v);
          Audio.uiClick();
        });
        row.appendChild(t);
      } else if (mod.type === 'pick') {
        const sel = document.createElement('select');
        for (const o of mod.options()) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o;
          if (sb.get(mod.id) === o) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => { sb.set(mod.id, sel.value); Audio.uiMove(); });
        row.appendChild(sel);
      } else if (mod.type === 'slider') {
        const val = document.createElement('div');
        val.className = 'val';
        const fmt = mod.fmt || ((v) => String(v));
        val.textContent = fmt(sb.get(mod.id));
        row.appendChild(val);
        const i = document.createElement('input');
        i.type = 'range';
        i.min = mod.min; i.max = mod.max; i.step = mod.step;
        i.value = sb.get(mod.id);
        i.addEventListener('input', () => {
          const v = parseFloat(i.value);
          sb.set(mod.id, v);
          val.textContent = fmt(v);
        });
        row.appendChild(i);
      }
      body.appendChild(row);
    }

    this.el.hint.textContent = `${MODS.filter((m) => m.group === this.group).length} mods in ${this.group}`
      + ` · ${MODS.length} in total`;
  }

  /* ================= tutorial ================= */

  startTutorial() {
    this.tutorialStep = 0;
    this.el.tut.classList.remove('hidden');
    this._renderTutorial();
  }

  endTutorial() {
    this.tutorialStep = -1;
    this.el.tut.classList.add('hidden');
    try { localStorage.setItem('blackroot.sandboxTutorial', '1'); } catch (e) { /* private mode */ }
  }

  tutorialNext(dir) {
    const n = this.tutorialStep + dir;
    if (n < 0) return;
    if (n >= TUTORIAL.length) { this.endTutorial(); return; }
    this.tutorialStep = n;
    this._renderTutorial();
    Audio.uiClick();
  }

  _renderTutorial() {
    const step = TUTORIAL[this.tutorialStep];
    if (!step) return;
    const t = this.el.tut;
    t.querySelector('.sbt-step').textContent = `STEP ${this.tutorialStep + 1} OF ${TUTORIAL.length}`;
    t.querySelector('.sbt-title').textContent = step.title;
    t.querySelector('.sbt-body').textContent = step.body;
    t.querySelector('[data-sbt="back"]').disabled = this.tutorialStep === 0;
    t.querySelector('[data-sbt="next"]').textContent =
      this.tutorialStep === TUTORIAL.length - 1 ? 'DONE' : 'NEXT';

    // Only ever one highlight: a stale flash from the previous step would
    // point the player at the wrong switch.
    for (const el of this.el.body.querySelectorAll('.mm-row.flash')) el.classList.remove('flash');

    // Steps that point at a mod open the menu on that mod's group and flash it,
    // so the player is looking at the thing being described.
    if (step.focus) {
      const mod = MODS.find((m) => m.id === step.focus);
      if (mod) {
        this.toggle(true);
        if (this.group !== mod.group) { this.group = mod.group; this._buildTabs(); }
        this.render();
        const row = this.el.body.querySelector(`[data-mod="${mod.id}"]`);
        if (row) {
          row.classList.remove('flash');
          void row.offsetWidth;
          row.classList.add('flash');
          row.scrollIntoView({ block: 'center' });
        }
      }
    }
  }

  /** Has this player seen the tutorial before? */
  static seen() {
    try { return localStorage.getItem('blackroot.sandboxTutorial') === '1'; } catch (e) { return false; }
  }
}
