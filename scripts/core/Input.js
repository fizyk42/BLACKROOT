/**
 * Input — keyboard, mouse and gamepad unified behind one surface.
 *
 * Physical key codes are used so WASD works on non-QWERTY layouts.
 *
 * Looking around is the one input that can fail completely and silently, so it
 * has three layers rather than one:
 *
 *  1. **Pointer lock**, the normal path. The cursor is captured and the game
 *     reads `movementX/Y`, which is unbounded — you can spin forever.
 *  2. **Cursor look**, the fallback. Pointer lock is refused more often than
 *     people expect: an iframe without `allow="pointer-lock"`, a request that
 *     did not come from a user gesture, Chrome's ~1.3 s lock-out right after
 *     the player presses Esc, some managed-browser policies, and a handful of
 *     remote-desktop and trackpad driver combinations that grant the lock and
 *     then report no movement at all. In every one of those cases the old code
 *     just quietly stopped turning. Now the failure is detected — including
 *     the nasty "locked but every delta is zero" variant — and the game falls
 *     back to deriving deltas from the plain cursor position, with the screen
 *     edges acting as a turn pedal so you can still come all the way around.
 *  3. **Controller**, which never depended on any of this.
 *
 * Trackpads also get their own handling. A trackpad reports far smaller total
 * deltas than a mouse for the same physical gesture, so at 1.0 sensitivity it
 * feels broken rather than slow; and two-finger scroll arrives as a burst of
 * tiny wheel deltas, which the naive `Math.sign(deltaY)` reading turned into a
 * dozen weapon switches per flick. Both are handled below.
 *
 * The gamepad does not get its own parallel code path through the game.
 * Instead it *synthesises* the same key codes and mouse buttons the rest of
 * the game already listens for, so every existing handler works on a
 * controller without knowing a controller exists. Analog look and movement are
 * blended into takeLook()/moveAxis() at the point of use.
 */
import { Settings } from './Settings.js';
import { Pad } from './Gamepad.js';

export const BINDINGS = [
  ['Move Forward', 'W'], ['Move Back', 'S'], ['Strafe Left', 'A'], ['Strafe Right', 'D'],
  ['Look', 'Mouse / Trackpad'], ['Fire / Attack', 'Left Mouse'], ['Aim Down Sights', 'Right Mouse'],
  ['Reload', 'R'], ['Sprint', 'Shift'], ['Crouch', 'Ctrl / C'], ['Jump', 'Space'],
  ['Interact / Pick Up', 'E'], ['Flashlight', 'F'], ['Quick Slots', '1 – 5'],
  ['Next / Prev Weapon', 'Mouse Wheel'], ['Inventory', 'Tab'], ['Melee Bash', 'V'],
  ['Use Medical', 'Q'], ['Armoury / Loadout', 'L'], ['Map Ping / Landmarks', 'M'], ['Pause', 'Esc'],
];

/** Controller bindings, described in terms of actions the Pad layout resolves. */
export const PAD_BINDINGS = [
  ['Move', 'Left Stick'], ['Look', 'Right Stick'],
  ['Fire', 'fire'], ['Aim Down Sights', 'ads'], ['Jump', 'jump'], ['Crouch', 'crouch'],
  ['Reload / Interact', 'use'], ['Swap Weapon', 'swap'], ['Melee', 'melee'],
  ['Sprint', 'sprint'], ['Flashlight', 'tactical'], ['Medical', 'lethal'],
  ['Inventory', 'inventory'], ['Pause', 'pause'], ['Quick Slots', 'D-Pad'],
];

/** Gamepad action -> the keyboard code the rest of the game already handles. */
const VIRTUAL_KEYS = {
  jump: 'Space',
  crouch: 'KeyC',
  swap: null,          // handled as a wheel tick
  tactical: 'KeyF',
  lethal: 'KeyQ',
  melee: 'KeyV',
  inventory: 'Tab',
  pause: 'Escape',
};

class InputManager {
  constructor() {
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
    this._mouseLeft = false;
    this._mouseRight = false;
    this._padFire = false;
    this._padAds = false;
    this.locked = false;       // real pointer lock
    this.softLook = false;     // cursor-look fallback engaged
    this.lockFailed = false;   // pointer lock was asked for and refused
    this.lockBroken = false;   // pointer lock was granted but reports nothing
    this.enabled = false;      // gameplay input active
    this.usingGamepad = false;
    this.interactAvailable = false;   // set by the game so LB/□ can be contextual
    this.pad = Pad;

    this._pressQueue = [];
    this._listeners = [];
    this._lockSubs = [];
    this._padKeys = new Set();        // keys currently held *by the pad*
    this._padSprint = false;
    this._padLook = { x: 0, y: 0 };
    this._padMove = { x: 0, z: 0 };
    this._menuRepeat = { dir: 0, next: 0 };
    this._lookSubs = [];
    this._wantLook = false;
    this._lockAttempt = 0;
    this._lockTimer = 0;
    this._zeroMoves = 0;
    this._ptr = { x: 0, y: 0, have: false };
    this.edge = { x: 0, y: 0 };       // -1..1 per axis, read by the HUD
    this._wheelAccum = 0;
    this._wheelAt = 0;
    this._tpScore = 0;
    this.trackpadDetected = false;
    this.canvas = null;
    this._boundLockChange = this._onLockChange.bind(this);
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => this._onKeyDown(e), { passive: false });
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
    window.addEventListener('blur', () => { this.keys.clear(); this._mouseLeft = this._mouseRight = false; this.mouse.left = this.mouse.right = false; });
    document.addEventListener('pointerlockchange', this._boundLockChange);
    // Fired when the browser refuses the lock outright. Without this the
    // request simply never resolves and the player is left unable to turn.
    document.addEventListener('pointerlockerror', () => this._lockUnavailable('the browser refused pointer lock'));
    document.addEventListener('mousemove', (e) => this._onMove(e));
    // Cursor look steers from the pointer's position, so once the pointer is
    // outside the window there is no position to steer from — and continuing
    // to turn on the last one would spin the camera forever behind an
    // alt-tabbed window. Stop, and pick up cleanly when it comes back.
    document.addEventListener('mouseleave', () => { this._ptr.have = false; this.edge.x = this.edge.y = 0; });
    window.addEventListener('blur', () => { this._ptr.have = false; this.edge.x = this.edge.y = 0; });
    document.addEventListener('mousedown', (e) => {
      if (!this.lookActive) return;
      if (e.button === 0) { this._mouseLeft = true; this.mouse.left = true; }
      if (e.button === 2) { this._mouseRight = true; this.mouse.right = true; }
      if (e.button === 1) this._pressQueue.push('MouseMiddle');
      this.usingGamepad = false;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this._mouseLeft = false; this.mouse.left = this._padFire; }
      if (e.button === 2) { this._mouseRight = false; this.mouse.right = this._padAds; }
    });
    document.addEventListener('wheel', (e) => this._onWheel(e), { passive: true });
    document.addEventListener('contextmenu', (e) => { if (this.lookActive || this.enabled) e.preventDefault(); });

    this.syncPadOptions();
    Settings.onChange((k) => {
      if (k.startsWith('pad') || k === 'sensitivity' || k === 'invertY' || k === 'adsSensitivity') this.syncPadOptions();
      if (k === 'lookMode') this.applyLookMode();
    });
  }

  syncPadOptions() {
    const o = Pad.opts;
    o.sensitivity = Settings.get('padSensitivity');
    o.adsSensitivity = Settings.get('padAdsSensitivity');
    o.deadzoneLeft = Settings.get('padDeadzoneLeft');
    o.deadzoneRight = Settings.get('padDeadzoneRight');
    o.curve = Settings.get('padCurve');
    o.buttonLayout = Settings.get('padButtonLayout');
    o.stickLayout = Settings.get('padStickLayout');
    o.invertY = Settings.get('invertY');
    o.rumble = Settings.get('padRumble');
    o.aimAssist = Settings.get('padAimAssist');
  }

  /* ---------------- gamepad pump ---------------- */

  /**
   * Poll the controller and translate it into the keyboard/mouse surface.
   * Called once per frame by GameManager before any system reads input.
   */
  update(dt, adsAmount, allowGameplay) {
    // Cursor look's edge turning is a per-frame rate, so it is integrated here
    // rather than in the event handler.
    this._edgeSteer(allowGameplay ? dt : 0);
    const had = Pad.connected;
    Pad.poll(dt, adsAmount || 0);
    if (Pad.connected !== had) this.usingGamepad = Pad.connected;

    if (!Pad.connected) {
      this._releaseAllPadKeys();
      this._padLook.x = this._padLook.y = 0;
      this._padMove.x = this._padMove.z = 0;
      this._padFire = this._padAds = false;
      this._mergeMouse();
      return;
    }

    // Any real stick or button movement switches the UI to controller glyphs.
    if (Math.hypot(Pad.move.x, Pad.move.y) > 0.15 || Math.hypot(Pad.look.x, Pad.look.y) > 0.0004 ||
        Pad.pressed.size > 0 || Pad.triggers.right > 0.2 || Pad.triggers.left > 0.2) {
      this.usingGamepad = true;
    }

    // --- pause and inventory work even when gameplay input is suspended ---
    if (Pad.justPressed('pause')) this._emitKey('Escape');
    if (Pad.justPressed('inventory')) this._emitKey('Tab');

    if (!allowGameplay) {
      this._releaseAllPadKeys();
      this._padLook.x = this._padLook.y = 0;
      this._padMove.x = this._padMove.z = 0;
      this._padFire = this._padAds = false;
      this._mergeMouse();
      return;
    }

    /* --- analog --- */
    this._padLook.x = Pad.look.x;
    this._padLook.y = Pad.look.y;
    this._padMove.x = Pad.move.x;
    this._padMove.z = -Pad.move.y;      // stick up (-1) is forward

    /* --- triggers behave as the mouse buttons --- */
    this._padFire = Pad.isDown('fire');
    this._padAds = Pad.isDown('ads');

    /* --- held actions: these are read with Input.down(), so they must live
           in the key set for as long as the button is held --- */
    this._setPadKey('KeyC', Pad.isDown('crouch'));
    this._setPadKey('Space', Pad.isDown('jump'));

    // L3 sprint: click to start, drops when the stick is released (CoD behaviour)
    if (Pad.justPressed('sprint')) this._padSprint = true;
    if (Math.hypot(Pad.move.x, Pad.move.y) < 0.2) this._padSprint = false;
    if (this._padAds || this._padFire) this._padSprint = false;
    this._setPadKey('ShiftLeft', this._padSprint);

    /* --- tap actions --- */
    if (Pad.justPressed('tactical')) this._emitKey('KeyF');
    if (Pad.justPressed('lethal')) this._emitKey('KeyQ');
    if (Pad.justPressed('melee')) this._emitKey('KeyV');

    // Contextual use, exactly like CoD's Square/X: interact if there is
    // something to interact with, otherwise reload.
    if (Pad.justPressed('use')) this._emitKey(this.interactAvailable ? 'KeyE' : 'KeyR');

    // Y / Triangle cycles weapons
    if (Pad.justPressed('swap')) this.mouse.wheel += 1;

    // D-pad drives the quick slots
    const dp = Pad.dpadPressed();
    if (dp.up) this._emitKey('Digit1');
    if (dp.right) this._emitKey('Digit2');
    if (dp.down) this._emitKey('Digit3');
    if (dp.left) this._emitKey('Digit4');

    this._mergeMouse();
  }

  /**
   * Drive fire/aim from something that isn't a physical mouse — used by the
   * automated tests today, and the hook a touch layer would use later.
   */
  setVirtualMouse(left, right) {
    if (left !== undefined) this._mouseLeft = !!left;
    if (right !== undefined) this._mouseRight = !!right;
    this._mergeMouse();
  }

  /** Combine physical mouse buttons with the controller triggers. */
  _mergeMouse() {
    this.mouse.left = this._mouseLeft || this._padFire;
    this.mouse.right = this._mouseRight || this._padAds;
  }

  /** Fire a synthetic key press through the same path as a real keydown. */
  _emitKey(code) {
    this._pressQueue.push(code);
    for (const l of this._listeners) l(code, { code, repeat: false, preventDefault() {} });
  }

  _setPadKey(code, down) {
    if (down) {
      if (!this._padKeys.has(code)) {
        this._padKeys.add(code);
        this.keys.add(code);
        this._emitKey(code);
      }
    } else if (this._padKeys.has(code)) {
      this._padKeys.delete(code);
      this.keys.delete(code);
    }
  }

  _releaseAllPadKeys(except = []) {
    for (const code of Array.from(this._padKeys)) {
      if (except.includes(code)) continue;
      this._padKeys.delete(code);
      this.keys.delete(code);
    }
    this._padSprint = false;
  }

  /** Directional menu input from the pad, with key-repeat. */
  menuNav(dt) {
    const out = { up: false, down: false, left: false, right: false, confirm: false, back: false };
    if (!Pad.connected) return out;
    const dp = Pad.dpadPressed();
    const ly = Pad.move.y, lx = Pad.move.x;
    const now = performance.now();
    let dir = 0;
    if (ly < -0.6) dir = -1; else if (ly > 0.6) dir = 1;
    if (dir !== 0) {
      if (this._menuRepeat.dir !== dir) { this._menuRepeat.dir = dir; this._menuRepeat.next = now + 380; if (dir < 0) out.up = true; else out.down = true; }
      else if (now >= this._menuRepeat.next) { this._menuRepeat.next = now + 110; if (dir < 0) out.up = true; else out.down = true; }
    } else this._menuRepeat.dir = 0;

    if (dp.up) out.up = true;
    if (dp.down) out.down = true;
    if (dp.left) out.left = true;
    if (dp.right) out.right = true;
    if (Math.abs(lx) > 0.7 && Math.abs(this._menuLastX || 0) <= 0.7) { if (lx > 0) out.right = true; else out.left = true; }
    this._menuLastX = lx;

    if (Pad.justPressed('jump')) out.confirm = true;       // A / ✕
    if (Pad.justPressed('crouch')) out.back = true;        // B / ○
    return out;
  }

  /* ---------------- keyboard/mouse ---------------- */

  _onKeyDown(e) {
    // Tab and F-keys would otherwise leave the game.
    if (this.enabled && ['Tab', 'F1', 'F3', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code || e.key)) e.preventDefault();
    if (e.repeat) return;
    this.usingGamepad = false;
    this.keys.add(e.code);
    this._pressQueue.push(e.code);
    for (const l of this._listeners) l(e.code, e);
  }

  _onKeyUp(e) { this.keys.delete(e.code); }

  _onLockChange() {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.canvas;
    // A lock request can be granted long after it was made. If the player has
    // since chosen cursor look, hand it straight back rather than silently
    // overriding them.
    if (this.locked && Settings.get('lookMode') === 'cursor') {
      document.exitPointerLock();
      this._engageSoft();
      return;
    }
    if (this.locked) {
      // It worked after all. Clear the failure state so a transient refusal
      // does not condemn the rest of the session to the fallback.
      clearTimeout(this._lockTimer);
      this._lockAttempt = 0;
      this._zeroMoves = 0;
      this.lockFailed = false;
      this._disengageSoft();
    }
    if (was !== this.locked) for (const l of this._lockSubs) l(this.locked);
  }

  onKey(fn) { this._listeners.push(fn); }
  onLockChange(fn) { this._lockSubs.push(fn); }

  /** Told when the look system changes how it works, so the UI can say so. */
  onLookNotice(fn) { this._lookSubs.push(fn); }
  _notifyLook(kind, message) { for (const l of this._lookSubs) { try { l(kind, message); } catch (e) { console.warn(e); } } }

  /* ---------------- looking around ---------------- */

  /** True when the game should be reading the mouse for aim, either way. */
  get lookActive() { return this.locked || this.softLook; }

  requestLock() {
    if (!this.canvas) return;
    this._wantLook = true;
    const mode = Settings.get('lookMode');
    if (mode === 'cursor' || (this.lockBroken && mode !== 'lock')) {
      this._engageSoft();
      return;
    }
    if (this.locked) return;
    // A previous refusal turns cursor look on straight away so the player can
    // look *now*, but the real lock is still attempted underneath: refusals
    // are often transient (Chrome blocks requests for about a second after the
    // player presses Esc), and if it succeeds the fallback stands down by
    // itself. Staying on the fallback for the rest of the session because of
    // one bad moment would be the worse bug.
    if (this.lockFailed && mode !== 'lock') this._engageSoft();
    clearTimeout(this._lockTimer);
    let p;
    try { p = this.canvas.requestPointerLock?.(); } catch (e) { p = null; }
    if (p && p.catch) p.catch(() => this._retryOrFallback());
    // Older browsers return nothing at all from requestPointerLock, and Chrome
    // rejects a request made within ~1.3 s of the player pressing Esc without
    // telling anyone. Neither shows up as an error, so the only honest test is
    // to look again a moment later.
    this._lockTimer = setTimeout(() => {
      if (this._wantLook && !this.locked) this._retryOrFallback();
    }, 400);
  }

  _retryOrFallback() {
    if (!this._wantLook || this.locked) return;
    this._lockAttempt++;
    // One retry, timed to clear Chrome's post-Esc lock-out.
    if (this._lockAttempt === 1 && Settings.get('lookMode') !== 'cursor') {
      clearTimeout(this._lockTimer);
      this._lockTimer = setTimeout(() => {
        if (!this._wantLook || this.locked) return;
        let p;
        try { p = this.canvas.requestPointerLock?.(); } catch (e) { p = null; }
        if (p && p.catch) p.catch(() => {});
        setTimeout(() => { if (this._wantLook && !this.locked) this._lockUnavailable('pointer lock is not available here'); }, 400);
      }, 1400);
      return;
    }
    this._lockUnavailable('pointer lock is not available here');
  }

  _lockUnavailable(reason) {
    if (Settings.get('lookMode') === 'lock') {
      // The player asked for pointer lock explicitly; say it failed rather
      // than silently doing something else.
      if (!this.lockFailed) this._notifyLook('failed', `Look is not working: ${reason}. Settings → Controls → Look mode → CURSOR works everywhere.`);
      this.lockFailed = true;
      return;
    }
    const first = !this.lockFailed && !this.lockBroken;
    this.lockFailed = true;
    this._engageSoft();
    if (first) {
      this._notifyLook('fallback',
        'Mouse capture unavailable — cursor look is on. Move to look; push the screen edge to keep turning.');
    }
  }

  /** Pointer lock said yes and then reported nothing. Treat it as broken. */
  _lockIsBroken() {
    if (this.lockBroken) return;
    this.lockBroken = true;
    this._zeroMoves = 0;
    // Order matters: releasing the lock fires pointerlockchange synchronously,
    // and anything watching that event sees "unlocked" — which the game reads
    // as the player alt-tabbing and pauses on. Stand the fallback up first so
    // the unlock is already accounted for by the time anyone is told.
    this._engageSoft();
    if (document.pointerLockElement) document.exitPointerLock();
    this._notifyLook('fallback',
      'Mouse capture stopped reporting movement — cursor look is on. Push the screen edge to keep turning.');
  }

  _engageSoft() {
    if (this.softLook) return;
    this.softLook = true;
    this._ptr.have = false;
    this.edge.x = this.edge.y = 0;
    document.body.classList.add('softlook');
  }

  _disengageSoft() {
    if (!this.softLook) return;
    this.softLook = false;
    this.edge.x = this.edge.y = 0;
    document.body.classList.remove('softlook');
  }

  exitLock() {
    this._wantLook = false;
    clearTimeout(this._lockTimer);
    this._lockAttempt = 0;
    this._disengageSoft();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Force the fallback on or off at runtime (the settings screen uses this). */
  applyLookMode() {
    const mode = Settings.get('lookMode');
    if (!this._wantLook) return;
    if (mode === 'cursor') { this._engageSoft(); if (document.pointerLockElement) document.exitPointerLock(); }
    else if (!this.locked) { this.lockFailed = false; this.lockBroken = false; this._lockAttempt = 0; this._disengageSoft(); this.requestLock(); }
  }

  _onMove(e) {
    const px = e.clientX, py = e.clientY;
    const had = this._ptr.have;
    const lx = this._ptr.x, ly = this._ptr.y;

    if (this.locked) {
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (mx === 0 && my === 0) {
        // A stationary mouse produces no events at all, so a run of moves that
        // all report zero movement means the lock is not actually tracking.
        if (++this._zeroMoves > 20) this._lockIsBroken();
        return;
      }
      this._zeroMoves = 0;
      this.mouse.dx += mx;
      this.mouse.dy += my;
      this.usingGamepad = false;
      return;
    }

    this._ptr.x = px; this._ptr.y = py; this._ptr.have = true;
    if (!this.softLook || !this.enabled) return;
    // The very first sample only establishes where the pointer is; using it as
    // a delta would snap the view by however far across the screen it started.
    if (had) {
      this.mouse.dx += px - lx;
      this.mouse.dy += py - ly;
      this.usingGamepad = false;
    }
  }

  /**
   * Cursor look cannot turn past the edge of the screen, so the edges act as a
   * turn pedal: the closer the pointer is to one, the faster the view keeps
   * rotating that way. Without this the fallback can only look about as far as
   * the monitor is wide, which players read as the look being broken.
   */
  _edgeSteer(dt) {
    if (!this.softLook || !this.enabled || !this._ptr.have) { this.edge.x = this.edge.y = 0; return; }
    const gain = Settings.get('edgeTurn');
    const w = window.innerWidth, h = window.innerHeight;
    const bandX = Math.max(24, Math.min(110, w * 0.07));
    const bandY = Math.max(20, Math.min(90, h * 0.07));
    const px = Math.max(0, Math.min(w, this._ptr.x));
    const py = Math.max(0, Math.min(h, this._ptr.y));
    let ex = 0, ey = 0;
    if (px < bandX) ex = -(1 - px / bandX);
    else if (px > w - bandX) ex = (px - (w - bandX)) / bandX;
    if (py < bandY) ey = -(1 - py / bandY);
    else if (py > h - bandY) ey = (py - (h - bandY)) / bandY;
    ex = Math.max(-1, Math.min(1, ex));
    ey = Math.max(-1, Math.min(1, ey));
    this.edge.x = ex; this.edge.y = ey;
    if (gain <= 0) return;
    // Squared, so resting near an edge drifts gently and jamming into it spins.
    const rate = 900 * gain * dt;
    this.mouse.dx += Math.sign(ex) * ex * ex * rate;
    this.mouse.dy += Math.sign(ey) * ey * ey * rate * 0.5;
  }

  /* ---------------- wheel ---------------- */

  _onWheel(e) {
    this._sniffTrackpad(e);
    if (!this.lookActive) return;
    const now = performance.now();
    // A pause between gestures starts a fresh count, so a slow drift never
    // eventually adds up to a weapon switch.
    if (now - this._wheelAt > 400) this._wheelAccum = 0;
    this._wheelAt = now;
    // One notch of a real wheel is ~100 px (or 3 lines). A trackpad flick is a
    // burst of much smaller deltas, and reading each of them as a notch cycles
    // the entire weapon list in one swipe.
    const unit = e.deltaMode === 0 ? 90 : e.deltaMode === 1 ? 3 : 1;
    this._wheelAccum += e.deltaY;
    while (Math.abs(this._wheelAccum) >= unit) {
      const dir = Math.sign(this._wheelAccum);
      this.mouse.wheel += dir;
      this._wheelAccum -= dir * unit;
    }
  }

  /**
   * Guess whether this is a trackpad. Wheels emit large, whole-numbered,
   * purely vertical deltas; trackpads emit small, often fractional ones and
   * almost always some horizontal component. Three agreeing samples is plenty,
   * and the player can override the guess in the settings either way.
   */
  _sniffTrackpad(e) {
    if (e.deltaMode !== 0) { this._tpScore = Math.max(0, this._tpScore - 2); return; }
    const dy = Math.abs(e.deltaY), dx = Math.abs(e.deltaX);
    const fine = (dy > 0 && dy < 40) || dy % 1 !== 0 || dx > 0.5;
    this._tpScore = fine ? this._tpScore + 1 : Math.max(0, this._tpScore - 1);
    if (this._tpScore >= 3 && !this.trackpadDetected) {
      this.trackpadDetected = true;
      if (Settings.get('trackpad') === 'auto') {
        this._notifyLook('trackpad', 'Trackpad detected — look sensitivity boosted. Settings → Controls to change it.');
      }
    }
  }

  get trackpadActive() {
    const m = Settings.get('trackpad');
    return m === 'on' || (m === 'auto' && this.trackpadDetected);
  }

  /** Everything the settings screen and the automated test want to know. */
  get lookDiagnostics() {
    return {
      mode: Settings.get('lookMode'),
      locked: this.locked,
      softLook: this.softLook,
      lockFailed: this.lockFailed,
      lockBroken: this.lockBroken,
      trackpad: this.trackpadActive,
      wantLook: this._wantLook,
      edge: { ...this.edge },
    };
  }

  down(code) { return this.keys.has(code); }
  anyDown(...codes) { return codes.some((c) => this.keys.has(c)); }

  /** Consume the queue of key presses since last frame. */
  takePresses() { const q = this._pressQueue; this._pressQueue = []; return q; }

  /** Consume accumulated look delta from mouse + stick, scaled by sensitivity. */
  takeLook(adsFactor = 1) {
    // A trackpad moves the pointer a fraction as far as a mouse does for the
    // same hand movement, so at 1.0 it reads as "look is barely working".
    const boost = this.trackpadActive ? 2.2 : 1;
    const s = Settings.get('sensitivity') * 0.0022 * adsFactor * boost;
    const invert = Settings.get('invertY') ? -1 : 1;
    const out = {
      x: this.mouse.dx * s + this._padLook.x,
      y: this.mouse.dy * s * invert + this._padLook.y,
    };
    this.mouse.dx = 0; this.mouse.dy = 0;
    this._padLook.x = 0; this._padLook.y = 0;
    return out;
  }

  takeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return w; }

  /** Movement axes in local space: x = strafe (+right), z = forward (+fwd). */
  moveAxis() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (Math.abs(this._padMove.x) > 0.01 || Math.abs(this._padMove.z) > 0.01) {
      x += this._padMove.x;
      z += this._padMove.z;
    }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  /** Analog movement magnitude, so the pad can walk rather than only run. */
  moveMagnitude() {
    const kb = (this.down('KeyW') || this.down('KeyS') || this.down('KeyA') || this.down('KeyD')) ? 1 : 0;
    const padMag = Math.min(1, Math.hypot(this._padMove.x, this._padMove.z));
    return Math.max(kb, padMag);
  }

  rumble(strong, weak, ms) { Pad.rumble(strong, weak, ms); }

  /**
   * Aim assist, applied between polling and consumption.
   * @param slowdown  multiplier on stick look while near a target (0..1)
   * @param addX      rotational assist, radians of yaw to add this frame
   * @param addY      radians of pitch to add this frame
   */
  applyAimAssist(slowdown, addX, addY) {
    this._padLook.x = this._padLook.x * slowdown + addX;
    this._padLook.y = this._padLook.y * slowdown + addY;
  }

  /** Magnitude of raw stick look this frame — aim assist scales with it. */
  get padLookMagnitude() { return Math.hypot(this._padLook.x, this._padLook.y); }

  clear() {
    this.keys.clear();
    this._padKeys.clear();
    this._pressQueue.length = 0;
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this._wheelAccum = 0;
    this._mouseLeft = this._mouseRight = false;
    this._padFire = this._padAds = false;
    this.mouse.left = this.mouse.right = false;
    this._padSprint = false;
    this._ptr.have = false;
  }
}

export const Input = new InputManager();
