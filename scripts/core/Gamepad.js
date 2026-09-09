/**
 * Gamepad — Xbox and DualSense support with a Call of Duty control scheme.
 *
 * The Gamepad API reports both controllers under the "standard" mapping, so
 * button indices are identical; only the glyphs and the rumble channels differ.
 * Everything here is polled once per frame from Input.update().
 *
 * Design notes that matter for feel:
 *  - Sticks use a *radial* deadzone (magnitude, not per-axis), otherwise
 *    diagonals get clipped and the character walks in an octagon.
 *  - Look uses an acceleration curve plus a ramp-up time, which is what makes
 *    a stick feel like a mouse instead of a rate dial.
 *  - Triggers are analog: the fire trigger has a real break point, and ADS
 *    starts as soon as the trigger passes its threshold.
 */

export const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15, HOME: 16,
};

/** Button layout presets, mirroring the ones Call of Duty ships. */
export const BUTTON_LAYOUTS = {
  default: {
    label: 'Default',
    fire: BTN.RT, ads: BTN.LT, jump: BTN.A, crouch: BTN.B,
    use: BTN.X, swap: BTN.Y, melee: BTN.R3, sprint: BTN.L3,
    tactical: BTN.LB, lethal: BTN.RB,
    inventory: BTN.BACK, pause: BTN.START,
  },
  tactical: {
    label: 'Tactical (Slide & Slay)',
    fire: BTN.RT, ads: BTN.LT, jump: BTN.A, crouch: BTN.R3,
    use: BTN.X, swap: BTN.Y, melee: BTN.B, sprint: BTN.L3,
    tactical: BTN.LB, lethal: BTN.RB,
    inventory: BTN.BACK, pause: BTN.START,
  },
  bumperJumper: {
    label: 'Bumper Jumper',
    fire: BTN.RT, ads: BTN.LT, jump: BTN.LB, crouch: BTN.B,
    use: BTN.X, swap: BTN.Y, melee: BTN.RB, sprint: BTN.L3,
    tactical: BTN.A, lethal: BTN.R3,
    inventory: BTN.BACK, pause: BTN.START,
  },
};

/** Stick layout presets. */
export const STICK_LAYOUTS = {
  default: { label: 'Default', moveStick: 0, lookStick: 1 },
  southpaw: { label: 'Southpaw', moveStick: 1, lookStick: 0 },
};

/** Aim response curves — the same three shapes CoD exposes. */
const CURVES = {
  standard: (t) => t * t * (0.55 + 0.45 * t),
  linear: (t) => t,
  dynamic: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) * 0.85 + t * 0.15,
};

const GLYPHS = {
  playstation: { [BTN.A]: '✕', [BTN.B]: '○', [BTN.X]: '□', [BTN.Y]: '△',
    [BTN.LB]: 'L1', [BTN.RB]: 'R1', [BTN.LT]: 'L2', [BTN.RT]: 'R2',
    [BTN.BACK]: 'CREATE', [BTN.START]: 'OPTIONS', [BTN.L3]: 'L3', [BTN.R3]: 'R3',
    [BTN.DUP]: 'D-UP', [BTN.DDOWN]: 'D-DOWN', [BTN.DLEFT]: 'D-LEFT', [BTN.DRIGHT]: 'D-RIGHT' },
  xbox: { [BTN.A]: 'A', [BTN.B]: 'B', [BTN.X]: 'X', [BTN.Y]: 'Y',
    [BTN.LB]: 'LB', [BTN.RB]: 'RB', [BTN.LT]: 'LT', [BTN.RT]: 'RT',
    [BTN.BACK]: 'VIEW', [BTN.START]: 'MENU', [BTN.L3]: 'LS', [BTN.R3]: 'RS',
    [BTN.DUP]: 'D-UP', [BTN.DDOWN]: 'D-DOWN', [BTN.DLEFT]: 'D-LEFT', [BTN.DRIGHT]: 'D-RIGHT' },
};

const TRIGGER_BREAK = 0.42;     // where the fire trigger "breaks"
const TRIGGER_ADS = 0.25;       // ADS engages earlier than the shot

class GamepadManager {
  constructor() {
    this.pad = null;
    this.index = -1;
    this.brand = 'xbox';
    this.id = '';
    this.connected = false;
    this.lastActivity = 0;

    // per-frame state
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.triggers = { left: 0, right: 0 };
    this.buttons = new Array(20).fill(false);
    this.prevButtons = new Array(20).fill(false);
    this.pressed = new Set();
    this.released = new Set();

    this._lookRamp = 0;
    this._rumbleUntil = 0;
    this._subs = [];

    // tuning, overridden from Settings by Input
    this.opts = {
      sensitivity: 1.0,
      adsSensitivity: 0.75,
      deadzoneLeft: 0.12,
      deadzoneRight: 0.10,
      curve: 'standard',
      buttonLayout: 'default',
      stickLayout: 'default',
      invertY: false,
      rumble: true,
      aimAssist: 1.0,
      maxYawRate: 3.4,          // rad/s at full stick
      maxPitchRate: 2.5,
      rampTime: 0.22,           // seconds to reach full turn rate
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => this._onConnect(e));
      window.addEventListener('gamepaddisconnected', (e) => this._onDisconnect(e));
    }
  }

  onChange(fn) { this._subs.push(fn); return () => { const i = this._subs.indexOf(fn); if (i >= 0) this._subs.splice(i, 1); }; }
  _emit() { for (const f of this._subs) { try { f(this.connected, this.brand, this.id); } catch (e) { /* subscriber failure must not break input */ } } }

  _onConnect(e) {
    if (!e.gamepad) return;
    this.index = e.gamepad.index;
    this.id = e.gamepad.id || '';
    this.brand = detectBrand(this.id);
    this.connected = true;
    this._emit();
  }

  _onDisconnect(e) {
    if (e.gamepad && e.gamepad.index !== this.index) return;
    this.connected = false;
    this.pad = null;
    this.index = -1;
    this.move.x = this.move.y = 0;
    this.look.x = this.look.y = 0;
    this.triggers.left = this.triggers.right = 0;
    this.buttons.fill(false);
    this._emit();
  }

  get layout() { return BUTTON_LAYOUTS[this.opts.buttonLayout] || BUTTON_LAYOUTS.default; }
  get sticks() { return STICK_LAYOUTS[this.opts.stickLayout] || STICK_LAYOUTS.default; }

  /** Human-readable glyph for an action, e.g. glyphFor('use') -> '□' or 'X'. */
  glyphFor(action) {
    const idx = this.layout[action];
    if (idx === undefined) return '';
    const table = GLYPHS[this.brand === 'playstation' ? 'playstation' : 'xbox'];
    return table[idx] || '?';
  }

  /* ---------------- polling ---------------- */

  poll(dt, adsAmount = 0) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    // Prefer the controller we already latched onto; otherwise adopt the first
    // one that reports any input, so a plugged-in-but-idle pad never steals focus.
    if (this.index >= 0 && pads[this.index]) pad = pads[this.index];
    if (!pad) {
      for (const p of pads) {
        if (!p || !p.connected) continue;
        if (hasAnyInput(p)) { pad = p; this.index = p.index; this.id = p.id || ''; this.brand = detectBrand(this.id); break; }
      }
    }

    this.prevButtons = this.buttons.slice();
    this.pressed.clear();
    this.released.clear();

    if (!pad) {
      if (this.connected && this.index >= 0 && !pads[this.index]) this._onDisconnect({ gamepad: { index: this.index } });
      this.move.x = this.move.y = 0;
      this.look.x = this.look.y = 0;
      this._lookRamp = 0;
      return false;
    }

    if (!this.connected) { this.connected = true; this.brand = detectBrand(pad.id || ''); this.id = pad.id || ''; this._emit(); }
    this.pad = pad;

    /* buttons */
    for (let i = 0; i < Math.min(pad.buttons.length, this.buttons.length); i++) {
      const b = pad.buttons[i];
      const down = typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5;
      this.buttons[i] = down;
      if (down && !this.prevButtons[i]) this.pressed.add(i);
      if (!down && this.prevButtons[i]) this.released.add(i);
    }

    /* analog triggers — index 6/7 carry a value on the standard mapping */
    this.triggers.left = analog(pad.buttons[BTN.LT]);
    this.triggers.right = analog(pad.buttons[BTN.RT]);

    /* sticks */
    const s = this.sticks;
    const moveRaw = stick(pad.axes, s.moveStick);
    const lookRaw = stick(pad.axes, s.lookStick);

    const mv = radialDeadzone(moveRaw.x, moveRaw.y, this.opts.deadzoneLeft);
    this.move.x = mv.x;
    this.move.y = mv.y;

    const lk = radialDeadzone(lookRaw.x, lookRaw.y, this.opts.deadzoneRight);
    const mag = Math.hypot(lk.x, lk.y);
    const curve = CURVES[this.opts.curve] || CURVES.standard;
    const shaped = mag > 0 ? curve(Math.min(1, mag)) / mag : 0;

    // Ramp-up: holding the stick accelerates into the turn rather than
    // snapping to full speed, which is what makes fine aiming possible.
    const target = mag > 0.02 ? 1 : 0;
    const rampRate = target > 0 ? dt / Math.max(0.01, this.opts.rampTime) : dt / 0.06;
    this._lookRamp += Math.sign(target - this._lookRamp) * Math.min(Math.abs(target - this._lookRamp), rampRate);

    const adsMul = 1 - adsAmount * (1 - this.opts.adsSensitivity);
    const sens = this.opts.sensitivity * adsMul * (0.45 + 0.55 * this._lookRamp);
    this.look.x = lk.x * shaped * this.opts.maxYawRate * sens * dt;
    this.look.y = lk.y * shaped * this.opts.maxPitchRate * sens * dt * (this.opts.invertY ? -1 : 1);

    if (mag > 0.02 || Math.hypot(mv.x, mv.y) > 0.02 || this.pressed.size) this.lastActivity = performance.now();

    /* rumble timeout */
    if (this._rumbleUntil && performance.now() > this._rumbleUntil) this._rumbleUntil = 0;
    return true;
  }

  /* ---------------- queries ---------------- */

  isDown(action) {
    const L = this.layout;
    if (action === 'fire') return this.triggers.right >= TRIGGER_BREAK;
    if (action === 'ads') return this.triggers.left >= TRIGGER_ADS;
    const idx = L[action];
    return idx !== undefined && !!this.buttons[idx];
  }

  justPressed(action) {
    const L = this.layout;
    if (action === 'fire') return this.pressed.has(BTN.RT) || (this.triggers.right >= TRIGGER_BREAK && !this._prevFire);
    const idx = L[action];
    return idx !== undefined && this.pressed.has(idx);
  }

  justReleased(action) {
    const idx = this.layout[action];
    return idx !== undefined && this.released.has(idx);
  }

  dpad() {
    return {
      up: !!this.buttons[BTN.DUP], down: !!this.buttons[BTN.DDOWN],
      left: !!this.buttons[BTN.DLEFT], right: !!this.buttons[BTN.DRIGHT],
    };
  }

  dpadPressed() {
    return {
      up: this.pressed.has(BTN.DUP), down: this.pressed.has(BTN.DDOWN),
      left: this.pressed.has(BTN.DLEFT), right: this.pressed.has(BTN.DRIGHT),
    };
  }

  /* ---------------- rumble ---------------- */

  /**
   * @param strong low-frequency motor 0..1
   * @param weak   high-frequency motor 0..1
   */
  rumble(strong, weak, ms = 120) {
    if (!this.opts.rumble || !this.pad) return;
    const act = this.pad.vibrationActuator;
    if (!act || !act.playEffect) return;
    // Don't let a long weak effect stomp a short strong one.
    const now = performance.now();
    if (this._rumbleUntil > now && strong < this._rumbleStrength * 0.8) return;
    this._rumbleUntil = now + ms;
    this._rumbleStrength = strong;
    try {
      act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(16, ms),
        strongMagnitude: Math.max(0, Math.min(1, strong)),
        weakMagnitude: Math.max(0, Math.min(1, weak)),
      }).catch(() => {});
    } catch (e) { /* actuator not supported on this pad */ }
  }

  stopRumble() {
    const act = this.pad && this.pad.vibrationActuator;
    if (act && act.reset) { try { act.reset(); } catch (e) { /* noop */ } }
    this._rumbleUntil = 0;
  }

  /** True when the pad has been touched recently enough to drive the UI. */
  get active() { return this.connected && performance.now() - this.lastActivity < 30000; }
}

/* ---------------- helpers ---------------- */

function analog(button) {
  if (button === undefined) return 0;
  if (typeof button === 'object') return button.value !== undefined ? button.value : (button.pressed ? 1 : 0);
  return button;
}

function stick(axes, which) {
  const xi = which * 2, yi = which * 2 + 1;
  return { x: axes[xi] || 0, y: axes[yi] || 0 };
}

/** Radial deadzone: rescales magnitude so diagonals keep their full range. */
function radialDeadzone(x, y, dz) {
  const mag = Math.hypot(x, y);
  if (mag < dz) return { x: 0, y: 0 };
  const scaled = (mag - dz) / (1 - dz);
  const k = Math.min(1, scaled) / mag;
  return { x: x * k, y: y * k };
}

function hasAnyInput(p) {
  for (const a of p.axes) if (Math.abs(a) > 0.25) return true;
  for (const b of p.buttons) if (analog(b) > 0.3) return true;
  return false;
}

function detectBrand(id) {
  const s = String(id).toLowerCase();
  if (s.includes('dualsense') || s.includes('dualshock') || s.includes('054c') ||
      s.includes('playstation') || s.includes('ps5') || s.includes('ps4') || s.includes('wireless controller')) {
    return 'playstation';
  }
  if (s.includes('xbox') || s.includes('xinput') || s.includes('045e')) return 'xbox';
  return 'xbox';   // standard mapping, generic glyphs
}

export const Pad = new GamepadManager();
