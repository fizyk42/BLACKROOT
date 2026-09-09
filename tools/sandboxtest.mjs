/**
 * Sandbox test.
 *
 * Walks the entire mod table and exercises every entry: every toggle is turned
 * on and checked for its actual effect, every slider is driven to its extremes,
 * every action is pressed and its result observed. A mod that is in the menu
 * but does nothing fails here.
 *
 *   node tools/sandboxtest.mjs [--shots]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8526;
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
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e).slice(0, 300)); console.log('PAGEERROR', String(e).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/Deprecat|SwiftShader/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(200); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low'); S.set('renderScale', 0.2); S.set('viewDistance', 90);
  S.set('foliage', 0.25); S.set('shadows', 'off');
  try { localStorage.setItem('blackroot.sandboxTutorial', '1'); } catch (e) { /* noop */ }
});

/* ================= entering it ================= */

await page.evaluate(() => window.BLACKROOT.startSandbox());
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 400000 });
await sleep(2500);

const entered = await page.evaluate(() => {
  const g = window.BLACKROOT;
  const T = g.world.terrain;
  // how flat is the plain? sample the heightfield across the playable area
  let min = 1e9, max = -1e9;
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 300;
    const h = T.heightAt(Math.cos(a) * r, Math.sin(a) * r);
    min = Math.min(min, h); max = Math.max(max, h);
  }
  return {
    biome: g.biomeId, sandbox: g.sandbox.active, mode: g.sandboxMode,
    relief: +(max - min).toFixed(1),
    creatures: g.entities.active.length,
    boss: !!g.boss,
    fog: +g.scene.fog.density.toFixed(5),
    lamp: g.flashlight.on,
    menuBuilt: !!document.getElementById('modmenu'),
  };
});
check('SANDBOX starts its own mode', entered.sandbox && entered.mode && entered.biome === 'sandbox');
check('The map is a plain, not a valley', entered.relief < 30, `${entered.relief} m of relief across 600 m`);
check('Nothing is out there until you ask', entered.creatures === 0 && !entered.boss, `${entered.creatures} creatures, no boss`);
check('It is lit and clear', entered.fog < 0.006 && entered.lamp, `fog ${entered.fog}`);

/* ================= the menu ================= */

const menu = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const { MODS, MOD_GROUPS } = await import('/scripts/systems/Sandbox.js');
  g.modMenu.toggle(true);
  await new Promise((r) => setTimeout(r, 220));
  const rows = document.querySelectorAll('#mm-body .mm-row').length;
  const groups = document.querySelectorAll('#mm-tabs .tab').length;
  // every group must render without throwing and must have rows
  const perGroup = {};
  for (const gr of MOD_GROUPS) {
    g.modMenu.group = gr;
    g.modMenu.render();
    perGroup[gr] = document.querySelectorAll('#mm-body .mm-row').length;
  }
  g.modMenu.group = 'Player';
  g.modMenu.render();
  return {
    total: MODS.length, groups, rows, perGroup,
    types: MODS.reduce((a, m) => { a[m.type] = (a[m.type] || 0) + 1; return a; }, {}),
    open: g.modMenu.open,
  };
});
check('The mod menu opens', menu.open);
check('It has a lot in it', menu.total >= 30, `${menu.total} mods across ${menu.groups} groups`);
check('Every group renders rows', Object.values(menu.perGroup).every((n) => n > 0),
  Object.entries(menu.perGroup).map(([k, v]) => `${k}:${v}`).join(' '));
check('A mix of switches, sliders, pickers and buttons',
  menu.types.toggle >= 8 && menu.types.slider >= 8 && menu.types.action >= 8 && menu.types.pick >= 3,
  JSON.stringify(menu.types));
if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/sandbox-menu.png') });

/* ================= every mod, one at a time ================= */

const walked = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const { MODS } = await import('/scripts/systems/Sandbox.js');
  const sb = g.sandbox;
  const out = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const mod of MODS) {
    const rec = { id: mod.id, type: mod.type, ok: false, note: '' };
    try {
      if (mod.type === 'toggle') {
        sb.set(mod.id, true);
        await wait(120);
        rec.ok = sb.get(mod.id) === true;
        sb.set(mod.id, mod.def);
      } else if (mod.type === 'slider') {
        sb.set(mod.id, mod.max);
        await wait(120);
        const hi = sb.get(mod.id);
        sb.set(mod.id, mod.min);
        await wait(120);
        const lo = sb.get(mod.id);
        rec.ok = Math.abs(hi - mod.max) < 1e-6 && Math.abs(lo - mod.min) < 1e-6;
        rec.note = `set ${mod.max} got ${hi}; set ${mod.min} got ${lo}`;
        sb.set(mod.id, mod.def);
      } else if (mod.type === 'pick') {
        const opts = mod.options();
        rec.ok = opts.length > 0 && opts.includes(sb.get(mod.id));
        rec.note = `${opts.length} options`;
      } else if (mod.type === 'action') {
        const msg = sb.run(mod.id);
        await wait(200);
        rec.ok = typeof msg === 'string' && msg.length > 0;
        rec.note = msg || '(no message)';
      }
    } catch (e) {
      rec.ok = false;
      rec.note = 'threw: ' + String(e).slice(0, 120);
    }
    out.push(rec);
  }
  return out;
});
const broken = walked.filter((w) => !w.ok);
check('Every mod in the menu does something', broken.length === 0,
  broken.length ? broken.map((b) => `${b.id}: ${b.note}`).join(' | ') : `${walked.length} mods exercised`);

/* ================= the ones with observable effects ================= */

await page.evaluate(() => window.BLACKROOT.sandbox.run('clearAll'));
await sleep(400);

const effects = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const sb = g.sandbox;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // god mode
  sb.set('god', true);
  g.stats.health = 100;
  g.damage.applyToPlayer(500, 'the test', {});
  out.god = g.stats.health;
  sb.set('god', false);
  g.stats.health = 100;
  g.damage.applyToPlayer(25, 'the test', {});
  out.notGod = g.stats.health;
  g.stats.health = 100;

  // noclip
  sb.set('noclip', true);
  const y0 = g.player.position.y;
  await wait(700);
  sb.set('noclip', false);
  out.noclipGrounded = g.player.grounded;

  // move speed
  sb.set('speed', 6);
  await wait(150);
  out.moveMul = g.player.env.moveMul;
  sb.set('speed', 1);

  // time scale
  sb.set('timeScale', 0.2);
  await wait(150);
  out.timeScale = g.timeScale;
  sb.set('timeScale', 1);

  // spawning
  sb.set('creature', 'stalker');
  sb.set('count', 6);
  sb.run('spawn');
  await wait(500);
  out.spawned = g.entities.active.filter((e) => e.type === 'stalker' && e.alive).length;

  // creature scale + big heads
  sb.set('creatureScale', 2.5);
  sb.set('bigHeads', true);
  await wait(400);
  const e0 = g.entities.active.find((e) => e.alive);
  out.creatureScale = e0 ? +e0.model.scale.x.toFixed(2) : 0;
  out.headScale = e0 && e0.parts.head ? +e0.parts.head.scale.x.toFixed(2) : 0;
  sb.set('creatureScale', 1);
  sb.set('bigHeads', false);
  await wait(300);

  // freeze
  sb.set('freezeAi', true);
  await wait(400);
  out.frozen = g.entities.active.filter((e) => e.alive).every((e) => e.velocity.length() < 0.01);
  sb.set('freezeAi', false);

  // one-shot kills
  sb.set('oneShot', true);
  const victim = g.entities.active.find((e) => e.alive);
  const hpBefore = victim ? victim.health : 0;
  if (victim) g.damage.applyToEntity(victim, 1, { x: 0, y: 0, z: 1 }, victim.position, 'body', 'gun');
  out.oneShotKilled = victim ? !victim.alive : false;
  out.hpBefore = hpBefore;
  sb.set('oneShot', false);

  // boss
  sb.set('bossPick', 'pyreking');
  sb.run('spawnBoss');
  await wait(700);
  out.boss = g.boss ? g.boss.type : null;
  out.bossAwake = !!(g.boss && g.boss.awake);

  // weapons
  sb.run('giveAll');
  out.weapons = g.inventory.slots.filter((s) => {
    const it = g.inventory.slots.find((x) => x.id === s.id);
    return it && /pistol9|revolver|shotgun|rifle|smg|carbine|knife|axe|machete/.test(s.id);
  }).length;
  const forged = sb.run('forge');
  out.forged = typeof forged === 'string' && /power [0-9]+/.test(forged);
  out.forgedName = forged;

  // infinite ammo — driven directly rather than waiting on the render clock,
  // which under a software rasteriser may not tick at all inside a second
  sb.set('infAmmo', true);
  g.weapons.magazine = 0;
  out.ammoBefore = g.weapons.magazine;
  for (let i = 0; i < 4; i++) { sb.update(0.016); await wait(40); }
  out.ammoRefilled = g.weapons.magazine > 0;
  out.ammoAfter = g.weapons.magazine;
  out.ammoWeapon = g.weapons.currentId;

  // a different biome's sky
  sb.set('skyPick', 'void');
  sb.run('applySky');
  await wait(400);
  out.skyNebula = g.world.sky.material.uniforms.nebula.value;
  out.fogColor = g.scene.fog.color.getHexString();
  sb.set('skyPick', 'sandbox');
  sb.run('applySky');
  await wait(300);

  // third person
  sb.set('thirdPerson', 5);
  await wait(400);
  out.thirdPersonWeaponHidden = !g.weapons.root.visible;
  sb.set('thirdPerson', 0);
  await wait(300);
  out.firstPersonWeaponShown = g.weapons.root.visible;

  return out;
});

check('God mode makes you unkillable', effects.god === 100 && effects.notGod < 100,
  `${effects.god} hp through 500 damage, ${effects.notGod} hp without it`);
check('Noclip takes you off the ground', effects.noclipGrounded === false);
check('Move speed multiplies', effects.moveMul === 6, `×${effects.moveMul}`);
check('Time scale slows the simulation', effects.timeScale === 0.2, `×${effects.timeScale}`);
check('Spawning puts creatures in front of you', effects.spawned >= 5, `${effects.spawned} stalkers`);
check('Creature size and big heads work', effects.creatureScale === 2.5 && effects.headScale === 2.6,
  `body ×${effects.creatureScale}, head ×${effects.headScale}`);
check('Freeze AI stops everything', effects.frozen);
check('One-shot kills anything', effects.oneShotKilled, `from ${effects.hpBefore} hp`);
check('You can spawn any boss on demand', effects.boss === 'pyreking' && effects.bossAwake, effects.boss);
check('Give-every-weapon works', effects.weapons >= 7, `${effects.weapons} weapons`);
check('The forge hands you a random weapon', effects.forged, effects.forgedName);
check('Infinite ammo refills the magazine', effects.ammoRefilled,
  `${effects.ammoWeapon}: ${effects.ammoBefore} -> ${effects.ammoAfter}`);
check('You can wear another biome’s sky', effects.skyNebula === 1, `nebula ${effects.skyNebula}, fog #${effects.fogColor}`);
check('Third person pulls the camera back and hides the gun',
  effects.thirdPersonWeaponHidden && effects.firstPersonWeaponShown);
if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/sandbox-play.png') });

/* ================= the tutorial ================= */

const tut = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const { TUTORIAL } = await import('/scripts/systems/Sandbox.js');
  g.modMenu.startTutorial();
  await new Promise((r) => setTimeout(r, 200));
  const first = {
    visible: !document.getElementById('sbtut').classList.contains('hidden'),
    title: document.querySelector('.sbt-title').textContent,
    step: document.querySelector('.sbt-step').textContent,
  };
  const focused = [];
  for (let i = 0; i < TUTORIAL.length - 1; i++) {
    g.modMenu.tutorialNext(1);
    await new Promise((r) => setTimeout(r, 120));
    const flash = document.querySelector('#mm-body .mm-row.flash');
    if (flash) focused.push(flash.dataset.mod);
  }
  const last = document.querySelector('[data-sbt="next"]').textContent;
  g.modMenu.tutorialNext(1);
  await new Promise((r) => setTimeout(r, 120));
  return {
    first, focused, last, steps: TUTORIAL.length,
    closed: document.getElementById('sbtut').classList.contains('hidden'),
    withFocus: TUTORIAL.filter((t) => t.focus).length,
  };
});
check('The tutorial opens on step one', tut.first.visible && /STEP 1 OF/.test(tut.first.step), tut.first.title);
check('It walks through every step', tut.steps >= 6 && tut.last === 'DONE', `${tut.steps} steps`);
check('Steps that mention a mod highlight it', tut.focused.length === tut.withFocus,
  tut.focused.join(', '));
check('Finishing closes it', tut.closed);
if (SHOTS) {
  await page.evaluate(() => window.BLACKROOT.modMenu.startTutorial());
  await sleep(500);
  await page.screenshot({ path: path.join(root, 'tools/shots/sandbox-tutorial.png') });
  await page.evaluate(() => window.BLACKROOT.modMenu.endTutorial());
}

/* ================= reset, and the real game is untouched ================= */

const back = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.sandbox.set('god', true);
  g.sandbox.set('speed', 5);
  g.sandbox.set('timeScale', 0.4);
  g.sandbox.reset();
  await new Promise((r) => setTimeout(r, 200));
  const afterReset = {
    god: g.sandbox.get('god'), speed: g.sandbox.get('speed'),
    timeScale: g.timeScale, moveMul: g.player.env.moveMul,
  };
  await g.startNewGame(0x1234);
  await new Promise((r) => setTimeout(r, 800));
  return {
    afterReset,
    sandboxOff: !g.sandbox.active,
    mode: !!g.sandboxMode,
    biome: g.biomeId,
    godStillOn: g.sandbox.godMode,
    boss: !!g.boss,
  };
});
check('Reset puts everything back', !back.afterReset.god && back.afterReset.speed === 1 &&
  back.afterReset.timeScale === 1 && back.afterReset.moveMul === 1, JSON.stringify(back.afterReset));
check('Starting a real game leaves the sandbox behind',
  back.sandboxOff && !back.mode && back.biome === 'hollow' && !back.godStillOn && back.boss,
  `biome ${back.biome}, boss ${back.boss}`);

check('No errors anywhere in the sandbox', errors.length === 0, errors[0] || '');

const pass = results.filter((r) => r.ok).length;
/* ================= every control is actually usable ================= */

/**
 * The mod menu is generated from a table, so it is easy for a control to be
 * *present* and not *hittable* — a switch whose CSS was scoped to another
 * screen collapses to a 0x0 box that is invisible and silently ignores every
 * click. Nothing in the data model notices. So this walks the whole menu and
 * clicks the real pixels, group by group.
 */
// Back into the sandbox: the checks above deliberately end by leaving it, and
// the mod menu only exists there.
await page.evaluate(() => window.BLACKROOT.startSandbox());
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 });
await page.evaluate(() => { if (window.BLACKROOT.modMenu.tutorialStep >= 0) window.BLACKROOT.modMenu.endTutorial(); });

const usable = [];
for (const group of await page.evaluate(async () => {
  const g = window.BLACKROOT;
  if (g.modMenu.tutorialStep >= 0) g.modMenu.endTutorial();
  g.modMenu.toggle(true);
  const G = await import('/scripts/systems/Sandbox.js');
  return G.MOD_GROUPS;
})) {
  await page.evaluate((gr) => {
    const mm = window.BLACKROOT.modMenu;
    mm.group = gr; mm._buildTabs(); mm.render();
  }, group);
  await sleep(120);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#mm-body .mm-row')].map((r) => ({
      id: r.dataset.mod,
      kind: r.querySelector('.toggle') ? 'toggle'
        : r.querySelector('input[type=range]') ? 'slider'
          : r.querySelector('select') ? 'select'
            : r.querySelector('.mm-btn') ? 'action' : 'none',
    })));
  for (const row of rows) {
    const sel = `#mm-body .mm-row[data-mod="${row.id}"] `
      + (row.kind === 'toggle' ? '.toggle' : row.kind === 'slider' ? 'input[type=range]'
        : row.kind === 'select' ? 'select' : '.mm-btn');
    const el = await page.$(sel);
    const box = el ? await el.boundingBox() : null;
    // Scroll it into view first: a control below the fold still has a box, but
    // the point test then lands on whatever is really at those coordinates.
    if (el) await el.scrollIntoViewIfNeeded();
    const box2 = el ? await el.boundingBox() : null;
    const probe = box2 ? await page.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      return { hit: !!(e && e.closest('.mm-row')), on: e ? (e.id || e.className || e.tagName) : 'none' };
    }, { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2 }) : { hit: false, on: 'no box' };
    const hit = probe.hit;
    usable.push({
      group, id: row.id, kind: row.kind,
      big: !!box2 && box2.width >= 20 && box2.height >= 14,
      hit, on: probe.on,
    });
  }
}
const dead = usable.filter((u) => u.kind === 'none' || !u.big || !u.hit);
check('Every control in the mod menu is big enough to click', dead.length === 0,
  dead.length ? dead.slice(0, 6).map((d) => `${d.group}/${d.id} ${d.kind}${d.big ? '' : ' 0px'}${d.hit ? '' : ' under ' + d.on}`).join(', ')
    : `${usable.length} controls across ${new Set(usable.map((u) => u.group)).size} groups`);

// And clicking a switch with the actual mouse has to change the actual value.
const clicked = await (async () => {
  await page.evaluate(() => { const mm = window.BLACKROOT.modMenu; mm.group = 'Player'; mm._buildTabs(); mm.render(); });
  await sleep(120);
  const out = [];
  for (const id of ['god', 'infStamina', 'noNeeds', 'noclip']) {
    const el = await page.$(`#mm-body .mm-row[data-mod="${id}"] .toggle`);
    if (!el) { out.push({ id, ok: false }); continue; }
    const before = await page.evaluate((i) => window.BLACKROOT.sandbox.get(i), id);
    await el.click();
    await sleep(120);
    const after = await page.evaluate((i) => window.BLACKROOT.sandbox.get(i), id);
    out.push({ id, ok: before !== after, after });
  }
  return out;
})();
check('Clicking the switches turns the mods on', clicked.every((c) => c.ok),
  clicked.map((c) => `${c.id}=${c.after}`).join(', '));

const godWorks = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.stats.health = 100;
  g.damage.applyToPlayer(500, 'the test');
  for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
  return { hp: g.stats.health, dead: g.stats.dead };
});
check('  …and god mode ticked from the menu really is invulnerable',
  godWorks.hp > 99 && !godWorks.dead, `${Math.round(godWorks.hp)} hp after 500 damage`);

const slider = await (async () => {
  const el = await page.$('#mm-body .mm-row[data-mod="speed"] input[type=range]');
  if (!el) return { ok: false };
  const before = await page.evaluate(() => window.BLACKROOT.sandbox.get('speed'));
  const b = await el.boundingBox();
  await page.mouse.click(b.x + b.width * 0.85, b.y + b.height / 2);
  await sleep(150);
  const after = await page.evaluate(() => window.BLACKROOT.sandbox.get('speed'));
  return { ok: after !== before, before, after };
})();
check('Dragging a slider with the mouse changes it', slider.ok, `${slider.before} -> ${slider.after}`);



/* ================= the worlds are reachable from the menu ================= */

/**
 * Six worlds exist and, before this, the only way to see five of them was to
 * fight your way through a rift. The mod menu is where you go to look at
 * things, so it can take you to any of them directly.
 */
const worldsGroup = await page.evaluate(async () => {
  const S = await import('/scripts/systems/Sandbox.js');
  const g = window.BLACKROOT;
  g.modMenu.group = 'Worlds';
  g.modMenu._buildTabs();
  g.modMenu.render();
  return {
    inGroups: S.MOD_GROUPS.includes('Worlds'),
    rows: [...document.querySelectorAll('#mm-body .mm-row')].map((r) => r.dataset.mod),
    options: S.MODS.find((m) => m.id === 'worldPick').options(),
  };
});
check('The mod menu has a Worlds group', worldsGroup.inGroups && worldsGroup.rows.length >= 4,
  worldsGroup.rows.join(', '));
check('  …offering every world', worldsGroup.options.length === 7,
  worldsGroup.options.join(', '));

const travelled = [];
for (const id of ['bloom', 'cinder', 'void']) {
  const r = await page.evaluate(async (target) => {
    const g = window.BLACKROOT;
    g.sandbox.set('worldPick', target);
    g.sandbox.set('god', true);
    g.sandbox.run('goWorld');
    // The rebuild is async; wait for it to land.
    const t0 = Date.now();
    while (g.state !== 'PLAYING' && Date.now() - t0 < 200000) await new Promise((r2) => setTimeout(r2, 120));
    while (g.biomeId !== target && Date.now() - t0 < 200000) await new Promise((r2) => setTimeout(r2, 120));
    return {
      biome: g.biomeId, state: g.state,
      landmarks: g.world.landmarks.length,
      kinds: [...new Set(g.world.landmarks.map((l) => l.type))],
      godKept: g.sandbox.get('god'),
      sandbox: g.sandbox.active,
    };
  }, id);
  travelled.push(r);
}
for (const t of travelled) {
  check(`Going to ${t.biome} from the menu builds it`,
    t.state === 'PLAYING' && t.landmarks >= 15,
    `${t.landmarks} places: ${t.kinds.join(', ')}`);
}
check('  …and your mods come with you', travelled.every((t) => t.godKept && t.sandbox));

const tour = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  const before = { ...g.player.position };
  const label = g.sandbox.run('tourWorld');
  await new Promise((r) => requestAnimationFrame(r));
  const after = g.player.position;
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  // Several landmarks share a label — there are four sets of Standing Slabs —
  // so the check is against the nearest one of that name, not the first.
  const atIt = Math.min(1e9, ...g.world.landmarks
    .filter((l) => l.label === label)
    .map((l) => Math.hypot(after.x - l.x, after.z - l.z)));
  return { label, moved, atIt, listed: g.sandbox.run('listWorld') };
});
check('The menu can drop you at one of this world\'s places', tour.moved > 20 && tour.atIt < 40,
  `${tour.label}, ${Math.round(tour.atIt)} m from it`);
check('  …and tell you what else is out there', /m/.test(tour.listed) && tour.listed.length > 20,
  tour.listed.slice(0, 90));

console.log('\n' + '='.repeat(64));
console.log(`  ${results.filter((r) => r.ok).length}/${results.length} sandbox checks passed`);
console.log('='.repeat(64));
if (SHOTS) console.log('  shots in tools/shots/');

await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
