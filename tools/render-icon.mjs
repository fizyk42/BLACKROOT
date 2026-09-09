/**
 * Rasterise the icon SVGs to PNGs at every size an app needs, build a
 * multi-resolution favicon.ico, and render a contact sheet for review.
 *
 * Chromium is used as the rasteriser because it renders SVG filters and
 * gradients exactly as a browser will.
 *
 *   node tools/render-icon.mjs
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'assets/icon');
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Small sizes use the simplified art: thicker strokes, fewer twigs, no stars.
const SIZES = [
  [16, 'small'], [24, 'small'], [32, 'small'], [48, 'small'], [64, 'small'],
  [128, 'full'], [180, 'full'], [192, 'full'], [256, 'full'],
  [512, 'full'], [1024, 'full'],
];

const full = await readFile(path.join(OUT, 'icon.svg'), 'utf8');
const small = await readFile(path.join(OUT, 'icon-small.svg'), 'utf8');
const svg = { full, small };

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--force-color-profile=srgb', '--no-sandbox', '--hide-scrollbars'],
});

await mkdir(OUT, { recursive: true });

for (const [size, variant] of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const body = svg[variant].replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
     svg{display:block}</style>${body}`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(120);
  await page.screenshot({
    path: path.join(OUT, `icon-${size}.png`),
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await page.close();
  console.log(`  icon-${size}.png  (${variant})`);
}

/* ---- contact sheet for review ---- */
const sheetW = 1180, sheetH = 560;
const page = await browser.newPage({ viewport: { width: sheetW, height: sheetH }, deviceScaleFactor: 2 });
const b64 = async (f) => (await readFile(path.join(OUT, f))).toString('base64');
const img = async (f, s) => `<img src="data:image/png;base64,${await b64(f)}" width="${s}" height="${s}">`;

await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#111214;color:#8b8880;font:12px/1.5 ui-monospace,Menlo,monospace;
       letter-spacing:.12em;display:flex;flex-direction:column;gap:0}
  .band{padding:26px 34px}
  .dark{background:#0a0b0c}
  .light{background:#e9e7e2}
  .light .lbl{color:#6b6862}
  h2{font:13px/1 ui-monospace,monospace;letter-spacing:.34em;margin:0 0 18px;color:#c0a15a;font-weight:400}
  .row{display:flex;align-items:flex-end;gap:26px}
  .cell{text-align:center}
  .lbl{display:block;margin-top:9px;font-size:9.5px;letter-spacing:.16em;color:#5f5c56}
  img{image-rendering:auto;display:block;margin:0 auto}
  .dock{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.06);
        border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:12px 18px;width:max-content}
  .light .dock{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.1)}
  .tab{display:flex;align-items:center;gap:8px;background:#1d1f22;border-radius:8px 8px 0 0;
       padding:7px 14px 7px 11px;color:#b9b6ae;font-size:11px;letter-spacing:.04em;width:max-content}
</style>
<div class="band dark">
  <h2>BLACKROOT — APP ICON</h2>
  <div class="row">
    <div class="cell">${await img('icon-1024.png', 168)}<span class="lbl">1024</span></div>
    <div class="cell">${await img('icon-256.png', 96)}<span class="lbl">256</span></div>
    <div class="cell">${await img('icon-128.png', 64)}<span class="lbl">128</span></div>
    <div class="cell">${await img('icon-64.png', 48)}<span class="lbl">64</span></div>
    <div class="cell">${await img('icon-48.png', 32)}<span class="lbl">48</span></div>
    <div class="cell">${await img('icon-32.png', 32)}<span class="lbl">32 · 1:1</span></div>
    <div class="cell">${await img('icon-16.png', 16)}<span class="lbl">16 · 1:1</span></div>
    <div class="cell" style="margin-left:18px">
      <div class="dock">${await img('icon-64.png', 44)}${await img('icon-64.png', 44)}${await img('icon-64.png', 44)}</div>
      <span class="lbl">IN A DOCK</span>
    </div>
  </div>
</div>
<div class="band light">
  <div class="row">
    <div class="cell">${await img('icon-256.png', 96)}<span class="lbl">ON LIGHT</span></div>
    <div class="cell">${await img('icon-64.png', 48)}<span class="lbl">64</span></div>
    <div class="cell">${await img('icon-32.png', 32)}<span class="lbl">32 · 1:1</span></div>
    <div class="cell">${await img('icon-16.png', 16)}<span class="lbl">16 · 1:1</span></div>
    <div class="cell" style="margin-left:14px">
      <div class="tab">${await img('icon-16.png', 16)}<span>BLACKROOT — Nightfall in the Hollow</span></div>
      <span class="lbl">BROWSER TAB</span>
    </div>
  </div>
</div>`, { waitUntil: 'load' });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(root, 'icon-preview.png'), fullPage: true });
console.log('  icon-preview.png');

await browser.close();
