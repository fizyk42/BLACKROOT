// Unified input: keyboard + mouse + Gamepad API (Xbox / PlayStation layouts).
// Exposes a stable action map so gameplay code never touches raw key codes.

import { settings, saveSettings } from './settings.js';
import { clamp } from './util.js';
import { GamepadState, FOOT_BUTTONS, CAR_BUTTONS, PAD_GLYPHS, padType, deadzone } from './gamepad.js';

export const ACTIONS = {
  forward: { label: 'Move forward', keys: ['KeyW', 'ArrowUp'] },
  back: { label: 'Move back', keys: ['KeyS', 'ArrowDown'] },
  left: { label: 'Move left', keys: ['KeyA', 'ArrowLeft'] },
  right: { label: 'Move right', keys: ['KeyD', 'ArrowRight'] },
  sprint: { label: 'Sprint', keys: ['ShiftLeft', 'ShiftRight'] },
  jump: { label: 'Jump', keys: ['Space'] },
  crouch: { label: 'Crouch', keys: ['ControlLeft', 'KeyC'] },
  interact: { label: 'Interact / enter vehicle', keys: ['KeyE'] },
  aim: { label: 'Aim', keys: [] , mouse: 2 },
  fire: { label: 'Fire / melee', keys: [], mouse: 0 },
  reload: { label: 'Reload', keys: ['KeyR'] },
  nextWeapon: { label: 'Next weapon', keys: ['KeyQ'] },
  holster: { label: 'Holster weapon', keys: ['KeyX'] },
  handbrake: { label: 'Handbrake', keys: ['Space'] },
  horn: { label: 'Horn', keys: ['KeyH'] },
  camera: { label: 'Change camera', keys: ['KeyV'] },
  recover: { label: 'Recover stuck vehicle', keys: ['KeyU'] },
  headlights: { label: 'Headlights', keys: ['KeyL'] },
  map: { label: 'Map', keys: ['KeyM'] },
  phone: { label: 'Phone', keys: ['KeyT'] },
  journal: { label: 'Mission journal', keys: ['KeyJ'] },
  pause: { label: 'Pause / back', keys: ['Escape'] },
  roster: { label: 'Show players (online)', keys: ['Tab'] },
};

const DEFAULT_BINDINGS = {};
for (const k in ACTIONS) DEFAULT_BINDINGS[k] = ACTIONS[k].keys.slice();

class Input {
  constructor() {
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: new Set() };
    this.pad = null;
    this.gamepad = new GamepadState();
    this.focused = true;
    this.context = 'foot';
    this.padId = '';
    this.lastDevice = 'kbm'; // kbm | pad
    this.locked = false;
    this.enabled = true;
    this.axes = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, throttle: 0, brake: 0, steer: 0 };
    this.bindings = settings.bindings || JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    settings.bindings = this.bindings;
    this._capture = null;
    this._install();
  }

  _install() {
    addEventListener('keydown', (e) => {
      if (this._capture) { this._finishCapture(e.code); e.preventDefault(); return; }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
      if (e.code === 'Tab' && !document.querySelector('.screen:not(.hidden)')) e.preventDefault();
      if (this.down.has(e.code)) return;
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
      this.lastDevice = 'kbm';
    });
    addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    });
    addEventListener('blur', () => { this.focused = false; this.down.clear(); this.mouse.buttons.clear(); this.pressedThisFrame.clear(); this.releasedThisFrame.clear(); this.mouse.dx = this.mouse.dy = 0; this.gamepad.reset(); });
    addEventListener('focus', () => { this.focused = true; });

    const canvas = document.getElementById('viewport');
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.buttons.add(e.button);
      this.pressedThisFrame.add('Mouse' + e.button);
      this.lastDevice = 'kbm';
    });
    addEventListener('mouseup', (e) => {
      this.mouse.buttons.delete(e.button);
      this.releasedThisFrame.add('Mouse' + e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    addEventListener('gamepaddisconnected', (e) => { if (this.pad?.index === e.gamepad.index) { this.gamepad.reset(); this.pad = null; } });
  }

  requestLock() {
    const c = document.getElementById('viewport');
    if (this.lastDevice === 'pad') return;
    if (document.pointerLockElement !== c && c.requestPointerLock) {
      const p = c.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Poll gamepad + fold everything into `axes`. Call once per frame before gameplay. */
  update(dt = 1 / 60, context = 'foot') {
    this.context = context;
    let pads = [];
    try { if (this.focused) pads = navigator.getGamepads?.() || []; } catch {}
    this.pad = this.gamepad.sample(pads, settings.stickDeadzone);
    this.padId = this.pad?.id || '';
    if (this.gamepad.active) this.lastDevice = 'pad';
    for (const i of this.gamepad.pressed) this.pressedThisFrame.add('Pad' + i);
    for (const i of this.gamepad.released) this.releasedThisFrame.add('Pad' + i);
    const ax = v => deadzone(v, settings.stickDeadzone);

    let mx = 0, my = 0, lx = 0, ly = 0, thr = 0, brk = 0;
    if (this.isDown('right')) mx += 1;
    if (this.isDown('left')) mx -= 1;
    if (this.isDown('forward')) my += 1;
    if (this.isDown('back')) my -= 1;

    if (this.pad) {
      const px = ax(this.pad.axes[0] || 0), py = ax(this.pad.axes[1] || 0);
      const rx = ax(this.pad.axes[2] || 0), ry = ax(this.pad.axes[3] || 0);
      if (px || py || rx || ry) this.lastDevice = 'pad';
      mx += px; my -= py;
      lx += rx; ly += ry;
      const rt = this.pad.buttons[7] ? this.pad.buttons[7].value : 0;
      const lt = this.pad.buttons[6] ? this.pad.buttons[6].value : 0;
      const tdz = settings.triggerDeadzone;
      thr = rt > tdz ? (rt - tdz) / (1 - tdz) : 0;
      brk = lt > tdz ? (lt - tdz) / (1 - tdz) : 0;
      if (thr > 0.1 || brk > 0.1) this.lastDevice = 'pad';

    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.axes.moveX = mx;
    this.axes.moveY = my;

    // Look: mouse delta plus a frame-rate-independent right stick.
    const ms = settings.mouseSensitivity * 0.0022;
    this.axes.lookX = this.mouse.dx * ms + lx * settings.padSensitivity * 3.3 * Math.min(.05, Math.max(0, dt));
    this.axes.lookY = this.mouse.dy * ms + ly * settings.padSensitivity * 3.3 * Math.min(.05, Math.max(0, dt));
    if (settings.invertY) this.axes.lookY *= -1;
    this.mouse.dx = 0; this.mouse.dy = 0;

    // Driving: triggers if present, otherwise W/S.
    this.axes.throttle = Math.max(thr, this.isDown('forward') ? 1 : 0);
    this.axes.brake = Math.max(brk, this.isDown('back') ? 1 : 0);
    let steer = 0;
    if (this.isDown('right')) steer += 1;
    if (this.isDown('left')) steer -= 1;
    if (this.pad) steer += ax(this.pad.axes[0] || 0);
    this.axes.steer = clamp(steer, -1, 1);
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouse.wheel = 0;
  }

  consumePadPresses() {
    for (const code of this.pressedThisFrame) if (code.startsWith('Pad')) this.pressedThisFrame.delete(code);
    this.gamepad.pressed.clear();
  }

  _codesFor(action) { return this.bindings[action] || ACTIONS[action]?.keys || []; }

  isDown(action) {
    if (!this.enabled || !this.focused) return false;
    const a = ACTIONS[action];
    if (a && a.mouse !== undefined && this.mouse.buttons.has(a.mouse)) return true;
    for (const c of this._codesFor(action)) if (this.down.has(c)) return true;
    if (this.pad) {
      for (const [i, mapped] of Object.entries(this.context === 'vehicle' ? CAR_BUTTONS : FOOT_BUTTONS)) {
        if (mapped === action && this.gamepad.held.has(Number(i))) return true;
      }
    }
    return false;
  }

  pressed(action) {
    if (!this.enabled || !this.focused) return false;
    const a = ACTIONS[action];
    if (a && a.mouse !== undefined && this.pressedThisFrame.has('Mouse' + a.mouse)) return true;
    for (const c of this._codesFor(action)) if (this.pressedThisFrame.has(c)) return true;
    for (const i in (this.context === 'vehicle' ? CAR_BUTTONS : FOOT_BUTTONS)) {
      if ((this.context === 'vehicle' ? CAR_BUTTONS : FOOT_BUTTONS)[i] === action && this.pressedThisFrame.has('Pad' + i)) return true;
    }
    return false;
  }

  /** Which glyph to print in a prompt, e.g. "E" or "Y". */
  glyph(action) {
    if (this.lastDevice === 'pad') {
      const kind = settings.padType === 'auto' ? this.detectPadType() : settings.padType;
      const g = PAD_GLYPHS[kind] || PAD_GLYPHS.xbox;
      if (g[action]) return g[action];
    }
    const c = this._codesFor(action)[0] || '';
    return c.replace('Key', '').replace('Digit', '').replace('Left', ' L').replace('Right', ' R')
      .replace('Space', 'SPACE').replace('Escape', 'ESC') || '—';
  }

  detectPadType() {
    return padType(this.padId);
  }

  cancelCapture() { if (this._capture) this._finishCapture('Escape'); }

  /** Start listening for the next key press to rebind `action`. */
  captureBinding(action, cb) {
    this._capture = { action, cb };
  }
  _finishCapture(code) {
    const { action, cb } = this._capture;
    this._capture = null;
    if (code !== 'Escape') {
      this.bindings[action] = [code];
      settings.bindings = this.bindings;
      saveSettings();
    }
    cb && cb(this.bindings[action]);
  }
  resetBindings() {
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    settings.bindings = this.bindings;
    saveSettings();
  }
}

export const input = new Input();
export { DEFAULT_BINDINGS };
