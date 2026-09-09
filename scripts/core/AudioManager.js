/**
 * AudioManager — a fully procedural Web Audio engine.
 *
 * The prototype ships with no sampled audio assets: every gunshot, footstep,
 * growl and gust of wind is synthesised at runtime from noise buffers and
 * oscillators. That keeps the download tiny and makes every sound trivially
 * replaceable later (see replaceWithSample()).
 *
 * Routing:  source -> [panner] -> busGain(sfx|ambient|music) -> master -> out
 */

import { Settings } from './Settings.js';
import { MusicDirector } from './Music.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = {};
    this.samples = {};          // optional user-supplied AudioBuffers by name
    this._ambientNodes = [];
    this._musicNodes = [];
    this._lastFootstep = 0;
    this._muted = false;
  }

  /* ---------------- lifecycle ---------------- */

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn('WebAudio unavailable — running silent'); return; }
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 18;
    this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(this.ctx.destination);

    this.bus = {
      sfx: this.ctx.createGain(),
      ambient: this.ctx.createGain(),
      music: this.ctx.createGain(),
    };
    for (const k of Object.keys(this.bus)) this.bus[k].connect(this.master);

    // Cheap "outdoors" reverb: a short generated impulse response.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.9, 2.6);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.32;
    this.reverb.connect(this.reverbGain).connect(this.bus.sfx);

    this._makeNoise();
    this.applyVolumes();
    this.ready = true;

    Settings.onChange((k) => { if (k.startsWith('vol')) this.applyVolumes(); });
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  applyVolumes() {
    if (!this.ctx) return;
    const m = this._muted ? 0 : Settings.get('volMaster');
    this.master.gain.setTargetAtTime(m, this.ctx.currentTime, 0.05);
    this.bus.sfx.gain.setTargetAtTime(Settings.get('volSfx'), this.ctx.currentTime, 0.05);
    this.bus.ambient.gain.setTargetAtTime(Settings.get('volAmbient'), this.ctx.currentTime, 0.05);
    this.bus.music.gain.setTargetAtTime(Settings.get('volMusic'), this.ctx.currentTime, 0.05);
  }

  /* ---------------- buffers ---------------- */

  _makeNoise() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    // white
    const w = ctx.createBuffer(1, sr * 2, sr);
    const wd = w.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.buffers.white = w;
    // brown (integrated white) — deeper rumbles, wind
    const b = ctx.createBuffer(1, sr * 4, sr);
    const bd = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bd.length; i++) {
      const wn = Math.random() * 2 - 1;
      last = (last + 0.02 * wn) / 1.02;
      bd[i] = last * 3.2;
    }
    this.buffers.brown = b;
    // pink-ish
    const p = ctx.createBuffer(1, sr * 3, sr);
    const pd = p.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < pd.length; i++) {
      const wn = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + wn * 0.0990460;
      b1 = 0.96300 * b1 + wn * 0.2965164;
      b2 = 0.57000 * b2 + wn * 1.0526913;
      pd[i] = (b0 + b1 + b2 + wn * 0.1848) * 0.22;
    }
    this.buffers.pink = p;
  }

  _makeImpulse(seconds, decay) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < sr * 0.012 ? 0.25 : 1);
      }
    }
    return buf;
  }

  /**
   * Hook for later asset replacement: drop a decoded AudioBuffer in under the
   * name of any synth cue (e.g. 'gun.rifle') and playSample() will prefer it.
   */
  replaceWithSample(name, audioBuffer) { this.samples[name] = audioBuffer; }

  /* ---------------- 3D listener ---------------- */

  updateListener(pos, forward, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(pos.x, t, 0.02);
      L.positionY.setTargetAtTime(pos.y, t, 0.02);
      L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(forward.x, t, 0.02);
      L.forwardY.setTargetAtTime(forward.y, t, 0.02);
      L.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.05);
      L.upY.setTargetAtTime(up.y, t, 0.05);
      L.upZ.setTargetAtTime(up.z, t, 0.05);
    } else if (L.setPosition) {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  _panner(pos, refDist = 6, maxDist = 240, rolloff = 1.1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = maxDist;
    p.rolloffFactor = rolloff;
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  /* ---------------- primitives ---------------- */

  _noiseBurst(opt) {
    const {
      buffer = 'white', dur = 0.12, gain = 0.6, filter = 'bandpass',
      freq = 900, q = 1.0, freqEnd = null, at = 0.002, decay = 2.5,
      dest = null, pos = null, playbackRate = 1, delay = 0, reverbSend = 0,
    } = opt;
    const ctx = this.ctx, t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[buffer];
    src.playbackRate.value = playbackRate;
    const off = Math.random() * (src.buffer.duration - dur - 0.02);
    const bp = ctx.createBiquadFilter();
    bp.type = filter; bp.frequency.value = freq; bp.Q.value = q;
    if (freqEnd !== null) {
      bp.frequency.setValueAtTime(freq, t0);
      bp.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g);
    const out = dest || (pos ? this._panner(pos) : this.bus.sfx);
    g.connect(out);
    if (out !== this.bus.sfx && out !== this.bus.ambient) out.connect(this.bus.sfx);
    if (reverbSend > 0) { const rs = ctx.createGain(); rs.gain.value = reverbSend; g.connect(rs).connect(this.reverb); }
    src.start(t0, Math.max(0, off));
    src.stop(t0 + dur + 0.05);
    return g;
  }

  _tone(opt) {
    const {
      type = 'sine', freq = 220, freqEnd = null, dur = 0.3, gain = 0.3,
      at = 0.004, dest = null, pos = null, delay = 0, detune = 0, reverbSend = 0,
    } = opt;
    const ctx = this.ctx, t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    if (freqEnd !== null) {
      o.frequency.setValueAtTime(freq, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    const out = dest || (pos ? this._panner(pos) : this.bus.sfx);
    g.connect(out);
    if (out !== this.bus.sfx && out !== this.bus.ambient) out.connect(this.bus.sfx);
    if (reverbSend > 0) { const rs = ctx.createGain(); rs.gain.value = reverbSend; g.connect(rs).connect(this.reverb); }
    o.start(t0); o.stop(t0 + dur + 0.05);
    return g;
  }

  /* ---------------- weapon cues ---------------- */

  gunshot(profile, pos) {
    if (!this.ready) return;
    const P = {
      pistol:  { body: 210, crack: 2600, dur: 0.24, gain: 0.75, tail: 0.55 },
      revolver:{ body: 150, crack: 2200, dur: 0.34, gain: 0.95, tail: 0.75 },
      smg:     { body: 240, crack: 3000, dur: 0.18, gain: 0.62, tail: 0.4 },
      rifle:   { body: 110, crack: 1800, dur: 0.42, gain: 1.0,  tail: 0.95 },
      shotgun: { body: 90,  crack: 1400, dur: 0.40, gain: 1.05, tail: 0.85 },
      ar:      { body: 160, crack: 2400, dur: 0.26, gain: 0.85, tail: 0.6 },
    }[profile] || { body: 200, crack: 2400, dur: 0.25, gain: 0.7, tail: 0.5 };

    const dest = pos ? this._panner(pos, 10, 400, 0.9) : null;
    // crack
    this._noiseBurst({ buffer: 'white', dur: P.dur * 0.4, gain: P.gain, filter: 'highpass', freq: P.crack, freqEnd: P.crack * 0.35, q: 0.6, dest, reverbSend: 0.5 });
    // body thump
    this._tone({ type: 'sine', freq: P.body, freqEnd: P.body * 0.35, dur: P.dur, gain: P.gain * 0.85, dest, reverbSend: 0.35 });
    this._tone({ type: 'square', freq: P.body * 2.1, freqEnd: P.body * 0.6, dur: P.dur * 0.35, gain: P.gain * 0.22, dest });
    // mechanical action
    this._noiseBurst({ buffer: 'white', dur: 0.05, gain: 0.12, filter: 'bandpass', freq: 3600, q: 2, delay: 0.035, dest });
    // distant forest tail
    this._noiseBurst({ buffer: 'pink', dur: P.tail, gain: 0.10, filter: 'lowpass', freq: 900, freqEnd: 240, delay: 0.05, dest, reverbSend: 0.9 });
  }

  dryFire(pos) { if (this.ready) this._noiseBurst({ dur: 0.05, gain: 0.24, filter: 'bandpass', freq: 2400, q: 3, pos }); }

  reloadStep(kind, pos) {
    if (!this.ready) return;
    // These were mixed for a room much quieter than the one the game ended up
    // being: a narrow bandpass throws away most of a noise burst's energy, so
    // the gains have to be well above what the number suggests.
    const t = { magOut: [1500, 0.06, 0.62], magIn: [900, 0.08, 0.78], bolt: [2800, 0.07, 0.7], shell: [2100, 0.05, 0.55] }[kind] || [1600, 0.06, 0.6];
    this._noiseBurst({ dur: t[1], gain: t[2], filter: 'bandpass', freq: t[0], q: 1.6, pos });
    this._noiseBurst({ dur: t[1] * 1.6, gain: t[2] * 0.5, filter: 'lowpass', freq: 900, pos });
    this._tone({ type: 'square', freq: t[0] * 0.12, dur: 0.06, gain: 0.22, pos });
  }

  meleeSwing(pos) { if (this.ready) this._noiseBurst({ buffer: 'pink', dur: 0.22, gain: 0.3, filter: 'bandpass', freq: 700, freqEnd: 2200, q: 0.8, pos }); }
  meleeHit(pos) {
    if (!this.ready) return;
    this._noiseBurst({ dur: 0.13, gain: 0.55, filter: 'lowpass', freq: 1400, freqEnd: 300, pos });
    this._tone({ type: 'sine', freq: 130, freqEnd: 60, dur: 0.16, gain: 0.4, pos });
  }

  impact(material, pos) {
    if (!this.ready) return;
    const M = {
      dirt:  { freq: 480, dur: 0.12, gain: 0.85, buf: 'brown' },
      wood:  { freq: 1100, dur: 0.14, gain: 1.05, buf: 'white' },
      rock:  { freq: 2600, dur: 0.11, gain: 1.2, buf: 'white' },
      metal: { freq: 3400, dur: 0.24, gain: 1.1, buf: 'white' },
      flesh: { freq: 320, dur: 0.14, gain: 1.3, buf: 'brown' },
      foliage:{ freq: 3000, dur: 0.16, gain: 0.55, buf: 'pink' },
    }[material] || { freq: 900, dur: 0.12, gain: 0.9, buf: 'white' };
    this._noiseBurst({ buffer: M.buf, dur: M.dur, gain: M.gain, filter: 'bandpass', freq: M.freq, freqEnd: M.freq * 0.35, q: 0.9, pos, reverbSend: 0.18 });
    // a broadband transient so the hit has an attack you can hear over gunfire
    this._noiseBurst({ buffer: 'white', dur: 0.035, gain: M.gain * 0.55, filter: 'highpass', freq: 900, pos });
    if (material === 'metal') this._tone({ type: 'triangle', freq: 2600, freqEnd: 1400, dur: 0.3, gain: 0.12, pos });
    if (material === 'flesh') this._tone({ type: 'sine', freq: 90, freqEnd: 45, dur: 0.18, gain: 0.3, pos });
  }

  /* ---------------- player cues ---------------- */

  footstep(surface, running, crouching) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this._lastFootstep < 90) return;
    this._lastFootstep = now;
    const S = {
      dirt:   { freq: 420, q: 0.8, buf: 'brown', g: 0.78, thump: 90 },
      grass:  { freq: 2400, q: 0.7, buf: 'pink', g: 0.60, thump: 110 },
      leaves: { freq: 3200, q: 0.6, buf: 'white', g: 0.70, thump: 120 },
      rock:   { freq: 1500, q: 1.2, buf: 'white', g: 0.75, thump: 140 },
      wood:   { freq: 700, q: 1.4, buf: 'brown', g: 0.90, thump: 100 },
      water:  { freq: 1800, q: 0.5, buf: 'white', g: 0.88, thump: 80 },
    }[surface] || { freq: 900, q: 1, buf: 'brown', g: 0.72, thump: 100 };
    const mul = crouching ? 0.35 : running ? 1.35 : 1.0;
    this._noiseBurst({
      buffer: S.buf, dur: running ? 0.13 : 0.18, gain: S.g * mul * (0.82 + Math.random() * 0.36),
      filter: 'bandpass', freq: S.freq * (0.85 + Math.random() * 0.3), freqEnd: S.freq * 0.4, q: S.q,
    });
    // A short low thump under every step. Footsteps you only hear in the
    // treble read as texture; footsteps you feel read as a body moving.
    this._tone({ type: 'sine', freq: S.thump, freqEnd: S.thump * 0.55, dur: 0.09, gain: 0.30 * mul });
    if (surface === 'water') this._noiseBurst({ buffer: 'white', dur: 0.3, gain: 0.20 * mul, filter: 'highpass', freq: 2600, delay: 0.03 });
  }

  land(hard) {
    if (!this.ready) return;
    this._noiseBurst({ buffer: 'brown', dur: hard ? 0.26 : 0.15, gain: hard ? 0.5 : 0.26, filter: 'lowpass', freq: 700, freqEnd: 180 });
    if (hard) this._tone({ type: 'sine', freq: 70, freqEnd: 40, dur: 0.25, gain: 0.3 });
  }

  breath(intensity) {
    if (!this.ready) return;
    this._noiseBurst({ buffer: 'pink', dur: 0.45, gain: 0.05 + intensity * 0.14, filter: 'bandpass', freq: 620, freqEnd: 340, q: 0.7 });
  }

  hurt(severity) {
    if (!this.ready) return;
    this._noiseBurst({ buffer: 'pink', dur: 0.3, gain: 0.16 + severity * 0.2, filter: 'bandpass', freq: 380, freqEnd: 200, q: 0.9 });
    this._tone({ type: 'sawtooth', freq: 150, freqEnd: 90, dur: 0.28, gain: 0.06 + severity * 0.08 });
  }

  heartbeat(rate) {
    if (!this.ready) return;
    this._tone({ type: 'sine', freq: 58, freqEnd: 34, dur: 0.16, gain: 0.34 });
    this._tone({ type: 'sine', freq: 52, freqEnd: 30, dur: 0.14, gain: 0.24, delay: 0.20 });
  }

  /* ---------------- item cues ---------------- */

  pickup()  { if (this.ready) { this._tone({ type: 'triangle', freq: 620, dur: 0.07, gain: 0.16 }); this._tone({ type: 'triangle', freq: 940, dur: 0.09, gain: 0.13, delay: 0.055 }); } }
  eat()     { if (this.ready) this._noiseBurst({ buffer: 'brown', dur: 0.32, gain: 0.24, filter: 'bandpass', freq: 500, freqEnd: 900, q: 0.8 }); }
  drink()   { if (this.ready) for (let i = 0; i < 3; i++) this._noiseBurst({ buffer: 'white', dur: 0.1, gain: 0.16, filter: 'bandpass', freq: 500 + i * 220, q: 4, delay: i * 0.14 }); }
  heal()    { if (this.ready) { this._noiseBurst({ buffer: 'white', dur: 0.5, gain: 0.14, filter: 'bandpass', freq: 2600, freqEnd: 1400, q: 1.4 }); this._tone({ type: 'sine', freq: 420, freqEnd: 640, dur: 0.5, gain: 0.08 }); } }
  uiClick() { if (this.ready) this._tone({ type: 'square', freq: 340, freqEnd: 220, dur: 0.05, gain: 0.06 }); }
  uiMove()  { if (this.ready) this._tone({ type: 'sine', freq: 700, dur: 0.03, gain: 0.03 }); }
  denied()  { if (this.ready) this._tone({ type: 'square', freq: 180, freqEnd: 110, dur: 0.14, gain: 0.09 }); }
  flashlightClick() { if (this.ready) this._noiseBurst({ dur: 0.035, gain: 0.2, filter: 'bandpass', freq: 3200, q: 5 }); }

  /* ---------------- creature cues ---------------- */

  mutantGrowl(type, pos, dist = 20) {
    if (!this.ready) return;
    const dest = this._panner(pos, 8, 260, 1.0);
    // Each biome's mutants get their own register, so you can hear which
    // kind of place you are in before you can see anything in it.
    const base = { stalker: 96, brute: 54, crawler: 170, screamer: 130,
      choir: 210, drowned: 44, ashwalker: 124, rimewretch: 66, sporebearer: 88 }[type] || 100;
    const dur = { stalker: 1.0, brute: 1.5, crawler: 0.45, screamer: 0.8,
      choir: 1.8, drowned: 2.1, ashwalker: 0.7, rimewretch: 1.6, sporebearer: 1.2 }[type] || 0.9;
    this._tone({ type: 'sawtooth', freq: base, freqEnd: base * 0.72, dur, gain: 0.30, dest, reverbSend: 0.4 });
    this._tone({ type: 'sawtooth', freq: base * 1.5, freqEnd: base * 0.9, dur: dur * 0.8, gain: 0.11, dest, detune: 18 });
    this._noiseBurst({ buffer: 'brown', dur, gain: 0.16, filter: 'bandpass', freq: base * 4, freqEnd: base * 2, q: 1.1, dest });
  }

  mutantScream(pos) {
    if (!this.ready) return;
    const dest = this._panner(pos, 14, 500, 0.75);
    this._tone({ type: 'sawtooth', freq: 320, freqEnd: 1250, dur: 0.55, gain: 0.42, dest, reverbSend: 0.85 });
    this._tone({ type: 'sawtooth', freq: 640, freqEnd: 2400, dur: 0.5, gain: 0.16, dest, detune: 30 });
    this._tone({ type: 'sawtooth', freq: 1100, freqEnd: 300, dur: 0.9, gain: 0.22, delay: 0.5, dest, reverbSend: 0.9 });
    this._noiseBurst({ buffer: 'white', dur: 1.2, gain: 0.10, filter: 'bandpass', freq: 2200, freqEnd: 700, q: 0.8, dest, reverbSend: 0.7 });
  }

  mutantAttack(pos) {
    if (!this.ready) return;
    const dest = this._panner(pos, 6, 140, 1.3);
    this._tone({ type: 'sawtooth', freq: 220, freqEnd: 90, dur: 0.3, gain: 0.32, dest });
    this._noiseBurst({ buffer: 'white', dur: 0.2, gain: 0.3, filter: 'bandpass', freq: 1600, freqEnd: 500, q: 0.9, dest });
  }

  mutantDeath(type, pos) {
    if (!this.ready) return;
    const dest = this._panner(pos, 8, 220, 1.0);
    const base = { stalker: 110, brute: 60, crawler: 190, screamer: 150,
      choir: 240, drowned: 48, ashwalker: 140, rimewretch: 72, sporebearer: 96 }[type] || 110;
    this._tone({ type: 'sawtooth', freq: base * 1.6, freqEnd: base * 0.4, dur: 1.3, gain: 0.34, dest, reverbSend: 0.5 });
    this._noiseBurst({ buffer: 'brown', dur: 1.5, gain: 0.2, filter: 'lowpass', freq: 900, freqEnd: 120, dest });
  }

  animal(kind, pos) {
    if (!this.ready) return;
    const dest = this._panner(pos, 10, 340, 0.95);
    switch (kind) {
      case 'wolfHowl':
        this._tone({ type: 'sawtooth', freq: 330, freqEnd: 430, dur: 1.9, gain: 0.24, dest, reverbSend: 0.9 });
        this._tone({ type: 'sine', freq: 660, freqEnd: 860, dur: 1.8, gain: 0.09, dest, reverbSend: 0.8 });
        break;
      case 'wolfGrowl':
        this._tone({ type: 'sawtooth', freq: 130, freqEnd: 105, dur: 0.85, gain: 0.24, dest });
        this._noiseBurst({ buffer: 'brown', dur: 0.85, gain: 0.14, filter: 'bandpass', freq: 420, q: 1.1, dest });
        break;
      case 'wolfBark':
        this._tone({ type: 'sawtooth', freq: 400, freqEnd: 180, dur: 0.16, gain: 0.34, dest });
        this._noiseBurst({ buffer: 'white', dur: 0.14, gain: 0.2, filter: 'bandpass', freq: 1200, q: 0.9, dest });
        break;
      case 'bearRoar':
        this._tone({ type: 'sawtooth', freq: 88, freqEnd: 58, dur: 1.5, gain: 0.46, dest, reverbSend: 0.6 });
        this._tone({ type: 'square', freq: 44, freqEnd: 32, dur: 1.4, gain: 0.2, dest });
        this._noiseBurst({ buffer: 'brown', dur: 1.5, gain: 0.24, filter: 'lowpass', freq: 700, freqEnd: 180, dest });
        break;
      case 'boarSnort':
        this._noiseBurst({ buffer: 'brown', dur: 0.2, gain: 0.3, filter: 'bandpass', freq: 380, freqEnd: 700, q: 1.4, dest });
        this._noiseBurst({ buffer: 'brown', dur: 0.16, gain: 0.24, filter: 'bandpass', freq: 420, q: 1.4, delay: 0.22, dest });
        break;
      case 'deerCall':
        this._tone({ type: 'triangle', freq: 620, freqEnd: 430, dur: 0.5, gain: 0.16, dest, reverbSend: 0.5 });
        break;
      case 'owl':
        this._tone({ type: 'sine', freq: 400, freqEnd: 340, dur: 0.32, gain: 0.13, dest, reverbSend: 0.7 });
        this._tone({ type: 'sine', freq: 380, freqEnd: 320, dur: 0.42, gain: 0.11, delay: 0.44, dest, reverbSend: 0.7 });
        break;
      case 'crow':
        for (let i = 0; i < 3; i++) this._noiseBurst({ buffer: 'white', dur: 0.13, gain: 0.13, filter: 'bandpass', freq: 1300, freqEnd: 800, q: 3, delay: i * 0.19, dest });
        break;
      case 'branch':
        this._noiseBurst({ buffer: 'white', dur: 0.09, gain: 0.34, filter: 'bandpass', freq: 2100, freqEnd: 900, q: 2.4, dest, reverbSend: 0.35 });
        this._noiseBurst({ buffer: 'brown', dur: 0.22, gain: 0.14, filter: 'lowpass', freq: 800, delay: 0.05, dest });
        break;
      case 'rustle':
        this._noiseBurst({ buffer: 'pink', dur: 0.5, gain: 0.16, filter: 'bandpass', freq: 3200, freqEnd: 1800, q: 0.7, dest });
        break;
      case 'distantScream':
        this._tone({ type: 'sawtooth', freq: 260, freqEnd: 720, dur: 1.1, gain: 0.13, dest, reverbSend: 1.0 });
        this._noiseBurst({ buffer: 'pink', dur: 1.6, gain: 0.07, filter: 'bandpass', freq: 1100, freqEnd: 400, q: 0.7, dest, reverbSend: 1.0 });
        break;
      case 'death':
        this._tone({ type: 'sawtooth', freq: 260, freqEnd: 90, dur: 0.9, gain: 0.26, dest });
        break;
      default: break;
    }
  }

  /* ---------------- ambience & score ---------------- */

  startAmbience() {
    if (!this.ready || this._ambientNodes.length) return;
    const ctx = this.ctx;

    // Wind bed: brown noise through a slowly-sweeping lowpass.
    const wind = ctx.createBufferSource();
    wind.buffer = this.buffers.brown; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380; wf.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.30;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lfoG = ctx.createGain(); lfoG.gain.value = 240;
    lfo.connect(lfoG).connect(wf.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.021;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.14;
    lfo2.connect(lfo2G).connect(wg.gain);
    wind.connect(wf).connect(wg).connect(this.bus.ambient);
    wind.start(); lfo.start(); lfo2.start();

    // Canopy hiss: high band, gently modulated — leaves moving.
    const leaves = ctx.createBufferSource();
    leaves.buffer = this.buffers.pink; leaves.loop = true;
    const lf = ctx.createBiquadFilter(); lf.type = 'bandpass'; lf.frequency.value = 4200; lf.Q.value = 0.5;
    const lg = ctx.createGain(); lg.gain.value = 0.055;
    const llfo = ctx.createOscillator(); llfo.frequency.value = 0.09;
    const llfoG = ctx.createGain(); llfoG.gain.value = 0.04;
    llfo.connect(llfoG).connect(lg.gain);
    leaves.connect(lf).connect(lg).connect(this.bus.ambient);
    leaves.start(); llfo.start();

    // Insects: narrow high band, tremolo.
    const bugs = ctx.createBufferSource();
    bugs.buffer = this.buffers.white; bugs.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 6400; bf.Q.value = 14;
    const bg = ctx.createGain(); bg.gain.value = 0.03;
    const trem = ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 7.5;
    const tremG = ctx.createGain(); tremG.gain.value = 0.022;
    trem.connect(tremG).connect(bg.gain);
    bugs.connect(bf).connect(bg).connect(this.bus.ambient);
    bugs.start(); trem.start();

    this._ambientNodes = [wind, lfo, lfo2, leaves, llfo, bugs, trem];
    this._ambientGains = { wind: wg, leaves: lg, bugs: bg };
  }

  stopAmbience() {
    for (const n of this._ambientNodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
    this._ambientNodes = [];
  }

  /** Tension score: two slow detuned drones whose level tracks 0..1 dread. */
  /* ---------------- music ---------------- */

  /**
   * The score lives in MusicDirector; this is only the handle onto it. The old
   * implementation here was a single drone whose gain was tied to dread, which
   * meant silence whenever the game was calm — i.e. nearly always.
   */
  startMusic(palette = 'hollow') {
    if (!this.ready) return;
    if (!this.music) this.music = new MusicDirector(this);
    this.music.setPalette(palette, true);
    this.music.start(palette);
    this.music.setIntensity(this._dread || 0);
  }

  setMusicPalette(palette) {
    if (this.music) this.music.setPalette(palette);
  }

  /** dread: 0 (calm) .. 1 (imminent) */
  setDread(dread) {
    this._dread = dread;
    if (!this.ready) return;
    if (this.music) this.music.setIntensity(dread);
    if (this._ambientGains) {
      const t = this.ctx.currentTime;
      this._ambientGains.bugs.gain.setTargetAtTime(0.032 * (1 - dread * 0.85), t, 2.5);
    }
  }

  stopMusic() {
    if (this.music) this.music.stop();
  }

  stopAll() { this.stopAmbience(); this.stopMusic(); }
  setMuted(m) { this._muted = m; this.applyVolumes(); }
}

export const Audio = new AudioEngine();
