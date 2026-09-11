import { input, ACTIONS } from '../core/input.js';
import { PAD_GLYPHS } from '../core/gamepad.js';
import { settings } from '../core/settings.js';

export class ControllerUI {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.focus = null;
    this.index = 0;
    this.direction = '';
    this.repeatAt = 0;
    this.lastPad = '';
    this.status = document.createElement('p');
    this.status.id = 'controller-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.status);
    this.gamepadLost = false;
  }
  surface() {
    return ['shop', 'overlay', 'menu'].map(id => document.getElementById(id)).find(el => !el.classList.contains('hidden')) || null;
  }
  controls() {
    return [...this.root.querySelectorAll('button,select,input,a[href],[role="button"]')]
      .filter(el => !el.disabled && el.type !== 'hidden' && !el.closest('.hidden') && el.getClientRects().length);
  }
  moveTo(el) {
    this.focus?.classList.remove('pad-focus');
    this.focus = el || null;
    if (!el) return;
    this.index = Math.max(0, this.controls().indexOf(el));
    el.classList.add('pad-focus');
    el.focus({preventScroll:true});
    el.scrollIntoView({block:'nearest', inline:'nearest'});
  }
  back() {
    if (input._capture) { input.cancelCapture(); return; }
    if (this.game.shop.open) this.game.shop.close();
    else if (this.game.overlay.open) { this.game.overlay.hide(); this.game.paused = false; }
    else this.moveTo(document.querySelector('#mainmenu [aria-current="true"]'));
  }
  adjust(el, direction) {
    if (el?.tagName === 'SELECT') {
      el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + direction));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    }
    if (el?.type === 'range' || el?.type === 'number') {
      const step = Number(el.step) || 1;
      el.value = String(Math.max(Number(el.min || 0), Math.min(Number(el.max || 100), (Number(el.value) || 0) + step * direction)));
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    }
    return false;
  }
  update(dt) {
    if ((!input.focused || (this.lastPad && !input.pad)) && this.game.running && !this.game.paused && input.lastDevice === 'pad') {
      this.game.paused = true;
      this.game.overlay.show('controls');
      input.releaseLock();
      this.gamepadLost = true;
    }
    this.lastPad = input.gamepad.key;
    const root = this.surface();
    const type = settings.padType === 'auto' ? input.detectPadType() : settings.padType;
    const ps = type === 'playstation';
    let label = input.pad ? `${ps ? 'PlayStation' : 'Xbox'} controller · ${ps ? '✕' : 'A'} select · ${ps ? '○' : 'B'} back · D-pad / left stick navigate · ${ps ? 'L1 / R1' : 'LB / RB'} tabs` : 'Connect a DualSense, DualShock 4 or Xbox controller by USB or Bluetooth, then press a button.';
    if (this.gamepadLost && !input.pad) label = 'Controller disconnected or game unfocused. Reconnect, then resume with Options / Menu.';
    if (input.pad) this.gamepadLost = false;
    if (root && /^(text|url)$/.test(this.focus?.type)) label += ' · Use a keyboard for text entry.';
    if (this.status.textContent !== label) this.status.textContent = label;
    this.status.hidden = !root;
    if (!root) { this.focus?.classList.remove('pad-focus'); this.root = null; this.focus = null; return false; }
    if (root !== this.root) { this.focus?.classList.remove('pad-focus'); this.root = root; this.focus = null; this.index=0; this.direction=''; }
    if (input.lastDevice !== 'pad') this.focus?.classList.remove('pad-focus');
    if (input.pressed('pause') || input.gamepad.pressed.has(1)) { this.back(); return true; }
    if (!input.pad || input.lastDevice !== 'pad') return true;
    const controls = this.controls();
    if (!controls.length) return true;
    if (!controls.includes(this.focus)) this.moveTo(controls[Math.min(this.index, controls.length - 1)]);
    else this.focus.classList.add('pad-focus');
    if (input._capture) return true;

    // Shoulder buttons switch menu categories without scrolling past every control.
    const shoulder = input.gamepad.pressed.has(4) ? -1 : input.gamepad.pressed.has(5) ? 1 : 0;
    if (shoulder) {
      const tabs = [...root.querySelectorAll(root.id === 'menu' ? '#mainmenu button' : '#overlay-tabs button')];
      if (tabs.length) {
        const current = Math.max(0, tabs.findIndex(el => el.getAttribute('aria-current') === 'true'));
        const next = tabs[(current + shoulder + tabs.length) % tabs.length];
        next.click(); this.moveTo(next);
      }
    }
    const held = input.gamepad.held;
    const axes = input.pad.axes;
    const dir = held.has(12) || axes[1] < -.55 ? 'up' : held.has(13) || axes[1] > .55 ? 'down' : held.has(14) || axes[0] < -.55 ? 'left' : held.has(15) || axes[0] > .55 ? 'right' : '';
    const now = performance.now();
    if (dir && (dir !== this.direction || now >= this.repeatAt)) {
      this.repeatAt = now + (dir !== this.direction ? 380 : 150);
      const sign = dir === 'up' || dir === 'left' ? -1 : 1;
      if (!(['left','right'].includes(dir) && this.adjust(this.focus,sign))) {
        const list = this.controls();
        const index = list.indexOf(this.focus);
        this.moveTo(list[(index + sign + list.length) % list.length]);
      }
    }
    this.direction = dir;
    if (input.gamepad.pressed.has(0)) {
      const el = this.focus;
      input.consumePadPresses();
      if (el.tagName === 'SELECT') this.adjust(el, 1);
      else if (!['range','text','url','number'].includes(el.type)) {
        el.click();
        if (el.closest('#mainmenu')) this.moveTo(document.querySelector('#menupanel button, #menupanel select, #menupanel input'));
      }
    }
    // Right stick scrolls long panels; left stick is reserved for focus movement.
    if (Math.abs(axes[3] || 0) > .25) {
      const pane = root.querySelector('#overlay-body, #shop-body, #menupanel') || root;
      pane.scrollTop += axes[3] * 550 * dt;
    }
    return true;
  }
}

export function controllerGuide() {
  return `<div class="controller-guide"><h4>PlayStation / Xbox controls</h4><p>USB or Bluetooth. Press any button to activate. Use the D-pad or left stick in menus; ✕ / A selects, ○ / B goes back, L1–R1 / LB–RB changes tabs. Left/right adjusts a selected setting. Text entry and keyboard rebinding use a keyboard.</p><div class="pad-bindings">${Object.entries(ACTIONS).map(([action,def]) => `<span>${def.label}</span><b>${PAD_GLYPHS.playstation[action] || 'Left stick'}</b><b>${PAD_GLYPHS.xbox[action] || 'Left stick'}</b>`).join('')}</div></div>`;
}
