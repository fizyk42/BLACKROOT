/**
 * MusicDirector — the score. Written, not sampled.
 *
 * There was music in the build before this, but it was one drone whose volume
 * was tied directly to dread, which meant that whenever the game was calm —
 * which is most of the time — there was silence. This replaces it with an
 * actual piece of music that plays continuously and *changes* with the game
 * rather than merely getting louder.
 *
 * How it works:
 *
 *  - **A lookahead scheduler.** `setTimeout` is far too imprecise to sequence
 *    music with, so nothing is ever played "now": every 120 ms the director
 *    looks two seconds into the future and books every note that falls in that
 *    window directly on the audio clock, which is sample-accurate. Two seconds
 *    of lookahead also means the score survives a background tab throttling
 *    timers to one second.
 *
 *  - **Five layers** that fade in and out with intensity: a harmonic pad that
 *    is always there, a bass pulse, a plucked motif through a feedback delay,
 *    low percussion, and a high shimmer that only appears when something is
 *    about to happen. At intensity 0 you get the pad and the occasional
 *    motif — quiet, but present. At intensity 1 all five are running and the
 *    mode has darkened underneath them.
 *
 *  - **A palette per biome.** Root note, scale, tempo and timbre all change,
 *    so the Drowned Shelf does not sound like the Cinder Reach. The palette
 *    crossfades rather than cutting.
 *
 * Everything is oscillators and filters, so the whole soundtrack is a few
 * kilobytes of code rather than a few megabytes of audio.
 */

/* ------------------------------------------------------------------ */
/* theory                                                              */
/* ------------------------------------------------------------------ */

const SCALES = {
  aeolian:   [0, 2, 3, 5, 7, 8, 10],       // natural minor — grief
  phrygian:  [0, 1, 3, 5, 7, 8, 10],       // flat second — dread
  locrian:   [0, 1, 3, 5, 6, 8, 10],       // no stable home — wrongness
  dorian:    [0, 2, 3, 5, 7, 9, 10],       // minor with hope in it — cold
  harmMinor: [0, 2, 3, 5, 7, 8, 11],       // raised seventh — heat, urgency
  wholeTone: [0, 2, 4, 6, 8, 10],          // no leading tone — weightlessness
};

/** Chord degrees, as scale-step offsets from the root of the chord. */
const TRIAD = [0, 2, 4];
const SEVENTH = [0, 2, 4, 6];

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

/* ------------------------------------------------------------------ */
/* palettes                                                            */
/* ------------------------------------------------------------------ */

export const PALETTES = {
  hollow: {
    label: 'Nightfall in the Hollow',
    root: 38,                       // D2
    scale: 'aeolian', darkScale: 'phrygian',
    bpm: 62, padWave: 'sawtooth', padCut: [240, 900],
    pluckWave: 'triangle', pluckOct: 2, delay: 0.42, feedback: 0.34,
    progression: [0, 5, 3, 4],      // i – VI – iv – v, the oldest sad chords there are
    shimmer: 0.5, perc: 'tom',
  },
  void: {
    label: 'The Long Dark',
    root: 41,
    scale: 'wholeTone', darkScale: 'wholeTone',
    bpm: 48, padWave: 'sine', padCut: [400, 2400],
    pluckWave: 'sine', pluckOct: 3, delay: 0.66, feedback: 0.52,
    progression: [0, 2, 4, 2],
    shimmer: 1.0, perc: 'bell',
  },
  abyss: {
    label: 'The Drowned Shelf',
    root: 31,                       // very low — you feel it before you hear it
    scale: 'phrygian', darkScale: 'locrian',
    bpm: 42, padWave: 'sawtooth', padCut: [140, 520],
    pluckWave: 'sine', pluckOct: 2, delay: 0.78, feedback: 0.58,
    progression: [0, 1, 0, 6],
    shimmer: 0.35, perc: 'sub',
  },
  cinder: {
    label: 'The Cinder Reach',
    root: 40,
    scale: 'harmMinor', darkScale: 'phrygian',
    bpm: 78, padWave: 'square', padCut: [300, 1600],
    pluckWave: 'sawtooth', pluckOct: 2, delay: 0.30, feedback: 0.28,
    progression: [0, 4, 5, 4],
    shimmer: 0.6, perc: 'tom',
  },
  permafrost: {
    label: 'The Still White',
    root: 45,
    scale: 'dorian', darkScale: 'aeolian',
    bpm: 52, padWave: 'triangle', padCut: [500, 2800],
    pluckWave: 'sine', pluckOct: 3, delay: 0.58, feedback: 0.44,
    progression: [0, 3, 5, 3],
    shimmer: 1.0, perc: 'bell',
  },
  bloom: {
    label: 'The Bloom',
    root: 37,
    scale: 'locrian', darkScale: 'locrian',
    bpm: 68, padWave: 'sawtooth', padCut: [200, 1100],
    pluckWave: 'triangle', pluckOct: 2, delay: 0.50, feedback: 0.46,
    progression: [0, 6, 1, 5],
    shimmer: 0.7, perc: 'tom',
  },
  menu: {
    label: 'Main theme',
    root: 38,
    scale: 'aeolian', darkScale: 'aeolian',
    bpm: 54, padWave: 'sawtooth', padCut: [260, 1100],
    pluckWave: 'triangle', pluckOct: 2, delay: 0.52, feedback: 0.40,
    progression: [0, 5, 3, 4],
    shimmer: 0.8, perc: 'none',
  },
};

const LOOKAHEAD = 2.0;      // seconds of music booked in advance
const TICK = 120;           // ms between scheduler runs

export class MusicDirector {
  constructor(audio) {
    this.audio = audio;
    this.running = false;
    this.intensity = 0;
    this.palette = PALETTES.hollow;
    this.paletteId = 'hollow';
    this.step = 0;              // eighth-notes elapsed
    this.nextTime = 0;
    this._timer = null;
    this.masterGain = null;
  }

  get ctx() { return this.audio.ctx; }

  /* ================= lifecycle ================= */

  start(paletteId = 'hollow') {
    if (!this.audio.ready || this.running) return;
    const ctx = this.ctx;
    this.setPalette(paletteId, true);

    this.out = ctx.createGain();
    this.out.gain.value = 0.0;
    this.out.connect(this.audio.bus.music);
    // A gentle low shelf keeps the pad from muddying the gunfire.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'highshelf';
    this.tone.frequency.value = 3200;
    this.tone.gain.value = -4;
    this.tone.connect(this.out);

    // Feedback delay: this is what turns four notes into an atmosphere.
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = this.palette.delay;
    this.fb = ctx.createGain();
    this.fb.gain.value = this.palette.feedback;
    this.delayCut = ctx.createBiquadFilter();
    this.delayCut.type = 'lowpass';
    this.delayCut.frequency.value = 2200;
    this.delay.connect(this.delayCut).connect(this.fb).connect(this.delay);
    this.delayCut.connect(this.tone);

    // Per-layer gains, so intensity can bring parts in and out.
    this.layer = {};
    for (const k of ['pad', 'bass', 'motif', 'perc', 'shimmer']) {
      const g = ctx.createGain();
      g.gain.value = k === 'pad' ? 1 : 0;
      g.connect(this.tone);
      this.layer[k] = g;
    }

    this.running = true;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.12;
    this.out.gain.setTargetAtTime(0.9, ctx.currentTime, 2.5);   // fade in
    this._timer = setInterval(() => this._schedule(), TICK);
    this._schedule();
  }

  stop(fade = 1.2) {
    if (!this.running) return;
    this.running = false;
    clearInterval(this._timer);
    this._timer = null;
    if (this.out) {
      const t = this.ctx.currentTime;
      this.out.gain.setTargetAtTime(0, t, fade / 3);
      const out = this.out, delay = this.delay, fb = this.fb;
      setTimeout(() => {
        try { out.disconnect(); fb.disconnect(); delay.disconnect(); } catch (e) { /* already gone */ }
      }, (fade + 0.5) * 1000);
    }
    this.out = null;
  }

  setPalette(id, immediate = false) {
    const p = PALETTES[id] || PALETTES.hollow;
    if (p === this.palette && !immediate) return;
    this.palette = p;
    this.paletteId = id;
    if (this.running && this.delay) {
      const t = this.ctx.currentTime;
      this.delay.delayTime.setTargetAtTime(p.delay, t, 1.2);
      this.fb.gain.setTargetAtTime(p.feedback, t, 1.2);
    }
  }

  /** 0 = nothing is happening, 1 = it is happening right now. */
  setIntensity(x) {
    this.intensity = Math.max(0, Math.min(1, x || 0));
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const I = this.intensity;
    // Each layer has its own threshold, so the score builds in stages rather
    // than everything swelling together.
    const set = (k, v) => this.layer[k].gain.setTargetAtTime(Math.max(0, v), t, 1.6);
    set('pad', 0.85 + I * 0.15);
    set('bass', ramp(I, 0.05, 0.45) * 0.9);
    set('motif', 0.35 + ramp(I, 0.0, 0.55) * 0.5);
    set('perc', ramp(I, 0.35, 0.8) * 0.85);
    set('shimmer', ramp(I, 0.55, 1.0) * this.palette.shimmer);
    this.delayCut.frequency.setTargetAtTime(1400 + I * 3200, t, 2.0);
  }

  /* ================= the scheduler ================= */

  _schedule() {
    if (!this.running || !this.ctx) return;
    const p = this.palette;
    const spb = 60 / p.bpm;
    const eighth = spb / 2;
    const until = this.ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.nextTime < until && guard++ < 64) {
      this._playStep(this.step, this.nextTime, eighth);
      this.step++;
      this.nextTime += eighth;
    }
  }

  /** One eighth note of the arrangement. */
  _playStep(step, when, eighth) {
    const p = this.palette;
    const I = this.intensity;
    const bar = Math.floor(step / 8) % p.progression.length;
    const inBar = step % 8;
    // The mode darkens as things get worse: the same melody, a worse scale.
    const scale = SCALES[I > 0.55 ? p.darkScale : p.scale];
    const degree = p.progression[bar];

    // --- pad: one long chord a bar ---
    if (inBar === 0) {
      const chordSteps = I > 0.5 ? SEVENTH : TRIAD;
      for (let i = 0; i < chordSteps.length; i++) {
        const n = p.root + 12 + scaleNote(scale, degree + chordSteps[i]);
        this._pad(midi(n), when, eighth * 8.6, 0.16 / chordSteps.length + (i === 0 ? 0.06 : 0));
      }
    }

    // --- bass: root on the beat, with a push before the change ---
    if (inBar === 0 || inBar === 4 || (inBar === 7 && I > 0.4)) {
      const n = p.root + scaleNote(scale, degree);
      this._bass(midi(n), when, eighth * (inBar === 7 ? 0.8 : 1.9), inBar === 7 ? 0.10 : 0.18);
    }

    // --- motif: a sparse melodic figure that gets denser with intensity ---
    const density = 0.22 + I * 0.5;
    if (rand(step * 7919 + bar) < density) {
      const oct = 12 * p.pluckOct;
      const pick = [0, 2, 4, 6, 7][Math.floor(rand(step * 104729) * 5)];
      const n = p.root + oct + scaleNote(scale, degree + pick);
      this._pluck(midi(n), when, 0.9 + rand(step * 31) * 0.8, 0.10 + I * 0.05);
    }

    // --- percussion: a heartbeat that speeds up ---
    if (p.perc !== 'none' && I > 0.3) {
      const hit = I > 0.7 ? (inBar % 2 === 0) : (inBar === 0 || inBar === 5);
      if (hit) this._perc(p.perc, when, 0.5 + I * 0.5);
      // the second beat of the heartbeat
      if (I > 0.55 && (inBar === 0 || inBar === 4)) this._perc(p.perc, when + eighth * 0.34, 0.28 + I * 0.3);
    }

    // --- shimmer: high, thin, and only when it is nearly too late ---
    if (I > 0.6 && inBar === 2 && rand(step * 6151) < 0.6) {
      const n = p.root + 36 + scaleNote(scale, degree + 4);
      this._shimmer(midi(n), when, 2.6, 0.05 * p.shimmer);
    }
  }

  /* ================= voices ================= */

  _pad(freq, when, dur, gain) {
    const ctx = this.ctx, p = this.palette;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(p.padCut[0], when);
    f.frequency.linearRampToValueAtTime(p.padCut[0] + (p.padCut[1] - p.padCut[0]) * (0.3 + this.intensity * 0.7), when + dur * 0.6);
    f.Q.value = 0.8;
    f.connect(g).connect(this.layer.pad);
    // Two slightly detuned oscillators per note: one is a tone, two is a pad.
    for (const cents of [-6, 7]) {
      const o = ctx.createOscillator();
      o.type = p.padWave;
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(f);
      o.start(when);
      o.stop(when + dur + 0.05);
    }
  }

  _bass(freq, when, dur, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 1.4;
    f.connect(g).connect(this.layer.bass);
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth'; o2.frequency.value = freq; o2.detune.value = 4;
    const o2g = ctx.createGain(); o2g.gain.value = 0.35;
    o.connect(f); o2.connect(o2g).connect(f);
    o.start(when); o2.start(when);
    o.stop(when + dur + 0.05); o2.stop(when + dur + 0.05);
  }

  _pluck(freq, when, dur, gain) {
    const ctx = this.ctx, p = this.palette;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq * 1.6; f.Q.value = 1.1;
    f.connect(g);
    g.connect(this.layer.motif);
    g.connect(this.delay);          // the tail is most of the sound
    const o = ctx.createOscillator();
    o.type = p.pluckWave; o.frequency.value = freq;
    o.connect(f);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  _shimmer(freq, when, dur, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    g.connect(this.layer.shimmer);
    g.connect(this.delay);
    for (const mul of [1, 1.5, 2.02]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mul;
      const og = ctx.createGain();
      og.gain.value = mul === 1 ? 1 : 0.3 / mul;
      o.connect(og).connect(g);
      o.start(when);
      o.stop(when + dur + 0.05);
    }
  }

  _perc(kind, when, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.layer.perc);
    if (kind === 'bell') {
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain * 0.22, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 1.8);
      for (const f of [880, 1320, 1979]) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = 880 / f * 0.5;
        o.connect(og).connect(g);
        o.start(when); o.stop(when + 1.9);
      }
      g.connect(this.delay);
      return;
    }
    // tom / sub: a pitch-dropping sine with a noise transient
    const dur = kind === 'sub' ? 1.1 : 0.5;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain * (kind === 'sub' ? 0.5 : 0.34), when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'sub' ? 78 : 132, when);
    o.frequency.exponentialRampToValueAtTime(kind === 'sub' ? 34 : 52, when + dur * 0.8);
    o.connect(g);
    o.start(when); o.stop(when + dur + 0.05);
    if (kind !== 'sub' && this.audio.buffers && this.audio.buffers.brown) {
      const n = ctx.createBufferSource();
      n.buffer = this.audio.buffers.brown;
      const nf = ctx.createBiquadFilter();
      nf.type = 'lowpass'; nf.frequency.value = 400;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(gain * 0.16, when);
      ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      n.connect(nf).connect(ng).connect(g);
      n.start(when, Math.random() * 1.5);
      n.stop(when + 0.2);
    }
  }
}

/* ------------------------------------------------------------------ */

/** Map a scale step (which may run past an octave) to a semitone offset. */
function scaleNote(scale, step) {
  const n = scale.length;
  const oct = Math.floor(step / n);
  let i = step % n;
  if (i < 0) i += n;
  return scale[i] + oct * 12;
}

/** Deterministic 0..1 from an integer, so a given bar always decides the same. */
function rand(i) {
  let x = (i ^ 0x9E3779B9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** 0 below `lo`, 1 above `hi`, smooth between. */
function ramp(x, lo, hi) {
  const t = Math.max(0, Math.min(1, (x - lo) / Math.max(0.0001, hi - lo)));
  return t * t * (3 - 2 * t);
}
