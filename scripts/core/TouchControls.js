import { Input } from './Input.js';

const isTouchDevice = () =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function addStyles() {
  if (document.getElementById('blackroot-touch-style')) return;
  const style = document.createElement('style');
  style.id = 'blackroot-touch-style';
  style.textContent = `
    #br-touch { position: fixed; inset: 0; z-index: 95; pointer-events: none; user-select: none; -webkit-user-select: none; touch-action: none; display: none; }
    body.br-touch-device #br-touch { display: block; }
    #br-touch .stick-zone { position: absolute; left: max(18px, env(safe-area-inset-left)); bottom: max(22px, calc(env(safe-area-inset-bottom) + 18px)); width: 150px; height: 150px; border-radius: 50%; background: rgba(5,8,10,.26); border: 1px solid rgba(255,255,255,.18); pointer-events: auto; touch-action: none; }
    #br-touch .stick-knob { position: absolute; left: 50%; top: 50%; width: 62px; height: 62px; transform: translate(-50%,-50%); border-radius: 50%; background: rgba(220,230,238,.18); border: 1px solid rgba(255,255,255,.28); box-shadow: inset 0 0 24px rgba(0,0,0,.45); }
    #br-touch .look-zone { position: absolute; right: 0; top: 0; width: 58vw; height: 100%; pointer-events: auto; touch-action: none; }
    #br-touch .actions { position: absolute; right: max(14px, env(safe-area-inset-right)); bottom: max(18px, calc(env(safe-area-inset-bottom) + 12px)); width: 210px; height: 210px; pointer-events: none; }
    #br-touch button { position: absolute; width: 62px; height: 62px; border-radius: 50%; border: 1px solid rgba(255,255,255,.28); background: rgba(7,10,13,.62); color: #eef2f5; font: 700 10px/1 system-ui, sans-serif; letter-spacing: .04em; pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; }
    #br-touch button:active, #br-touch button.active { background: rgba(190,205,214,.26); transform: scale(.96); }
    #br-fire { right: 0; bottom: 72px; width: 78px !important; height: 78px !important; }
    #br-ads { right: 84px; bottom: 126px; }
    #br-jump { right: 92px; bottom: 44px; }
    #br-use { right: 28px; bottom: 0; }
    #br-reload { right: 126px; bottom: 0; }
    #br-sprint { left: max(22px, env(safe-area-inset-left)); bottom: max(182px, calc(env(safe-area-inset-bottom) + 174px)); }
    #br-crouch { left: max(92px, calc(env(safe-area-inset-left) + 72px)); bottom: max(182px, calc(env(safe-area-inset-bottom) + 174px)); }
    #br-pause { right: max(12px, env(safe-area-inset-right)); top: max(12px, env(safe-area-inset-top)); width: 48px !important; height: 48px !important; font-size: 15px !important; }
    @media (orientation: portrait) {
      #br-touch .stick-zone { width: 126px; height: 126px; }
      #br-touch .look-zone { width: 62vw; }
      #br-touch .actions { transform: scale(.88); transform-origin: bottom right; }
    }
  `;
  document.head.appendChild(style);
}

function makeButton(id, label, onDown, onUp) {
  const b = document.createElement('button');
  b.id = id;
  b.type = 'button';
  b.textContent = label;
  const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('active'); onDown?.(); };
  const up = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.remove('active'); onUp?.(); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

function pulseKey(code) { Input._emitKey(code); }
function holdKey(code, down) {
  if (down) {
    if (!Input.keys.has(code)) { Input.keys.add(code); Input._emitKey(code); }
  } else Input.keys.delete(code);
}

export function installTouchControls() {
  if (!isTouchDevice() || document.getElementById('br-touch')) return;
  document.body.classList.add('br-touch-device');
  addStyles();

  const root = document.createElement('div');
  root.id = 'br-touch';
  root.innerHTML = `
    <div class="look-zone" id="br-look"></div>
    <div class="stick-zone" id="br-stick"><div class="stick-knob" id="br-stick-knob"></div></div>
    <div class="actions" id="br-actions"></div>
  `;
  document.body.appendChild(root);

  const actions = root.querySelector('#br-actions');
  actions.append(
    makeButton('br-fire', 'FIRE', () => Input.setVirtualMouse(true, undefined), () => Input.setVirtualMouse(false, undefined)),
    makeButton('br-ads', 'AIM', () => Input.setVirtualMouse(undefined, true), () => Input.setVirtualMouse(undefined, false)),
    makeButton('br-jump', 'JUMP', () => holdKey('Space', true), () => holdKey('Space', false)),
    makeButton('br-use', 'USE', () => pulseKey(Input.interactAvailable ? 'KeyE' : 'KeyR')),
    makeButton('br-reload', 'R', () => pulseKey('KeyR')),
  );
  root.append(
    makeButton('br-sprint', 'SPRINT', () => holdKey('ShiftLeft', true), () => holdKey('ShiftLeft', false)),
    makeButton('br-crouch', 'CROUCH', () => holdKey('KeyC', true), () => holdKey('KeyC', false)),
    makeButton('br-pause', 'Ⅱ', () => pulseKey('Escape')),
  );

  const stick = root.querySelector('#br-stick');
  const knob = root.querySelector('#br-stick-knob');
  let movePointer = null;
  const resetMove = () => {
    ['KeyW','KeyA','KeyS','KeyD'].forEach((k) => Input.keys.delete(k));
    knob.style.transform = 'translate(-50%,-50%)';
    movePointer = null;
  };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); movePointer = e.pointerId; stick.setPointerCapture?.(e.pointerId);
    Input._wantLook = true; Input._engageSoft?.();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== movePointer) return;
    e.preventDefault();
    const r = stick.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const radius = r.width * .34;
    const mag = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, radius / mag);
    const x = dx * scale / radius;
    const y = dy * scale / radius;
    knob.style.transform = `translate(calc(-50% + ${x * radius}px), calc(-50% + ${y * radius}px))`;
    const dead = .24;
    holdKey('KeyA', x < -dead); holdKey('KeyD', x > dead);
    holdKey('KeyW', y < -dead); holdKey('KeyS', y > dead);
  });
  stick.addEventListener('pointerup', resetMove);
  stick.addEventListener('pointercancel', resetMove);

  const look = root.querySelector('#br-look');
  let lookPointer = null, lastX = 0, lastY = 0;
  look.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    lookPointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    look.setPointerCapture?.(e.pointerId);
    Input._wantLook = true;
    Input._engageSoft?.();
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookPointer) return;
    e.preventDefault();
    const dx = clamp(e.clientX - lastX, -70, 70);
    const dy = clamp(e.clientY - lastY, -70, 70);
    lastX = e.clientX; lastY = e.clientY;
    Input.mouse.dx += dx * 1.35;
    Input.mouse.dy += dy * 1.35;
    Input.usingGamepad = false;
  });
  const stopLook = (e) => { if (e.pointerId === lookPointer) lookPointer = null; };
  look.addEventListener('pointerup', stopLook);
  look.addEventListener('pointercancel', stopLook);

  // iOS Safari requires user interaction before audio can start. Any touch on
  // the controls counts as that gesture and also keeps browser scrolling/zooming out.
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.documentElement.style.overscrollBehavior = 'none';
}
