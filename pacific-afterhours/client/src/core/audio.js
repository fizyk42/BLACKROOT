// All audio is synthesised at runtime with the Web Audio API — no sample files,
// so there is nothing to download and nothing to license.

import { settings } from './settings.js';
import { clamp } from './util.js';

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = new AC();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx, 2);

    this.master = ctx.createGain();
    this.master.gain.value = settings.masterVolume;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = settings.sfxVolume;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = settings.musicVolume;
    this.musicBus.connect(this.master);

    // --- engine: two detuned saws through a resonant low-pass ---
    this.engine = {};
    const e = this.engine;
    e.gain = ctx.createGain();
    e.gain.gain.value = 0;
    e.filter = ctx.createBiquadFilter();
    e.filter.type = 'lowpass';
    e.filter.frequency.value = 500;
    e.filter.Q.value = 6;
    e.gain.connect(e.filter);
    e.filter.connect(this.sfxBus);
    e.oscA = ctx.createOscillator(); e.oscA.type = 'sawtooth';
    e.oscB = ctx.createOscillator(); e.oscB.type = 'square';
    e.oscA.frequency.value = 60;
    e.oscB.frequency.value = 60 * 1.005;
    const subG = ctx.createGain(); subG.gain.value = 0.45;
    e.oscA.connect(e.gain);
    e.oscB.connect(subG); subG.connect(e.gain);
    e.oscA.start(); e.oscB.start();

    // engine roughness
    e.rumble = ctx.createBufferSource();
    e.rumble.buffer = this.noise;
    e.rumble.loop = true;
    e.rumbleG = ctx.createGain(); e.rumbleG.gain.value = 0;
    e.rumbleF = ctx.createBiquadFilter(); e.rumbleF.type = 'bandpass'; e.rumbleF.frequency.value = 120;
    e.rumble.connect(e.rumbleF); e.rumbleF.connect(e.rumbleG); e.rumbleG.connect(this.sfxBus);
    e.rumble.start();

    // --- tyre screech: filtered noise ---
    this.skid = {};
    this.skid.src = ctx.createBufferSource();
    this.skid.src.buffer = this.noise;
    this.skid.src.loop = true;
    this.skid.f = ctx.createBiquadFilter();
    this.skid.f.type = 'bandpass';
    this.skid.f.frequency.value = 2100;
    this.skid.f.Q.value = 4;
    this.skid.g = ctx.createGain();
    this.skid.g.gain.value = 0;
    this.skid.src.connect(this.skid.f); this.skid.f.connect(this.skid.g); this.skid.g.connect(this.sfxBus);
    this.skid.src.start();

    // --- rain bed ---
    this.rain = {};
    this.rain.src = ctx.createBufferSource();
    this.rain.src.buffer = this.noise;
    this.rain.src.loop = true;
    this.rain.f = ctx.createBiquadFilter();
    this.rain.f.type = 'highpass';
    this.rain.f.frequency.value = 1400;
    this.rain.g = ctx.createGain();
    this.rain.g.gain.value = 0;
    this.rain.src.connect(this.rain.f); this.rain.f.connect(this.rain.g); this.rain.g.connect(this.sfxBus);
    this.rain.src.start();

    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  applyVolumes() {
    if (!this.ready) return;
    this.master.gain.value = settings.masterVolume;
    this.sfxBus.gain.value = settings.sfxVolume;
    this.musicBus.gain.value = settings.musicVolume;
  }

  /** rpm 0..1.15, load 0..1 */
  setEngine(active, rpm = 0, load = 0) {
    if (!this.ready) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    const target = active ? 0.06 + load * 0.05 : 0;
    e.gain.gain.setTargetAtTime(target, t, 0.08);
    const f = 46 + rpm * 190;
    e.oscA.frequency.setTargetAtTime(f, t, 0.05);
    e.oscB.frequency.setTargetAtTime(f * 1.006, t, 0.05);
    e.filter.frequency.setTargetAtTime(320 + rpm * 1900 + load * 600, t, 0.07);
    e.rumbleG.gain.setTargetAtTime(active ? 0.02 + rpm * 0.03 : 0, t, 0.1);
    e.rumbleF.frequency.setTargetAtTime(90 + rpm * 140, t, 0.1);
  }

  setSkid(amount) {
    if (!this.ready) return;
    this.skid.g.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.09, this.ctx.currentTime, 0.05);
  }

  setRain(amount) {
    if (!this.ready) return;
    this.rain.g.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.05, this.ctx.currentTime, 0.4);
  }

  _blip({ type = 'sine', f0 = 440, f1 = 220, dur = 0.15, gain = 0.2, filter = null }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const bf = ctx.createBiquadFilter();
      Object.assign(bf, filter);
      o.connect(bf); node = bf;
    }
    node.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _burst({ dur = 0.2, gain = 0.3, type = 'lowpass', f0 = 900, f1 = 120 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t); s.stop(t + dur + 0.02);
  }

  horn(kind = 0) {
    if (!this.ready) return;
    const base = kind ? 370 : 440;
    this._blip({ type: 'square', f0: base, f1: base, dur: 0.45, gain: 0.09 });
    this._blip({ type: 'sawtooth', f0: base * 1.5, f1: base * 1.5, dur: 0.45, gain: 0.05 });
  }

  impact(force = 1) {
    this._burst({ dur: 0.16 + force * 0.06, gain: clamp(0.12 + force * 0.05, 0, 0.4), f0: 1400, f1: 70 });
    this._blip({ type: 'triangle', f0: 120, f1: 40, dur: 0.22, gain: clamp(0.1 + force * 0.03, 0, 0.3) });
  }

  gunshot(heavy = false) {
    this._burst({ dur: heavy ? 0.24 : 0.13, gain: 0.22, f0: 5200, f1: 180 });
    this._blip({ type: 'square', f0: heavy ? 180 : 260, f1: 55, dur: 0.1, gain: 0.12 });
  }

  dryFire() { this._blip({ type: 'square', f0: 900, f1: 500, dur: 0.04, gain: 0.06 }); }

  footstep(speed = 1) {
    this._burst({ dur: 0.06, gain: 0.035 + speed * 0.006, f0: 1800, f1: 320 });
  }

  punch() { this._burst({ dur: 0.09, gain: 0.14, f0: 900, f1: 90 }); }

  ui(kind = 'move') {
    const map = {
      move: { f0: 520, f1: 520, dur: 0.05, gain: 0.05, type: 'sine' },
      accept: { f0: 620, f1: 880, dur: 0.12, gain: 0.07, type: 'sine' },
      cancel: { f0: 420, f1: 260, dur: 0.12, gain: 0.06, type: 'sine' },
      cash: { f0: 880, f1: 1320, dur: 0.16, gain: 0.07, type: 'triangle' },
      bad: { f0: 300, f1: 140, dur: 0.28, gain: 0.09, type: 'sawtooth' },
      alert: { f0: 720, f1: 300, dur: 0.35, gain: 0.08, type: 'square' },
    };
    this._blip(map[kind] || map.move);
  }

  /** Police siren — a two-tone wail that runs while the pursuit is active. */
  setSiren(on) {
    if (!this.ready) return;
    if (on && !this._siren) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine';
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.9;
      const lg = ctx.createGain(); lg.gain.value = 260;
      const g = ctx.createGain(); g.gain.value = 0;
      o.frequency.value = 700;
      lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(this.sfxBus);
      o.start(); lfo.start();
      g.gain.setTargetAtTime(0.035, ctx.currentTime, 0.3);
      this._siren = { o, lfo, g };
    } else if (!on && this._siren) {
      const s = this._siren;
      s.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
      const t = this.ctx.currentTime + 1.2;
      s.o.stop(t); s.lfo.stop(t);
      this._siren = null;
    }
  }
}

export const audio = new Audio();
