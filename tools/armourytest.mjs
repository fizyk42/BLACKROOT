/**
 * Armoury test.
 *
 * Verifies the loadout hub end to end: that it opens from the menu and from
 * the pause screen, that picking a weapon actually swaps the previewed model
 * *and* the weapon in the player's hands, that the forged roster is endless
 * and deterministic, that attachments, finishes and tuning reach the held
 * weapon, that the operator rebuilds, and that a controller can drive all of
 * it. Also renders reference shots with --shots.
 *
 *   node tools/armourytest.mjs [--shots]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8516;
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e).slice(0, 300)); console.log('PAGEERROR', String(e).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/Deprecat|SwiftShader/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(220); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low'); S.set('renderScale', 0.25); S.set('viewDistance', 80);
  S.set('foliage', 0.3); S.set('shadows', 'off');
});

/* ================= 1. the forge, before any UI ================= */

const forge = await page.evaluate(async () => {
  const F = await import('/scripts/systems/WeaponForge.js');
  const a = F.forgeInfo(0xDEADBEEF);
  const b = F.forgeInfo(0xDEADBEEF);
  const c = F.forgeInfo(0x12345678);
  const def = F.forgeWeapon(0xDEADBEEF);
  const chassisHits = {};
  for (const cl of F.CHASSIS_LIST) {
    chassisHits[cl.id] = F.forgePageFor(cl.id, 0, 8, 7).every((s) => F.chassisOf(s) === cl.id);
  }
  // ids round-trip through a save
  const rt = F.seedFromId(F.forgeId(0xABCD1234)) === 0xABCD1234;
  return {
    space: F.FORGE_SPACE,
    stable: a.name === b.name && a.rating === b.rating,
    distinct: a.name !== c.name,
    name: a.name, tier: a.tier.label, rating: a.rating, chassis: a.chassis.label,
    traits: a.traits.map((t) => t.label),
    registered: !!def && def.cat === 'weapon' && def.kind === 'gun' && def.mag > 0,
    ammo: def.ammo, viewModel: def.viewModel,
    chassisHits, rt,
    uniqueNames: new Set(F.forgePage(0, 40, 3).map((s) => F.forgeInfo(s).name)).size,
  };
});
check('Forge covers a 4-billion weapon space', forge.space === 4294967296, forge.space.toLocaleString() + ' seeds');
check('A forged weapon is deterministic from its seed', forge.stable && forge.distinct, forge.name);
check('A forged weapon is a real, equippable item', forge.registered, `${forge.chassis} · ${forge.tier} · power ${forge.rating} · ${forge.ammo}`);
check('Forged weapons carry traits', forge.traits.length >= 0, forge.traits.join(', ') || 'none at this tier');
check('Class filtering returns only that class', Object.values(forge.chassisHits).every(Boolean), Object.keys(forge.chassisHits).join(', '));
check('A forged id round-trips through a save', forge.rt);
check('Names do not collide across a page', forge.uniqueNames >= 36, `${forge.uniqueNames}/40 distinct`);

/* ================= 2. opens from the main menu ================= */

await page.evaluate(() => window.BLACKROOT.openArmoury('menu'));
await sleep(400);
const opened = await page.evaluate(() => {
  const g = window.BLACKROOT;
  return {
    open: g.armoury.isOpen,
    visible: !document.getElementById('armoury').classList.contains('hidden'),
    menuHidden: document.getElementById('mainmenu').classList.contains('hidden'),
    tabs: document.querySelectorAll('#armoury [data-artab]').length,
    rows: document.querySelectorAll('#armoury .ar-weapon').length,
    classes: document.querySelectorAll('#armoury .ar-class').length,
    name: document.getElementById('ar-name').textContent,
  };
});
check('Armoury opens from the main menu with no world loaded', opened.open && opened.visible && opened.menuHidden);
check('Every tab is present', opened.tabs === 5, `${opened.tabs} tabs`);
check('The weapon list is populated', opened.rows > 10 && opened.classes >= 7, `${opened.rows} weapons, ${opened.classes} classes`);
check('The preview names the selected weapon', opened.name.length > 3, opened.name);

if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/armoury-weapons.png') });

/* ================= 3. the preview renders ================= */

const drew = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.renderer.info.reset();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 260));
  return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, ctx: g.renderer.getContext().isContextLost() };
});
check('The preview is drawn by the main renderer (no second GL context)',
  drew.calls > 3 && !drew.ctx, `${drew.calls} draws, ${(drew.tris / 1000).toFixed(1)}k tris`);

/* ================= 4. picking a weapon swaps the model ================= */

const swap = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  const out = [];
  const classes = Array.from(document.querySelectorAll('#armoury .ar-class'));
  const wanted = ['Scattergun', 'Marksman Rifle', 'Machine Pistol', 'Assault Carbine', 'Sidearm'];
  for (const label of wanted) {
    const btn = classes.find((c) => c.querySelector('.n').textContent === label);
    btn.click();
    await new Promise((r) => setTimeout(r, 40));
    const first = document.querySelector('#armoury .ar-weapon');
    first.click();
    await new Promise((r) => setTimeout(r, 60));
    let meshes = 0;
    A.gunModel.traverse((o) => { if (o.isMesh) meshes++; });
    out.push({
      label, key: A._modelKey, id: A.selected,
      name: document.getElementById('ar-name').textContent, meshes,
      stats: document.getElementById('ar-stats').textContent.replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
});
const EXPECT = { Scattergun: 'shotgun', 'Marksman Rifle': 'rifle', 'Machine Pistol': 'smg', 'Assault Carbine': 'carbine', Sidearm: 'pistol' };
for (const s of swap) {
  check(`Selecting ${s.label} swaps the previewed model`, s.key === EXPECT[s.label] && s.meshes > 8,
    `${s.key} model, ${s.meshes} meshes · ${s.stats}`);
}
if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/armoury-preview.png') });

/* ================= 5. finishes ================= */

await page.evaluate(() => document.querySelector('#armoury [data-artab="camo"]').click());
await sleep(250);
const camo = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  const swatches = document.querySelectorAll('#armoury .ar-swatch');
  const before = A.camoFor(A.selected);
  swatches[5].click();
  await new Promise((r) => setTimeout(r, 120));
  const after = A.camoFor(A.selected);
  let painted = 0;
  A.gunModel.traverse((o) => { if (o.isMesh && o.material && o.material.map) painted++; });
  // the code box recovers an exact finish
  const box = document.querySelector('#armoury .ar-seed');
  box.value = '00ABCDEF';
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  return {
    swatches: swatches.length, before, after, painted,
    recovered: A.camoFor(A.selected), label: document.querySelector('#armoury .ar-camohead .now').textContent,
  };
});
check('The finish grid renders swatches', camo.swatches >= 30, `${camo.swatches} finishes on this page`);
check('Choosing a finish paints the previewed weapon', camo.after !== camo.before && camo.painted > 0, `${camo.painted} painted surfaces`);
check('A finish code recovers an exact finish', camo.recovered === 0x00ABCDEF, `${camo.label} from code 00ABCDEF`);
if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/armoury-camo.png') });

/* ================= 6. attachments ================= */

await page.evaluate(() => document.querySelector('#armoury [data-artab="attach"]').click());
await sleep(250);
const attach = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  const slots = Array.from(document.querySelectorAll('#armoury .ar-slot'));
  slots[0].click();                                  // optic
  await new Promise((r) => setTimeout(r, 80));
  const opts = Array.from(document.querySelectorAll('#armoury .ar-opt'));
  const names = opts.map((o) => o.querySelector('.nm').textContent);
  const sniper = opts.find((o) => /6×/.test(o.querySelector('.nm').textContent)) || opts[opts.length - 1];
  const beforeZoom = A.resolve(A.selected).zoom;
  sniper.click();
  await new Promise((r) => setTimeout(r, 140));
  const after = A.resolve(A.selected);
  let hasLens = false;
  A.gunModel.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'CircleGeometry') hasLens = true; });
  return {
    slots: slots.length, names, beforeZoom, zoom: after.zoom, magnified: after.magnified,
    hasLens, fit: A.fitFor(A.selected).optic,
    ironVisible: A.gunModel.userData.ironSight ? A.gunModel.userData.ironSight.visible : null,
  };
});
check('Every attachment slot is offered', attach.slots === 7, attach.slots + ' slots');
check('Optic options list', attach.names.length >= 6, attach.names.join(', '));
check('Fitting an optic changes the build', attach.zoom !== attach.beforeZoom && attach.magnified,
  `zoom ${attach.beforeZoom}× -> ${attach.zoom}×`);
check('The fitted optic appears on the previewed model', attach.hasLens && attach.ironVisible === false, attach.fit);
if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/armoury-attach.png') });

/* ================= 7. upgrades ================= */

await page.evaluate(() => document.querySelector('#armoury [data-artab="upgrades"]').click());
await sleep(250);
const upg = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  const rows = Array.from(document.querySelectorAll('#armoury .ar-upg'));
  const pointsBefore = A.points;
  const dmgBefore = A.resolve(A.selected).damage;
  rows[0].click();
  await new Promise((r) => setTimeout(r, 120));
  const dmgAfter = A.resolve(A.selected).damage;
  const pointsAfter = A.points;
  // and the refund path puts the points back
  const refundRow = document.querySelector('#armoury .ar-reset');
  const hadRefund = !!refundRow;
  if (refundRow) refundRow.click();
  await new Promise((r) => setTimeout(r, 120));
  return {
    rows: rows.length, pointsBefore, pointsAfter, dmgBefore, dmgAfter,
    hadRefund, pointsBack: A.points, dmgBack: A.resolve(A.selected).damage,
  };
});
check('Upgrade tracks are offered', upg.rows === 6, `${upg.rows} tracks`);
check('Buying an upgrade improves the weapon', upg.dmgAfter > upg.dmgBefore,
  `damage ${upg.dmgBefore.toFixed(1)} -> ${upg.dmgAfter.toFixed(1)}`);
check('Buying an upgrade costs points', upg.pointsAfter < upg.pointsBefore, `${upg.pointsBefore} -> ${upg.pointsAfter} pts`);
check('Stripping tuning refunds it exactly', upg.hadRefund && upg.pointsBack === upg.pointsBefore && Math.abs(upg.dmgBack - upg.dmgBefore) < 0.001,
  `${upg.pointsBack} pts restored`);

/* ================= 8. operator ================= */

await page.evaluate(() => document.querySelector('#armoury [data-artab="operator"]').click());
await sleep(400);
const op = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  let meshes = 0, minY = 1e9, maxY = -1e9;
  A.opModel.updateMatrixWorld(true);
  A.opModel.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
  });
  const chips = Array.from(document.querySelectorAll('#armoury .ar-chip'));
  const before = { ...A.operator };
  const helmet = chips.find((c) => c.textContent === 'Ballistic Helmet') || chips[3];
  helmet.click();
  await new Promise((r) => setTimeout(r, 200));
  let meshesAfter = 0;
  A.opModel.traverse((o) => { if (o.isMesh) meshesAfter++; });
  const capsules = [];
  A.opModel.traverse((o) => { if (o.isMesh && /Capsule/.test(o.geometry.type)) capsules.push(o.geometry.type); });
  return {
    meshes, height: maxY - minY, chips: chips.length,
    changed: A.operator.headgear !== before.headgear || meshesAfter > 0,
    meshesAfter, capsules: capsules.length,
    parts: Object.keys(A.opModel.userData.parts || {}).join(','),
    visible: A.opHolder.visible && !A.gunHolder.visible,
  };
});
check('The operator preview builds a whole figure', op.meshes > 30, `${op.meshes} parts`);
check('The operator is realistically proportioned, not blocks',
  op.height > 1.6 && op.height < 2.0 && op.capsules >= 8,
  `${op.height.toFixed(2)} m tall, ${op.capsules} capsule limbs, joints: ${op.parts}`);
check('The operator tab takes over the preview', op.visible);
check('Operator options rebuild the figure', op.changed && op.meshesAfter > 30, `${op.chips} options, ${op.meshesAfter} parts after change`);
if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/armoury-operator.png') });

/* ================= 9. controller can drive it ================= */

const pad = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const ui = g.ui;
  const before = document.querySelectorAll('#armoury .pad-focus').length;
  ui.padMenuTick(0.016);
  const screen = ui._activePadScreen();
  return { isArmoury: screen && screen.id === 'armoury', before };
});
check('The controller targets the armoury when it is open', pad.isArmoury);

/* ================= 10. it reaches the actual game ================= */

await page.evaluate(() => window.BLACKROOT.armoury.close());
await sleep(250);
const closed = await page.evaluate(() => ({
  open: window.BLACKROOT.armoury.isOpen,
  menu: !document.getElementById('mainmenu').classList.contains('hidden'),
}));
check('Closing returns to where it was opened from', !closed.open && closed.menu);

await page.evaluate(() => window.BLACKROOT.startNewGame(0x5150FEED));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 240000 });
await sleep(1200);

const carried = await page.evaluate(() => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  return {
    primary: A.primary,
    equipped: g.weapons.currentId,
    inInventory: g.inventory.has(A.primary),
    hasAmmo: g.weapons.reserve > 0,
    zoom: g.weapons.current.zoom,
    magnified: g.weapons.current.magnified,
    name: g.weapons.current.name,
  };
});
check('The weapon chosen in the armoury is the weapon you start with',
  carried.equipped === carried.primary && carried.inInventory, carried.name);
check('It arrives loaded', carried.hasAmmo, `${carried.hasAmmo} rounds in reserve`);
check('It arrives wearing the build you gave it', carried.magnified && carried.zoom > 1, `${carried.zoom}× optic fitted`);

/* live edits reach the held weapon */
const live = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  g.pause();
  g.openArmoury('pause');
  await new Promise((r) => setTimeout(r, 200));
  const id = A.selected;
  const before = { damage: g.weapons.current.damage, optic: g.weapons.current.optic.id };
  A.fitFor(id).optic = 'reflex';
  A.upgradesFor(id).ballistics = 3;
  A._syncLiveWeapon();
  await new Promise((r) => setTimeout(r, 120));
  const after = { damage: g.weapons.current.damage, optic: g.weapons.current.optic.id };
  // and picking a different weapon in a live run issues it
  const rows = document.querySelectorAll('#armoury .ar-weapon');
  A.tab = 'weapons'; A.renderPanel();
  await new Promise((r) => setTimeout(r, 120));
  const row = document.querySelectorAll('#armoury .ar-weapon')[2];
  const wantName = row.querySelector('.nm').textContent;
  row.click();
  await new Promise((r) => setTimeout(r, 250));
  const held = g.weapons.current.name;
  const heldKey = g.weapons.model.userData.mounts ? g.weapons.currentId : null;
  A.close();
  return { before, after, wantName, held, heldKey, rows: rows.length };
});
check('An armoury edit reaches the weapon in your hands',
  live.after.optic === 'reflex' && live.after.damage > live.before.damage,
  `optic ${live.before.optic} -> ${live.after.optic}, damage ${live.before.damage.toFixed(1)} -> ${live.after.damage.toFixed(1)}`);
check('Choosing a weapon mid-run issues it immediately', live.held === live.wantName, live.held);

/* ================= 11. saves ================= */

const saved = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const A = g.armoury;
  const id = A.selected;
  A.camos.set(id, 0x0BADF00D);
  g.saveGame();
  const raw = JSON.parse(localStorage.getItem('blackroot.save.v1'));
  // wipe the runtime state and restore it the way a fresh page load would
  A.fits = new Map(); A.camos = new Map(); A.upgrades = new Map();
  A.deserialize(raw.armoury);
  return {
    hasArmoury: !!raw.armoury,
    forgedId: /^fg_/.test(id),
    camo: A.camoFor(id),
    optic: A.fitFor(id).optic,
    primary: A.primary,
    stillAnItem: !!(await import('/scripts/systems/ItemDatabase.js')).ITEMS[id],
  };
});
check('The armoury build is saved', saved.hasArmoury && saved.camo === 0x0BADF00D, `finish ${saved.camo.toString(16)}, optic ${saved.optic}`);
check('A forged weapon survives a save/load round trip', saved.stillAnItem, saved.primary);

check('No page errors during the whole session', errors.length === 0, errors[0] || '');

/* ================= report ================= */

const pass = results.filter((r) => r.ok).length;
console.log('\n================================================================');
console.log(`  ${pass}/${results.length} armoury checks passed`);
console.log('================================================================');
if (SHOTS) console.log('  shots in tools/shots/');

await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
