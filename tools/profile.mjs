/** Where does the frame time go? Splits update vs render vs sub-systems. */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8124;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    await stat(f);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--no-sandbox', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(250); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });

for (const cfg of [
  { name: 'low  / rs 0.45 / vd 80', preset: 'low', rs: 0.45, vd: 80, fo: 0.3 },
  { name: 'low  / rs 0.20 / vd 60', preset: 'low', rs: 0.20, vd: 60, fo: 0.3 },
]) {
  await page.evaluate((c) => {
    const S = window.BLACKROOT.settings;
    S.applyPreset(c.preset);
    S.set('renderScale', c.rs); S.set('viewDistance', c.vd); S.set('foliage', c.fo);
    S.set('shadows', 'off');
  }, cfg);
  await page.evaluate(() => window.BLACKROOT.startNewGame(0x1234abcd));
  await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 });
  await sleep(1500);

  const r = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const S = {};
    const timed = (k, fn) => { const t = performance.now(); fn(); S[k] = (S[k] || 0) + (performance.now() - t); };
    let n = 0;
    const t0 = performance.now();
    // measure sub-system cost by calling them directly, outside the raf loop
    for (let i = 0; i < 30; i++) {
      n++;
      timed('player', () => g.player.update(0.016, false));
      timed('stats', () => g.stats.update(0.016, { thirstEnabled: true }));
      timed('flashlight', () => g.flashlight.update(0.016, g.player.eyePosition, g.player.forward, false));
      timed('weapons', () => g.weapons.update(0.016, false));
      timed('interact', () => g.interaction.update(0.016, true));
      timed('world', () => g.world.update(0.016, g.time, g.camera.position));
      timed('entities', () => g.entities.update(0.016, g.player.position, 80));
      timed('loot', () => g.loot.update(0.016, g.player.position));
      timed('director', () => g.director.update(0.016));
      timed('fx', () => g.fx.update(0.016));
      timed('ui', () => g.ui.updateHUD(0.016));
      timed('renderWorld', () => { g.renderer.clear(); g.renderer.render(g.scene, g.camera); });
      timed('renderView', () => { g.renderer.clearDepth(); g.renderer.render(g.viewScene, g.viewCamera); });
    }
    const total = performance.now() - t0;
    const per = {};
    for (const k of Object.keys(S)) per[k] = +(S[k] / n).toFixed(2);
    // count visible objects
    let meshes = 0, visMeshes = 0, inst = 0;
    g.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isPoints) {
        meshes++;
        let v = o.visible, p = o.parent;
        while (v && p) { v = p.visible; p = p.parent; }
        if (v) visMeshes++;
        if (o.isInstancedMesh) inst += o.count;
      }
    });
    return { per, totalPerFrame: +(total / n).toFixed(2), meshes, visMeshes, inst,
      calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
      progs: g.renderer.info.programs.length, geoms: g.renderer.info.memory.geometries,
      tex: g.renderer.info.memory.textures };
  });
  console.log('\n=== ' + cfg.name + ' ===');
  console.log('per-frame ms:', JSON.stringify(r.per));
  console.log(`total ${r.totalPerFrame} ms/frame  (${(1000 / r.totalPerFrame).toFixed(1)} fps ceiling)`);
  console.log(`meshes ${r.visMeshes}/${r.meshes} visible, ${r.inst} instances, geoms ${r.geoms}, tex ${r.tex}, programs ${r.progs}`);
}

await browser.close();
server.close();
