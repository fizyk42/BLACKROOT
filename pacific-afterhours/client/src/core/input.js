// Unified input: keyboard + mouse + Gamepad API (Xbox / PlayStation layouts).
// Exposes a stable action map so gameplay code never touches raw key codes.

import { settings, saveSettings } from './settings.js';
import { clamp } from './util.js';

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

// Standard Gamepad API index → our action, for the common "standard" mapping.
const PAD_BUTTONS = {
  0: 'jump',        // A / Cross          (also handbrake in a car)
  1: 'holster',     // B / Circle
  2: 'crouch',      // X / Square
  3: 'interact',    // Y / Triangle
  4: 'nextWeapon',  // LB / L1
  5: 'fire',        // RB / R1  (also fire)
  8: 'roster',      // View / Share
  9: 'pause',       // Menu / Options
  12: 'map',        // D-pad up
  14: 'journal',    // D-pad left
  15: 'phone',      // D-pad right
  13: 'camera',     // D-pad down
};

const GLYPHS = {
  xbox: { jump: 'A', holster: 'B', crouch: 'X', interact: 'Y', fire: 'RT', aim: 'LT', nextWeapon: 'LB', pause: 'Menu', camera: 'D↓', map: 'D↑' },
  playstation: { jump: '✕', holster: '○', crouch: '□', interact: '△', fire: 'R2', aim: 'L2', nextWeapon: 'L1', pause: 'Options', camera: 'D↓', map: 'D↑' },
};

class Input {
  constructor() {
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: new Set() };
    this.pad = null;
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
      if (e.code === 'Tab') e.preventDefault();
      if (this.down.has(e.code)) return;
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
      this.lastDevice = 'kbm';
    });
    addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    });
    addEventListener('blur', () => { this.down.clear(); this.mouse.buttons.clear(); });

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
    addEventListener('gamepadconnected', (e) => { this.padId = e.gamepad.id; });
  }

  requestLock() {
    const c = document.getElementById('viewport');
    if (document.pointerLockElement !== c && c.requestPointerLock) {
      const p = c.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Poll gamepad + fold everything into `axes`. Call once per frame before gameplay. */
  update() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; this.padId = p.id; break; }

    const dz = settings.stickDeadzone;
    const ax = (v) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));

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
      // Edge-detect face buttons.
      this._padPrev = this._padPrev || {};
      for (const i in PAD_BUTTONS) {
        const pressed = this.pad.buttons[i] && this.pad.buttons[i].pressed;
        if (pressed && !this._padPrev[i]) { this.pressedThisFrame.add('Pad' + i); this.lastDevice = 'pad'; }
        this._padPrev[i] = pressed;
      }
    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.axes.moveX = mx;
    this.axes.moveY = my;

    // Look: mouse delta this frame + right stick (scaled by dt outside).
    const ms = settings.mouseSensitivity * 0.0022;
    this.axes.lookX = this.mouse.dx * ms + lx * settings.padSensitivity * 0.055;
    this.axes.lookY = this.mouse.dy * ms + ly * settings.padSensitivity * 0.055;
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

  _codesFor(action) { return this.bindings[action] || ACTIONS[action]?.keys || []; }

  isDown(action) {
    if (!this.enabled) return false;
    const a = ACTIONS[action];
    if (a && a.mouse !== undefined && this.mouse.buttons.has(a.mouse)) return true;
    for (const c of this._codesFor(action)) if (this.down.has(c)) return true;
    if (this.pad) {
      if (action === 'aim' && this.pad.buttons[6] && this.pad.buttons[6].value > 0.35) return true;
      if (action === 'fire' && this.pad.buttons[7] && this.pad.buttons[7].value > 0.35) return true;
      if (action === 'sprint' && this.pad.buttons[10] && this.pad.buttons[10].pressed) return true;
      if (action === 'handbrake' && this.pad.buttons[0] && this.pad.buttons[0].pressed) return true;
      for (const i in PAD_BUTTONS) {
        if (PAD_BUTTONS[i] === action && this.pad.buttons[i] && this.pad.buttons[i].pressed) return true;
      }
    }
    return false;
  }

  pressed(action) {
    if (!this.enabled) return false;
    const a = ACTIONS[action];
    if (a && a.mouse !== undefined && this.pressedThisFrame.has('Mouse' + a.mouse)) return true;
    for (const c of this._codesFor(action)) if (this.pressedThisFrame.has(c)) return true;
    for (const i in PAD_BUTTONS) {
      if (PAD_BUTTONS[i] === action && this.pressedThisFrame.has('Pad' + i)) return true;
    }
    return false;
  }

  /** Which glyph to print in a prompt, e.g. "E" or "Y". */
  glyph(action) {
    if (this.lastDevice === 'pad') {
      const kind = settings.padType === 'auto' ? this.detectPadType() : settings.padType;
      const g = GLYPHS[kind] || GLYPHS.xbox;
      if (g[action]) return g[action];
    }
    const c = this._codesFor(action)[0] || '';
    return c.replace('Key', '').replace('Digit', '').replace('Left', ' L').replace('Right', ' R')
      .replace('Space', 'SPACE').replace('Escape', 'ESC') || '—';
  }

  detectPadType() {
    const id = (this.padId || '').toLowerCase();
    if (id.includes('dualshock') || id.includes('dualsense') || id.includes('playstation') || id.includes('054c')) return 'playstation';
    return 'xbox';
  }

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
