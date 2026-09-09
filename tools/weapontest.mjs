/**
 * Weapon / attachment / optic test.
 *
 * Verifies that every weapon builds with mount points, that attachments fit
 * and change the stats, that camo actually paints the model, and that a
 * magnified optic renders the world into its lens.
 *
 *   node tools/weapontest.mjs [--shots]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8512;
const SHOTS = process.argv.includes('--shots');
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok, d }); console.log(`${ok ? ' PASS' : ' FAIL'}  ${n}${d ? '   ' + d : ''}`); };

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
if (SHOTS) await mkdir(path.join(root, 'tools/shots'), { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error' && !/Deprecat|SwiftShader/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(220); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low'); S.set('renderScale', 0.12); S.set('viewDistance', 80);
  S.set('foliage', 0.3); S.set('shadows', 'off');
});
await page.evaluate(() => window.BLACKROOT.startNewGame(0x1234abcd));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 200000 });
await sleep(1500);

// ---- every weapon builds with mounts and geometry ----
const models = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const out = [];
  const ids = ['pistol9', 'revolver', 'shotgun', 'rifle', 'smg', 'carbine', 'knife', 'axe', 'machete'];
  const DB = await import('/scripts/systems/ItemDatabase.js');
  for (const id of ids) {
    g.inventory.add(id, 1);
    const def = DB.WEAPONS[id];
    if (def.ammo) g.inventory.add(def.ammo, 60);
    g.useItem(id);
    await new Promise((r) => setTimeout(r, 60));
    const m = g.weapons.model;
    let meshes = 0, tris = 0;
    m.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    out.push({
      id, equipped: g.weapons.currentId, meshes, tris: Math.round(tris),
      mounts: Object.keys(m.userData.mounts || {}).length,
      camoParts: (m.userData.camoParts || []).length,
      hasIron: !!m.userData.ironSight,
    });
  }
  return out;
});
for (const m of models) {
  const isGun = !['knife', 'axe', 'machete'].includes(m.id);
  check(`Model builds: ${m.id}`, m.meshes >= 8 && m.equipped === m.id,
    `${m.meshes} parts, ${m.tris} tris${isGun ? `, ${m.mounts} mounts` : ''}`);
}
check('Guns expose all seven attachment mounts', models.filter((m) => m.mounts === 7).length >= 6,
  `${models.filter((m) => m.mounts === 7).length} of 6 firearms`);
check('Guns have paintable surfaces for camo', models.every((m) => ['knife', 'axe', 'machete'].includes(m.id) || m.camoParts > 0));

// ---- attachments fit and change stats ----
const attach = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.useItem('carbine');
  await new Promise((r) => setTimeout(r, 250));
  const A = await import('/scripts/systems/Attachments.js');
  const out = { slots: [], stats: {} };
  const base = { ...g.weapons.current };
  for (const slot of A.SLOTS) {
    const ids = Object.keys(A.ATTACHMENTS[slot]);
    const pick = ids[ids.length - 1];      // the most extreme option in each slot
    g.weapons.setAttachment('carbine', slot, pick);
    await new Promise((r) => setTimeout(r, 60));
    out.slots.push({ slot, pick, fitted: !!g.weapons.attachmentObjects[slot] || pick === 'none' || pick === 'standard' || pick === 'iron' });
  }
  // a concrete, checkable stat change
  g.weapons.setAttachment('carbine', 'mag', 'drum');
  g.weapons.setAttachment('carbine', 'muzzle', 'suppressor');
  g.weapons.setAttachment('carbine', 'barrel', 'long');
  await new Promise((r) => setTimeout(r, 120));
  out.stats = {
    baseMag: base.mag, drumMag: g.weapons.current.mag,
    baseRange: base.range, longRange: Math.round(g.weapons.current.range),
    noiseMul: g.weapons.current.noiseMul,
  };
  return out;
});
check('Every attachment slot accepts a fitting', attach.slots.every((s) => s.fitted),
  attach.slots.filter((s) => !s.fitted).map((s) => s.slot).join(',') || 'all seven');
check('Drum magazine increases capacity', attach.stats.drumMag > attach.stats.baseMag,
  `${attach.stats.baseMag} -> ${attach.stats.drumMag}`);
check('Long barrel increases range', attach.stats.longRange > attach.stats.baseRange,
  `${attach.stats.baseRange} -> ${attach.stats.longRange} m`);
check('Suppressor reduces the noise the AI hears', attach.stats.noiseMul < 0.6,
  `noise ×${attach.stats.noiseMul.toFixed(2)}`);

// ---- optics ----
const optics = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const out = [];
  for (const optic of ['iron', 'reflex', 'holo', 'acog', 'sniper', 'thermal']) {
    g.weapons.setAttachment('carbine', 'optic', optic);
    await new Promise((r) => setTimeout(r, 90));
    const o = g.weapons.attachmentObjects.optic;
    const iron = g.weapons.model.userData.ironSight;
    out.push({
      optic,
      fitted: optic === 'iron' ? !o : !!o,
      ironVisible: iron ? iron.visible : null,
      zoom: g.weapons.current.zoom,
      magnified: !!g.weapons.current.magnified,
      hasGlass: !!(o && o.parts.glass),
      hasLens: !!(o && o.parts.lens),
      hasReticle: !!(o && o.parts.reticle),
      glassOpacity: o && o.parts.glass ? o.parts.glass.material.opacity : null,
    });
  }
  return out;
});
for (const o of optics) {
  check(`Optic fits: ${o.optic}`, o.fitted, `zoom ${o.zoom}×${o.magnified ? ', magnified' : ''}`);
}
check('Iron sights hide when an optic is mounted',
  optics.find((o) => o.optic === 'iron').ironVisible === true &&
  optics.filter((o) => o.optic !== 'iron').every((o) => o.ironVisible === false));
check('Red dot and holo glass is see-through',
  optics.filter((o) => ['reflex', 'holo'].includes(o.optic)).every((o) => o.hasGlass && o.glassOpacity < 0.25),
  `opacity ${optics.find((o) => o.optic === 'reflex').glassOpacity}`);
check('Every optic has a reticle', optics.filter((o) => o.optic !== 'iron').every((o) => o.hasReticle));
check('Magnified optics have a lens surface',
  optics.filter((o) => ['acog', 'sniper', 'thermal'].includes(o.optic)).every((o) => o.hasLens));

// ---- the scope actually renders the world ----
const scope = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.weapons.setAttachment('carbine', 'optic', 'sniper');
  await new Promise((r) => setTimeout(r, 150));
  const start = g.rafCount;
  const mainFov = g.camera.fov;
  g.input.setVirtualMouse(undefined, true);       // hold aim
  let active = false, lensVisible = false;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 40));
    if (g.weapons.scopeActive) active = true;
    const lens = g.weapons.attachmentObjects.optic.parts.lens;
    if (lens && lens.visible) lensVisible = true;
    if (active && lensVisible) break;
  }
  const fovWhileScoped = g.camera.fov;
  const rt = g.weapons.scopeRT;
  g.input.setVirtualMouse(undefined, false);
  return {
    active, lensVisible, mainFov, fovWhileScoped,
    rtSize: rt ? rt.width : 0,
    scopeFov: g.weapons.scopeCamera.fov,
    frames: g.rafCount - start,
  };
});
check('Scope renders the world into its lens', scope.active && scope.lensVisible,
  `render target ${scope.rtSize}px, scope FOV ${scope.scopeFov.toFixed(1)}°`);
check('Magnified optic does not zoom the whole screen',
  Math.abs(scope.fovWhileScoped - scope.mainFov) < 0.5,
  `main FOV ${scope.mainFov.toFixed(1)}° -> ${scope.fovWhileScoped.toFixed(1)}° (world outside the tube stays 1×)`);
check('Scope magnification is real', scope.scopeFov < scope.mainFov / 4,
  `${scope.scopeFov.toFixed(1)}° vs ${scope.mainFov.toFixed(1)}°`);

// ---- camo ----
const camo = await page.evaluate(async () => {
  const C = await import('/scripts/systems/CamoGenerator.js');
  const g = window.BLACKROOT;
  const seeds = [1, 12345, 0xDEADBEEF, 777777, 2 ** 31];
  const infos = seeds.map((s) => C.camoInfo(s >>> 0));
  const fams = new Set(infos.map((i) => i.family));
  g.weapons.setAttachment('carbine', 'optic', 'holo');
  g.weapons.setCamo('carbine', 0xDEADBEEF);
  await new Promise((r) => setTimeout(r, 400));
  const painted = g.weapons.model.userData.camoParts.filter((p) => p.material.map).length;
  const tex = g.weapons.model.userData.camoParts[0].material.map;
  // determinism: the same seed twice must produce identical pixels
  const a = C.camoSwatch(4242, 32), b = C.camoSwatch(4242, 32), c = C.camoSwatch(4243, 32);
  return {
    families: C.FAMILIES.length, palettes: C.PALETTES.length, space: C.CAMO_SPACE,
    distinctFamilies: fams.size, painted, texW: tex ? tex.image.width : 0,
    names: infos.map((i) => i.name), rarities: infos.map((i) => i.rarity.id),
    deterministic: a === b, distinct: a !== c,
  };
});
check('Camo generator has a large pattern space',
  camo.space >= 4294967296 && camo.families >= 18 && camo.palettes >= 18,
  `${camo.families} families × ${camo.palettes} palettes × ${camo.space.toLocaleString()} seeds`);
check('Camo is deterministic per seed', camo.deterministic);
check('Different seeds give different camo', camo.distinct);
check('Camo paints the weapon', camo.painted > 0 && camo.texW >= 256,
  `${camo.painted} surfaces, ${camo.texW}px texture`);
check('Camo names and rarities generate', camo.names.every((n) => n.length > 4) && camo.rarities.length === 5,
  camo.names.slice(0, 2).join(' / '));

if (SHOTS) {
  const shot = async (name, setup) => {
    await page.evaluate(setup);
    await page.evaluate(() => window.BLACKROOT.settings.set('renderScale', 1.0));
    await sleep(5500);
    await page.screenshot({ path: path.join(root, `tools/shots/wep-${name}.png`) });
    await page.evaluate(() => window.BLACKROOT.settings.set('renderScale', 0.12));
    console.log('  shot', name);
  };
  await shot('carbine', () => {
    const g = window.BLACKROOT;
    g.flashlight.on = true;
    g.weapons.setAttachment('carbine', 'optic', 'holo');
    g.weapons.setAttachment('carbine', 'muzzle', 'suppressor');
    g.weapons.setAttachment('carbine', 'grip', 'vertical');
    g.weapons.setAttachment('carbine', 'mag', 'drum');
    g.weapons.setCamo('carbine', 0xDEADBEEF);
    g.useItem('carbine');
  });
  await shot('sniper-ads', () => {
    const g = window.BLACKROOT;
    g.weapons.setAttachment('rifle', 'optic', 'sniper');
    g.weapons.setCamo('rifle', 991133);
    g.useItem('rifle');
    setTimeout(() => g.input.setVirtualMouse(undefined, true), 200);
    setTimeout(() => g.input.setVirtualMouse(undefined, false), 9000);
  });
  await shot('shotgun', () => {
    const g = window.BLACKROOT;
    g.weapons.setAttachment('shotgun', 'optic', 'reflex');
    g.weapons.setCamo('shotgun', 5150);
    g.useItem('shotgun');
  });
}

/* ---- swapping weapons never leaves the last one on screen ---- */
const swap = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const DB = await import('/scripts/systems/ItemDatabase.js');
  for (const id of ['rifle', 'pistol9', 'shotgun']) {
    g.inventory.add(id, 1);
    const d = DB.WEAPONS[id];
    if (d.ammo) g.inventory.add(d.ammo, 60);
  }
  const state = () => ({
    children: g.weapons.root.children.length,
    strays: g.weapons.root.children.filter((c) => c.visible && c !== g.weapons.model).length,
    currentVisible: !!(g.weapons.model && g.weapons.model.visible),
    overlay: g.weapons.scopeOverlay.visible,
  });
  // put a magnified scope up, then swap away from it while it is still up
  g.armoury.fitFor('rifle').optic = 'sniper';
  g.useItem('rifle');
  await new Promise((r) => setTimeout(r, 700));
  g.input.setVirtualMouse(false, true);
  await new Promise((r) => setTimeout(r, 1800));
  const scoped = { ads: +g.weapons.ads.toFixed(2), overlay: g.weapons.scopeOverlay.visible };
  g.useItem('pistol9');
  await new Promise((r) => setTimeout(r, 800));
  g.input.setVirtualMouse(false, false);
  await new Promise((r) => setTimeout(r, 900));
  const afterScope = state();
  // and back to the scoped weapon, to be sure it was not left invisible
  g.useItem('rifle');
  await new Promise((r) => setTimeout(r, 800));
  const backAgain = state();
  g.useItem('pistol9');
  await new Promise((r) => setTimeout(r, 500));
  return { scoped, afterScope, backAgain };
});
check('A magnified scope actually engages', swap.scoped.ads > 0.9 && swap.scoped.overlay,
  `ads ${swap.scoped.ads}, overlay up`);
check('Swapping away from a scope does not leave it frozen on screen',
  !swap.afterScope.overlay && swap.afterScope.strays === 0 && swap.afterScope.currentVisible,
  `${swap.afterScope.children} viewmodel(s), ${swap.afterScope.strays} stray, overlay ${swap.afterScope.overlay}`);
check('Swapping back to a scoped weapon draws it again',
  swap.backAgain.currentVisible && swap.backAgain.strays === 0,
  `visible ${swap.backAgain.currentVisible}`);

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log('\n' + '='.repeat(64));
console.log(`  ${results.length - failed.length}/${results.length} weapon checks passed`);
for (const f of failed) console.log(`   - ${f.n} ${f.d}`);
console.log('='.repeat(64));
process.exit(failed.length ? 1 : 0);
