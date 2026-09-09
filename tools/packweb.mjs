/**
 * packweb — package the game for the places that host web games.
 *
 *   node tools/packweb.mjs        (or: npm run packweb)
 *
 * Produces dist/web/index.html and dist/BLACKROOT-web.zip.
 *
 * Every host worth using wants the same thing — a folder with `index.html` at
 * its root — so one package covers all of them:
 *
 *   itch.io        upload the zip, tick "This file will be played in the
 *                  browser", set the viewport, publish
 *   Netlify        drag the `dist/web` folder onto app.netlify.com/drop
 *   GitHub Pages   commit index.html to a repo, Settings → Pages
 *   Cloudflare     `npx wrangler pages deploy dist/web`
 *
 * It is the single-file build renamed. That is not laziness: the whole game is
 * one self-contained HTML file with no external requests, so there is nothing
 * for a build pipeline to do and nothing for a CDN to get wrong.
 */
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = path.join(root, 'dist/BLACKROOT.html');
const OUT_DIR = path.join(root, 'dist/web');
const ZIP = path.join(root, 'dist/BLACKROOT-web.zip');

try {
  await stat(SOURCE);
} catch {
  console.error('No dist/BLACKROOT.html — run `npm run build` first.');
  process.exit(1);
}

const html = await readFile(SOURCE, 'utf8');

// A host that serves the file over http gets the real document, shell and all.
// Only an *embedding* host that supplies its own document needs the stripped
// build, and that one is dist/BLACKROOT-hosted.html.
if (!/^<!doctype html>/i.test(html.trim())) {
  console.error('dist/BLACKROOT.html is not a complete document — build may be stale.');
  process.exit(1);
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'index.html'), html);

await rm(ZIP, { force: true });
await run('zip', ['-qj', ZIP, path.join(OUT_DIR, 'index.html')], { cwd: root });

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const zipped = await stat(ZIP);

console.log(`✓ dist/web/index.html          ${kb(Buffer.byteLength(html))}`);
console.log(`✓ dist/BLACKROOT-web.zip       ${kb(zipped.size)}`);
console.log('');
console.log('  itch.io      upload the zip, tick "played in the browser", viewport 1280×720');
console.log('  Netlify      drag dist/web onto app.netlify.com/drop');
console.log('  GitHub Pages commit index.html, then Settings → Pages');
