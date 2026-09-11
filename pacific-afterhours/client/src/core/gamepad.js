// Browser-standard mapping shared by DualSense, DualShock 4 and Xbox pads.
export const FOOT_BUTTONS = {0:'jump',1:'holster',2:'reload',3:'interact',4:'nextWeapon',5:'fire',6:'aim',7:'fire',8:'roster',9:'pause',10:'sprint',11:'crouch',12:'map',13:'camera',14:'journal',15:'phone',17:'map'};
export const CAR_BUTTONS = {0:'handbrake',2:'headlights',3:'interact',4:'recover',8:'roster',9:'pause',10:'horn',12:'map',13:'camera',14:'journal',15:'phone',17:'map'};
export const PAD_GLYPHS = {
  xbox: {jump:'A',holster:'B',reload:'X',interact:'Y',nextWeapon:'LB',fire:'RT',aim:'LT',roster:'View',pause:'Menu',sprint:'LS',crouch:'RS',map:'D↑',camera:'D↓',journal:'D←',phone:'D→',handbrake:'A',headlights:'X',recover:'Hold LB',horn:'LS'},
  playstation: {jump:'✕',holster:'○',reload:'□',interact:'△',nextWeapon:'L1',fire:'R2',aim:'L2',roster:'Share / Create',pause:'Options',sprint:'L3',crouch:'R3',map:'D↑ / Touchpad',camera:'D↓',journal:'D←',phone:'D→',handbrake:'✕',headlights:'□',recover:'Hold L1',horn:'L3'},
};
export function padType(id = '') { return /dualsense|dualshock|playstation|054c|sony/i.test(id) ? 'playstation' : 'xbox'; }
const finite = n => Number.isFinite(n) ? n : 0;
export function deadzone(value, zone = .18) {
  value = Math.max(-1, Math.min(1, finite(value)));
  zone = Math.max(0, Math.min(.9, finite(zone)));
  return Math.abs(value) <= zone ? 0 : (value - Math.sign(value) * zone) / (1 - zone);
}
export function buttonValue(pad, index) {
  const b = pad?.buttons?.[index];
  return Math.max(0, Math.min(1, finite(b?.value ?? (b?.pressed ? 1 : 0))));
}
export class GamepadState {
  constructor() { this.pad = null; this.key = ''; this.held = new Set(); this.pressed = new Set(); this.released = new Set(); this.active = false; }
  sample(pads, zone = .18) {
    const available = Array.from(pads || []).filter(p => p?.connected && p.mapping === 'standard');
    const active = p => p.buttons.some(b => b?.pressed || b?.value > .35) || p.axes.some(a => Math.abs(finite(a)) > zone);
    const current = available.find(p => `${p.index}:${p.id}` === this.key);
    const pad = (current && active(current) ? current : available.find(active)) || current || available[0] || null;
    const key = pad ? `${pad.index}:${pad.id}` : '';
    const changed = key !== this.key;
    const held = new Set();
    for (let i=0; i<(pad?.buttons.length || 0); i++) if (buttonValue(pad,i) > .35 || pad.buttons[i]?.pressed) held.add(i);
    // A button held while connecting selects the device without activating a menu.
    this.pressed = new Set([...held].filter(i => !changed && !this.held.has(i)));
    this.released = new Set([...this.held].filter(i => !held.has(i)));
    this.active = !!pad && active(pad);
    this.held = held; this.pad = pad; this.key = key;
    return pad;
  }
  reset() { this.pad=null; this.key=''; this.held.clear(); this.pressed.clear(); this.released.clear(); this.active=false; }
}
