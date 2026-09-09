/**
 * Ghost-gun test — does the previous run's weapon follow you into the next one?
 *
 * The world scene is thrown away and rebuilt between runs; the *view* scene is
 * not, because it holds the viewmodel light rig for the whole session. Any
 * per-run system that adds to it and never removes itself therefore leaves its
 * object behind, drawn in front of everything, forever. That is exactly what
 * happened to the weapon: die, restart, and the old gun was still there in
 * whatever pose it died in, next to the new one.
 *
 * The assertion is a count, because the symptom is a count: however many runs
 * you play, there is exactly one weapon root in the view scene.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8549;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let pass = 0, fail = 0; const failures = [];
const check = (l, ok, d = '') => {
  if (ok) { pass++; console.log(` PASS  ${l}${d ? '   ' + d : ''}`); }
  else { fail++; failures.push(l); console.log(` FAIL  ${l}${d ? '   ' + d : ''}`); }
};

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

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 420 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state === "MENU"', null, { timeout: 45000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low'); S.set('renderScale', 0.14); S.set('viewDistance', 60);
  S.set('foliage', 0.14); S.set('shadows', 'off');
});

/** What is actually sitting in the view scene, by kind. */
const census = () => page.evaluate(() => {
  const g = window.BLACKROOT;
  let lights = 0, groups = 0, meshes = 0, visibleMeshes = 0;
  const roots = [];
  for (const o of g.viewScene.children) {
    if (o.isLight) { lights++; continue; }
    groups++;
    // Three objects legitimately live here: the weapon, the scope overlay and
    // the muzzle-flash sprite. Anything else is a survivor from a past run.
    roots.push(o.type + (o === g.weapons?.root ? ':current'
      : o === g.weapons?.scopeOverlay ? ':scope'
      : o === g.fx?.flashSprite ? ':flash' : ':STRAY'));
    o.traverse((c) => { if (c.isMesh) { meshes++; if (c.visible) visibleMeshes++; } });
  }
  return { lights, groups, meshes, visibleMeshes, roots, weapon: g.weapons?.currentId || null };
});

const start = (seed) => page.evaluate((s) => window.BLACKROOT.startNewGame(s), seed)
  .then(() => page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 }))
  .then(() => page.evaluate(() => { window.BLACKROOT.director.calmPeriod = 600; }));

await start(0xC0FFEE);
const one = await census();
check('One run puts one weapon in the view scene', one.groups === 3, `${one.groups} objects: ${one.roots.join(', ')}`);
const baseMeshes = one.meshes;

// Carry a distinctive weapon so a survivor would be unmistakable.
await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.inventory.add('shotgun12', 1);
  g.weapons.equip('shotgun12');
  for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
});
const armed = await census();
check('  …and swapping weapons does not add another', armed.groups === 3, `${armed.groups} objects, ${armed.meshes} meshes`);

/* --- die, then restart --- */
await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.stats.health = 0; g.stats.dead = true; g.stats.causeOfDeath = 'the test';
  for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
});
await page.waitForFunction('window.BLACKROOT.state === "DEAD"', null, { timeout: 20000 });
await page.evaluate(() => window.BLACKROOT.restart());
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 });

const after = await census();
check('Dying and restarting leaves exactly one weapon', after.groups === 3,
  `${after.groups} objects: ${after.roots.join(', ')}`);
check('  …and no ghost geometry from the last run', after.meshes <= baseMeshes + 4,
  `${baseMeshes} meshes before, ${after.meshes} after`);
check('  …and the gun in your hands is the new run\'s', after.weapon === 'pistol9', String(after.weapon));

/* --- three more runs: a leak compounds, so it shows up here even if it hid above --- */
for (let i = 0; i < 3; i++) {
  await start(1000 + i);
}
const many = await census();
check('Five runs still leave exactly one weapon', many.groups === 3,
  `${many.groups} objects: ${many.roots.join(', ')}`);
check('  …with the mesh count flat, not growing', many.meshes <= baseMeshes + 4,
  `${baseMeshes} -> ${many.meshes} meshes`);
check('  …and nothing stray in the view scene', !many.roots.some((r) => r.endsWith(':STRAY')), many.roots.join(', '));

/* --- and through a rift, which rebuilds the world without a death --- */
await page.evaluate(() => { window.BLACKROOT.riftOpen = true; return window.BLACKROOT.enterRift(); });
await page.waitForFunction('window.BLACKROOT.state === "PLAYING" && window.BLACKROOT.depth === 1', null, { timeout: 180000 });
const rift = await census();
check('Stepping through a rift does not leave one behind', rift.groups === 3,
  `${rift.groups} objects: ${rift.roots.join(', ')}`);
check('  …and the weapon still works after it', rift.weapon !== null, String(rift.weapon));

const fires = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const before = g.stats.shotsFired;
  g.input.setVirtualMouse(true);
  for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
  g.input.setVirtualMouse(false);
  return g.stats.shotsFired - before;
});
check('  …and still fires', fires > 0, `${fires} shot(s)`);
check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log('\n================================================================');
console.log(`  ${pass}/${pass + fail} viewmodel checks passed`);
if (fail) { console.log('  FAILURES:'); for (const f of failures) console.log('   · ' + f); }
console.log('================================================================');
process.exit(fail ? 1 : 0);
