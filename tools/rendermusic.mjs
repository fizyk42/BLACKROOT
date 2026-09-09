/**
 * Render the score to WAV files.
 *
 * The soundtrack in the game is generated live and never repeats, so there is
 * no file to hand anybody. This renders each palette offline — faster than
 * real time, sample-accurate — and writes a .wav you can actually listen to,
 * put in a video, or use as a reference when replacing the synth with
 * recorded music.
 *
 *   node tools/rendermusic.mjs [seconds] [--intensity 0.35]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8524;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const OUT = path.join(root, 'assets/music');

const argSeconds = parseFloat(process.argv[2]);
const SECONDS = Number.isFinite(argSeconds) ? argSeconds : 100;
const iFlag = process.argv.indexOf('--intensity');
const INTENSITY = iFlag > 0 ? parseFloat(process.argv[iFlag + 1]) : null;

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    await stat(f);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404).end('x'); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)));
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });

const palettes = await page.evaluate(async () => Object.keys((await import('/scripts/core/Music.js')).PALETTES));

for (const id of palettes) {
  process.stdout.write(`rendering ${id} … `);
  const wav = await page.evaluate(async ({ id, seconds, forced }) => {
    const { MusicDirector, PALETTES } = await import('/scripts/core/Music.js');
    const SR = 44100;
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);

    // The director expects an AudioManager. Offline it only needs a context,
    // a music bus and the noise buffers the percussion borrows.
    const noise = (kind) => {
      const b = ctx.createBuffer(1, SR * 2, SR);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
      return b;
    };
    const bus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4; comp.knee.value = 14;
    bus.connect(comp).connect(ctx.destination);
    const fakeAudio = {
      ctx, ready: true, bus: { music: bus },
      buffers: { brown: noise('brown'), white: noise('white') },
    };

    const d = new MusicDirector(fakeAudio);
    d.setPalette(id, true);
    d.start(id);
    clearInterval(d._timer);              // offline time is not wall time
    d._timer = null;
    // A shape rather than a constant: the piece opens quiet, builds, and settles.
    const p = PALETTES[id];
    const eighth = (60 / p.bpm) / 2;
    const steps = Math.ceil(seconds / eighth);
    for (let s = 0; s < steps; s++) {
      const t = (s * eighth) / seconds;
      const I = forced !== null ? forced
        : 0.12 + 0.62 * Math.pow(Math.sin(t * Math.PI), 1.4) + (t > 0.72 ? 0.2 : 0);
      d.intensity = Math.min(1, I);
      // layer gains are automation nodes; set them directly on the offline graph
      const set = (k, v) => d.layer[k].gain.setValueAtTime(Math.max(0, v), s * eighth);
      const ramp = (x, lo, hi) => { const q = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return q * q * (3 - 2 * q); };
      set('pad', 0.85 + d.intensity * 0.15);
      set('bass', ramp(d.intensity, 0.05, 0.45) * 0.9);
      set('motif', 0.35 + ramp(d.intensity, 0, 0.55) * 0.5);
      set('perc', ramp(d.intensity, 0.35, 0.8) * 0.85);
      set('shimmer', ramp(d.intensity, 0.55, 1.0) * p.shimmer);
      d._playStep(s, s * eighth + 0.05, eighth);
    }
    d.out.gain.setValueAtTime(0.0001, 0);
    d.out.gain.exponentialRampToValueAtTime(0.9, 4);
    d.out.gain.setValueAtTime(0.9, seconds - 5);
    d.out.gain.exponentialRampToValueAtTime(0.0001, seconds - 0.2);

    const buf = await ctx.startRendering();

    // interleave to 16-bit PCM and wrap in a WAV header
    const n = buf.length, chans = buf.numberOfChannels;
    const bytes = 44 + n * chans * 2;
    const out = new DataView(new ArrayBuffer(bytes));
    const str = (o, v) => { for (let i = 0; i < v.length; i++) out.setUint8(o + i, v.charCodeAt(i)); };
    str(0, 'RIFF'); out.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
    out.setUint16(22, chans, true); out.setUint32(24, SR, true);
    out.setUint32(28, SR * chans * 2, true); out.setUint16(32, chans * 2, true);
    out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, n * chans * 2, true);
    const data = [];
    for (let c = 0; c < chans; c++) data.push(buf.getChannelData(c));
    let o = 44, peak = 0;
    for (let i = 0; i < n; i++) for (let c = 0; c < chans; c++) peak = Math.max(peak, Math.abs(data[c][i]));
    const norm = peak > 0.001 ? Math.min(4, 0.89 / peak) : 1;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < chans; c++) {
        const v = Math.max(-1, Math.min(1, data[c][i] * norm));
        out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        o += 2;
      }
    }
    // base64 out of the page
    const u8 = new Uint8Array(out.buffer);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(bin), peak: +peak.toFixed(3), norm: +norm.toFixed(2) };
  }, { id, seconds: SECONDS, forced: INTENSITY });

  const file = path.join(OUT, `blackroot-${id}.wav`);
  await writeFile(file, Buffer.from(wav.b64, 'base64'));
  const kb = Math.round(Buffer.from(wav.b64, 'base64').length / 1024);
  console.log(`${kb} KB  (peak ${wav.peak}, normalised ×${wav.norm})`);
}

console.log(`\n${palettes.length} tracks written to assets/music/`);
await browser.close();
server.close();
