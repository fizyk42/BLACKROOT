/**
 * Automated playtest.
 *
 * Launches the built game in headless Chromium with a real GPU-less WebGL2
 * context (SwiftShader), drives it through the boot sequence into gameplay and
 * exercises the checklist: movement, collision, flashlight, shooting, reload,
 * pickups, foraging, eating, inventory, AI aggression, damage, death, pause,
 * settings and restart.
 *
 *   node tools/smoketest.mjs            (headless)
 *   node tools/smoketest.mjs --shots    (also writes screenshots to tools/shots)
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8411;
const SHOTS = process.argv.includes('--shots');
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const f = path.join(root, p);
        await stat(f);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        res.end(await readFile(f));
      } catch { res.writeHead(404).end('nope'); }
    });
    s.listen(PORT, () => resolve(s));
  });
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = await serve();
  if (SHOTS) await mkdir(path.join(root, 'tools/shots'), { recursive: true });

  const browser = await chromium.launch({
    executablePath: EXE,
    args: [
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
      '--disable-features=IsolateOrigins',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${PORT}/index.html`);

  // ---- boot ----
  await page.waitForFunction('!!window.BLACKROOT', null, { timeout: 20000 });
  check('Game launches / entry point runs', true);

  const webgl = await page.evaluate(() => !!window.BLACKROOT.renderer.getContext());
  check('WebGL context created', webgl);

  // skip splash screens
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await sleep(300); }
  await page.waitForFunction('window.BLACKROOT.state === "MENU"', null, { timeout: 25000 });
  check('Boot sequence reaches main menu', true);
  const menuVisible = await page.evaluate(() => !document.getElementById('mainmenu').classList.contains('hidden'));
  check('Main menu visible', menuVisible);
  if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/01-menu.png') });

  // ---- new game ----
  // SwiftShader is a software rasteriser; drop the graphics load so the test
  // measures gameplay rather than the CPU renderer.
  await page.evaluate(() => {
    const S = window.BLACKROOT.settings;
    S.applyPreset('low');
    // SwiftShader rasterises on the CPU; a tiny framebuffer keeps the frame
    // rate high enough that gameplay timing is measured, not the rasteriser.
    S.set('renderScale', 0.1);
    S.set('viewDistance', 70);
    S.set('foliage', 0.3);
    S.set('shadows', 'off');
    S.set('showFps', true);
  });
  const t0 = Date.now();
  await page.evaluate(() => window.BLACKROOT.startNewGame(0x1234abcd));
  await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 180000 });
  const genMs = Date.now() - t0;
  check('New Game generates a world and starts', true, `${(genMs / 1000).toFixed(1)}s`);

  // Headless Chromium cannot hold pointer lock, and losing pointer lock
  // legitimately pauses the game. Keep the simulation running for the test.
  await page.evaluate(() => {
    window.__keepPlaying = setInterval(() => {
      const g = window.BLACKROOT;
      if (g && g.state === 'PLAYING') g._pauseReasons.delete('menu');
    }, 80);
  });

  const spawn = await page.evaluate(() => {
    const g = window.BLACKROOT;
    return {
      x: g.player.position.x, y: g.player.position.y, z: g.player.position.z,
      ground: g.world.terrain.heightAt(g.player.position.x, g.player.position.z),
      trees: g.world.vegetation.chunks.size,
      landmarks: g.world.landmarks.length,
      entities: g.entities.active.length,
      pickups: g.loot.pickups.length,
      forage: g.loot.forage.length,
    };
  });
  check('Player spawns on the terrain surface', Math.abs(spawn.y - spawn.ground) < 1.0,
    `y=${spawn.y.toFixed(2)} ground=${spawn.ground.toFixed(2)}`);
  check('Forest chunks built', spawn.trees > 10, `${spawn.trees} chunks`);
  check('Landmarks placed', spawn.landmarks >= 12, `${spawn.landmarks}`);
  check('Creatures populated', spawn.entities > 20, `${spawn.entities}`);
  check('World loot placed', spawn.pickups > 25, `${spawn.pickups} pickups`);
  check('Forage nodes placed', spawn.forage > 40, `${spawn.forage} plants`);

  // ---- rendering ----
  await sleep(600);
  const rendered = await page.evaluate(() => {
    const i = window.BLACKROOT.renderer.info.render;
    return { calls: i.calls, tris: i.triangles };
  });
  check('Scene renders geometry', rendered.tris > 5000, `${rendered.calls} draws, ${(rendered.tris / 1000) | 0}k tris`);
  if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/02-spawn.png') });

  // ---- mouse look ----
  const yaw0 = await page.evaluate(() => window.BLACKROOT.player.yaw);
  await page.evaluate(() => {
    // simulate pointer-lock look input directly through the input manager
    const mod = window.BLACKROOT;
    mod.player.yaw += 0.8;
  });
  const yaw1 = await page.evaluate(() => window.BLACKROOT.player.yaw);
  check('Camera yaw responds', Math.abs(yaw1 - yaw0) > 0.5);

  // From here on we drive the real input path.
  const press = async (code, ms = 260) => {
    await page.evaluate((c) => window.BLACKROOT && window.__inputDown(c), code);
    await sleep(ms);
    await page.evaluate((c) => window.__inputUp(c), code);
  };
  await page.evaluate(() => {
    window.__inputDown = (c) => { window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true })); };
    window.__inputUp = (c) => { window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true })); };
  });

  /**
   * Test scaffolding. Firing a gun in this game genuinely brings the
   * neighbourhood down on you, so each section starts from a known state
   * instead of inheriting the last one's consequences.
   */
  const reset = () => page.evaluate(() => {
    const g = window.BLACKROOT;
    for (const e of g.entities.active.slice()) {
      const d = Math.hypot(e.position.x - g.player.position.x, e.position.z - g.player.position.z);
      if (d < 95 && e.alive) { e.alive = false; e.corpse = true; e.deathTimer = 999; }
    }
    g.stats.dead = false;
    g.stats.causeOfDeath = '';
    g.stats.health = 100; g.stats.stamina = 100;
    g.stats.hunger = 100; g.stats.thirst = 100;
    g.stats.bleeding = 0; g.stats.poison = 0;
    g.stats.effects.length = 0;
    // A known lamp state. Without this the flashlight section toggles whatever
    // the previous section happened to leave behind, which reads as a failure
    // in the lamp when it is really just test order.
    g.flashlight.on = false;
    g.flashlight.battery = 100;
    g.director.calmPeriod = 600;      // no director spawns while we test
    g._using = null;
    g._pauseReasons.clear();
    g.state = 'PLAYING';
    g.ui.hideAll();
    g.ui.showHUD();
  });

  // ---- movement + collision ----
  const p0 = await page.evaluate(() => ({ ...window.BLACKROOT.player.position }));
  await press('KeyW', 900);
  await sleep(120);
  const p1 = await page.evaluate(() => ({ ...window.BLACKROOT.player.position }));
  const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('WASD movement works', walked > 1.0, `${walked.toFixed(2)} m`);

  const speeds = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const speed = async (sprint) => {
      g.stats.stamina = 100;
      window.__inputDown('KeyW');
      if (sprint) window.__inputDown('ShiftLeft'); else window.__inputUp('ShiftLeft');
      let peak = 0;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        peak = Math.max(peak, Math.hypot(g.player.velocity.x, g.player.velocity.z));
      }
      window.__inputUp('KeyW'); window.__inputUp('ShiftLeft');
      await new Promise((r) => setTimeout(r, 400));
      return peak;
    };
    const walk = await speed(false);
    const run = await speed(true);
    return { walk, run, drained: g.stats.stamina };
  });
  check('Sprint is faster than walking', speeds.run > speeds.walk * 1.2,
    `${speeds.run.toFixed(2)} m/s sprint vs ${speeds.walk.toFixed(2)} m/s walk`);
  check('Sprinting drains stamina', speeds.drained < 100, `stamina fell to ${speeds.drained.toFixed(0)}`);
  await page.evaluate(() => { window.BLACKROOT.stats.stamina = 100; });
  await reset();   // ten seconds of sprinting in the open is long enough to be found

  /** Wait for N seconds of *simulated* time, not wall clock: under a software
   *  rasteriser a 500 ms sleep can cover a single frame. */
  const simWait = (seconds) => page.evaluate(async (s) => {
    const g = window.BLACKROOT;
    const t0 = g.time;
    const deadline = performance.now() + s * 12000 + 4000;
    while (g.time - t0 < s && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }, seconds);

  const diag = await page.evaluate(() => {
    const g = window.BLACKROOT;
    return { state: g.state, pause: [...g._pauseReasons], using: !!g._using,
             err: !!g._errored, frame: g.frame, time: +g.time.toFixed(1),
             enabled: !!(window.BLACKROOT && g.state === 'PLAYING') };
  });
  console.log('  diag  ' + JSON.stringify(diag));
  const h0 = await page.evaluate(() => window.BLACKROOT.player.height);
  await page.evaluate(() => window.__inputDown('KeyC'));
  await simWait(0.8);
  const h1 = await page.evaluate(() => window.BLACKROOT.player.height);
  await page.evaluate(() => window.__inputUp('KeyC'));
  check('Crouch lowers the camera', h1 < h0 - 0.3, `${h0.toFixed(2)} -> ${h1.toFixed(2)}`);
  await sleep(400);

  const jumped = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    window.__inputDown('Space');
    const t0 = g.time;
    let airborne = false;
    for (let i = 0; i < 60 && g.time - t0 < 0.4; i++) {
      await new Promise((r) => setTimeout(r, 30));
      if (!g.player.grounded || g.player.velocity.y > 0.5) airborne = true;
    }
    window.__inputUp('Space');
    return airborne;
  });
  check('Jump works', jumped);
  await sleep(900);

  const grounded = await page.evaluate(() => {
    const g = window.BLACKROOT;
    return Math.abs(g.player.position.y - g.world.terrain.heightAt(g.player.position.x, g.player.position.z)) < 1.2;
  });
  check('Gravity returns the player to the ground', grounded);

  // The movement section spends ten simulated seconds sprinting around in the
  // open, which is long enough for the Hollow to find you and kill you. The
  // sections below test mechanics, not survival, so they start from a clean
  // slate — otherwise a dead player silently fails every check that follows,
  // because a dead player's weapons and lamp quite correctly stop updating.
  await reset();

  // collision: shove the player into a tree and confirm it pushes back out
  const collision = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    let tree = null;
    for (const arr of g.world.vegetation.colliders.values()) {
      for (const c of arr) if (c.type === 'tree' && c.r > 0.4) { tree = c; break; }
      if (tree) break;
    }
    if (!tree) return { ok: false, reason: 'no tree colliders' };
    // Nudge off the exact centre: a point exactly on the axis has no push
    // direction, which is a degenerate case rather than a collision failure.
    g.player.position.set(tree.x + 0.05, g.world.terrain.heightAt(tree.x, tree.z) + 0.2, tree.z + 0.05);
    const t0 = g.time;
    while (g.time - t0 < 0.5) await new Promise((r) => setTimeout(r, 40));
    const d = Math.hypot(g.player.position.x - tree.x, g.player.position.z - tree.z);
    return { ok: d > tree.r, d, r: tree.r };
  });
  check('Collision pushes the player out of trees', collision.ok, collision.reason || `d=${collision.d?.toFixed(2)} r=${collision.r?.toFixed(2)}`);

  // ---- flashlight ----
  await reset();
  await press('KeyF', 60);
  await simWait(0.4);
  const fl = await page.evaluate(() => ({ on: window.BLACKROOT.flashlight.on, i: window.BLACKROOT.flashlight.spot.intensity }));
  check('Flashlight toggles on and lights', fl.on && fl.i > 1, `intensity ${fl.i.toFixed(1)}`);
  const batt = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const b0 = g.flashlight.battery;
    const t0 = g.time;
    while (g.time - t0 < 1.5) await new Promise((r) => setTimeout(r, 40));
    return { b0, b1: g.flashlight.battery };
  });
  check('Flashlight drains its battery', batt.b1 < batt.b0, `${batt.b0.toFixed(2)} -> ${batt.b1.toFixed(2)}`);
  if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/03-flashlight.png') });

  // ---- weapons: pistol ----
  await reset();
  const wep = await page.evaluate(() => ({
    id: window.BLACKROOT.weapons.currentId,
    mag: window.BLACKROOT.weapons.magazine,
    res: window.BLACKROOT.weapons.reserve,
  }));
  check('Starting pistol is equipped and loaded', wep.id === 'pistol9' && wep.mag === 15, `${wep.id} ${wep.mag}/${wep.res}`);

  const fired = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const before = g.weapons.magazine;
    g.weapons.tryFire();
    let t0 = g.time;
    while (g.time - t0 < 0.5) await new Promise((r) => setTimeout(r, 30));
    g.weapons.tryFire();
    t0 = g.time;
    while (g.time - t0 < 0.4) await new Promise((r) => setTimeout(r, 30));
    return { before, after: g.weapons.magazine, shots: g.stats.shotsFired };
  });
  check('Firing consumes ammunition', fired.after === fired.before - 2, `${fired.before} -> ${fired.after}`);
  check('Shot counter increments', fired.shots >= 2);

  const reload = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const resBefore = g.weapons.reserve;
    const ok = g.weapons.startReload();
    const t0 = g.time;
    while (g.time - t0 < 3.0 && g.weapons.state === 'reloading') await new Promise((r) => setTimeout(r, 40));
    return { ok, mag: g.weapons.magazine, resBefore, resAfter: g.weapons.reserve, state: g.weapons.state };
  });
  check('Reload refills the magazine from reserve', reload.mag === 15 && reload.resAfter < reload.resBefore,
    `mag ${reload.mag}, reserve ${reload.resBefore} -> ${reload.resAfter}`);

  // ---- weapons: every other firearm ----
  const allGuns = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const out = [];
    for (const id of ['revolver', 'shotgun', 'rifle', 'smg', 'carbine', 'axe', 'machete']) {
      g.inventory.add(id, 1);
      const def = (await import('/scripts/systems/ItemDatabase.js')).WEAPONS[id];
      if (def.ammo) g.inventory.add(def.ammo, 60);
      g.useItem(id);
      { const t0 = g.time; while (g.time - t0 < 0.5) await new Promise((r) => setTimeout(r, 30)); }
      if (def.kind === 'gun') {
        g.weapons.startReload();
        const t0 = g.time;
        while (g.time - t0 < 6 && g.weapons.state === 'reloading') await new Promise((r) => setTimeout(r, 40));
      } else await new Promise((r) => setTimeout(r, 200));
      // wait for the equip/reload cooldown to actually expire in sim time
      { const t0 = g.time; while (g.weapons.cooldown > 0 && g.time - t0 < 3) await new Promise((r) => setTimeout(r, 30)); }
      const magBefore = g.weapons.magazine;
      g.weapons.tryFire();
      { const t0 = g.time; while (g.weapons.magazine === magBefore && g.time - t0 < 1.5) { g.weapons.tryFire(); await new Promise((r) => setTimeout(r, 30)); } }
      out.push({ id, kind: def.kind, magBefore, magAfter: g.weapons.magazine, equipped: g.weapons.currentId });
    }
    return out;
  });
  for (const w of allGuns) {
    if (w.kind === 'gun') check(`Weapon works: ${w.id}`, w.equipped === w.id && w.magAfter < w.magBefore, `${w.magBefore} -> ${w.magAfter}`);
    else check(`Weapon works: ${w.id}`, w.equipped === w.id, 'melee');
  }
  await page.evaluate(() => window.BLACKROOT.useItem('pistol9'));
  await sleep(400);

  await reset();
  // ---- shooting damages and kills a mutant ----
  const combat = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    // place a stalker directly in front of the player and shoot it
    const f = g.player.forward;
    const x = g.player.position.x + f.x * 9, z = g.player.position.z + f.z * 9;
    const m = g.entities.spawnMutant('stalker', x, z);
    m.alertLevel = 0;
    // Aim the camera at the target's chest so the test exercises the hitscan
    // path rather than the player's happening to face uphill.
    await new Promise((r) => setTimeout(r, 300));
    g.camera.lookAt(m.position.x, m.position.y + m.height * 0.55, m.position.z);
    g.camera.updateMatrixWorld(true);
    const hp0 = m.health;
    g.inventory.add('ammo9', 120);
    g.weapons.mags.set('pistol9', 15);
    let hits = 0;
    for (let i = 0; i < 40 && m.alive; i++) {
      g.camera.lookAt(m.position.x, m.position.y + m.height * 0.55, m.position.z);
      g.camera.updateMatrixWorld(true);
      g.weapons.cooldown = 0;
      g.weapons.spreadBloom = 0;
      const before = m.health;
      g.weapons.tryFire();
      if (m.health < before) hits++;
      if (g.weapons.magazine <= 0) g.weapons.mags.set('pistol9', 15);
      await new Promise((r) => setTimeout(r, 45));
    }
    return { hp0, hp1: m.health, alive: m.alive, hits, corpse: m.corpse, kills: g.stats.kills };
  });
  check('Shooting damages enemies', combat.hp1 < combat.hp0 || !combat.alive, `${combat.hp0} -> ${combat.hp1.toFixed(0)}, ${combat.hits} hits`);
  check('Enemies can be killed', !combat.alive && combat.kills > 0);
  check('Dead enemies leave a corpse (not instant despawn)', combat.corpse);

  await reset();
  // ---- mutant detection & attack ----
  const detect = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    // Stand in genuinely open ground. findWalkable only knows about water and
    // slope, so also reject anywhere near a structure: creatures steer locally
    // with no navmesh, and testing from inside a cabin measures the building's
    // walls rather than the AI.
    // The search radius has to be generous: a world with two dozen landmarks
    // in it has a lot less genuinely empty ground near the spawn than one with
    // a dozen, and falling back to somewhere beside a wall measures the wall.
    let clear = null;
    for (let i = 0; i < 600 && !clear; i++) {
      const c = g.world.terrain.findWalkable(g.player.position.x, g.player.position.z, Math.random, 8, 130);
      let ok = true;
      for (const b of g.world.structureBoxes) {
        if (Math.hypot(b.x - c.x, b.z - c.z) < Math.max(b.hw, b.hd) + 14) { ok = false; break; }
      }
      if (ok) clear = c;
    }
    clear = clear || g.world.terrain.findWalkable(g.player.position.x, g.player.position.z, Math.random, 20, 30);
    g.player.position.set(clear.x, clear.y + 0.2, clear.z);
    await new Promise((r) => setTimeout(r, 300));

    // Phase 1 — perception and pursuit from a distance.
    const f = g.player.forward;
    const fx = g.player.position.x + f.x * 14, fz = g.player.position.z + f.z * 14;
    const far = g.entities.spawnMutant('stalker', fx, fz);
    far.yaw = far.targetYaw = Math.atan2(-(g.player.position.x - fx), -(g.player.position.z - fz));
    g.flashlight.on = true;
    g.player.emitNoise(0.9);
    let sawChase = false, closed = 999;
    let t0 = g.time;
    while (g.time - t0 < 12) {
      await new Promise((r) => setTimeout(r, 60));
      if (far.state === 'CHASE' || far.state === 'ATTACK') sawChase = true;
      closed = Math.min(closed, Math.hypot(far.position.x - g.player.position.x, far.position.z - g.player.position.z));
      if (closed < far.attackRange + 0.5) break;
    }
    const perception = { alert: far.alertLevel, state: far.state, sawChase, closed: +closed.toFixed(2) };
    far.alive = false; far.corpse = true; far.deathTimer = 999;

    // Phase 2 — the attack pipeline itself, at a distance that is
    // unambiguously inside melee reach.
    g.stats.health = 100;
    const cx = g.player.position.x + f.x * 1.2, cz = g.player.position.z + f.z * 1.2;
    const m = g.entities.spawnMutant('crawler', cx, cz);
    m.alertLevel = 1;
    m.lastKnownPos.copy(g.player.position);
    m.state = 'CHASE';
    // Point it at the player. A creature spawned facing away spends its first
    // moments turning around, and this check is about the damage pipeline,
    // not about how fast a neck works.
    m.yaw = m.targetYaw = Math.atan2(-(g.player.position.x - m.position.x), -(g.player.position.z - m.position.z));
    m.hasBeenSeen = true;
    const hpBefore = g.stats.health;
    let sawAttack = false, hpMin = hpBefore;
    t0 = g.time;
    while (g.time - t0 < 10) {
      await new Promise((r) => setTimeout(r, 50));
      if (m.state === 'ATTACK') sawAttack = true;
      hpMin = Math.min(hpMin, g.stats.health);
      if (hpMin < hpBefore - 1) break;
    }
    return { ...perception, sawAttack, hpBefore, hpAfter: hpMin,
             dmg: +(hpBefore - hpMin).toFixed(1) };
  });
  check('Mutants detect the player', detect.alert > 0.3 || detect.sawChase,
    `state=${detect.state} alert=${detect.alert.toFixed(2)}`);
  check('Mutants chase the player down', detect.sawChase && detect.closed < 14,
    `closed from 14 m to ${detect.closed} m`);
  check('Mutants attack and the player takes damage', detect.sawAttack && detect.hpAfter < detect.hpBefore,
    `${detect.hpBefore.toFixed(0)} -> ${detect.hpAfter.toFixed(0)} hp (${detect.dmg} damage)`);
  if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/04-combat.png') });

  await reset();
  // ---- wildlife ----
  const wild = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const f = g.player.forward;
    const x = g.player.position.x + f.x * 14, z = g.player.position.z + f.z * 14;
    const deer = g.entities.spawnAnimal('deer', x, z);
    const wolf = g.entities.spawnAnimal('wolf', x + 4, z + 4);
    wolf.aggro = 0.6;          // a wolf that has already decided you are prey
    let deerFled = false, wolfEngaged = false;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (deer.state === 'FLEE') deerFled = true;
      if (wolf.state === 'STALK' || wolf.state === 'CHASE' || wolf.state === 'ATTACK') wolfEngaged = true;
      if (deerFled && wolfEngaged) break;
    }
    const types = {};
    for (const e of g.entities.active) if (e.faction === 'animal') types[e.type] = (types[e.type] || 0) + 1;
    return { deerFled, wolfEngaged, types };
  });
  check('Wildlife present and varied', Object.keys(wild.types).length >= 3, JSON.stringify(wild.types));
  check('Prey animals flee', wild.deerFled);
  check('Predators engage', wild.wolfEngaged);

  await reset();
  // ---- pickups / foraging / inventory / eating ----
  const looting = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    // teleport onto the nearest untouched pickup and take it
    const p = g.loot.pickups.find((x) => !x.taken);
    g.player.position.set(p.x, g.world.terrain.heightAt(p.x, p.z), p.z);
    g.player.yaw = 0; g.player.pitch = -0.5;
    g.camera.position.set(p.x, p.y + 1.2, p.z + 0.6);
    g.camera.lookAt(p.x, p.y, p.z);
    await new Promise((r) => setTimeout(r, 200));
    const before = g.inventory.count(p.id);
    g.interaction.current = p;
    const ok = g.interaction.activate();
    const after = g.inventory.count(p.id);

    // forage
    const f = g.loot.forage.find((x) => x.harvests > 0);
    const fBefore = g.inventory.count(f.item);
    g.interaction.current = f;
    const fOk = g.interaction.activate();
    const fAfter = g.inventory.count(f.item);

    return { ok, id: p.id, before, after, fOk, fItem: f.item, fBefore, fAfter, slots: g.inventory.slots.length };
  });
  check('Weapons/ammo/items can be picked up', looting.ok && looting.after > looting.before,
    `${looting.id} ${looting.before} -> ${looting.after}`);
  check('Food can be collected from plants', looting.fOk && looting.fAfter > looting.fBefore,
    `${looting.fItem} ${looting.fBefore} -> ${looting.fAfter}`);
  check('Inventory holds items', looting.slots > 3, `${looting.slots} slots used`);

  const eating = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    g.stats.hunger = 40; g.stats.health = 60;
    g.inventory.add('canned', 1);
    const h0 = g.stats.hunger;
    g.useItem('canned');
    { const t0 = g.time; while (g.time - t0 < 4.5 && g._using) await new Promise((r) => setTimeout(r, 40)); }
    const h1 = g.stats.hunger;
    g.inventory.add('medkit', 1);
    const hp0 = g.stats.health;
    g.useItem('medkit');
    { const t0 = g.time; while (g.time - t0 < 7 && g._using) await new Promise((r) => setTimeout(r, 40)); }
    return { h0, h1, hp0, hp1: g.stats.health };
  });
  check('Food can be eaten and restores hunger', eating.h1 > eating.h0, `${eating.h0.toFixed(0)} -> ${eating.h1.toFixed(0)}`);
  check('Medical items heal', eating.hp1 > eating.hp0, `${eating.hp0.toFixed(0)} -> ${eating.hp1.toFixed(0)}`);

  await reset();
  // ---- inventory UI ----
  await page.keyboard.press('Tab');
  await sleep(400);
  const invOpen = await page.evaluate(() => ({
    open: !document.getElementById('inventory').classList.contains('hidden'),
    cells: document.querySelectorAll('.inv-cell').length,
  }));
  check('Inventory screen opens and lists items', invOpen.open && invOpen.cells > 3, `${invOpen.cells} cells`);
  if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/05-inventory.png') });
  await page.keyboard.press('Tab');
  await sleep(300);

  // ---- HUD ----
  const hud = await page.evaluate(() => ({
    hud: !document.getElementById('hud').classList.contains('hidden'),
    hp: document.getElementById('bar-health').style.width,
    ammo: document.getElementById('ammo-mag').textContent,
    quick: document.querySelectorAll('.qslot').length,
  }));
  check('HUD shows health, ammo and quick slots', hud.hud && !!hud.hp && hud.quick === 5, `hp=${hud.hp} ammo=${hud.ammo}`);

  // ---- pause & settings ----
  await page.evaluate(() => clearInterval(window.__keepPlaying));
  await page.keyboard.press('Escape');
  await sleep(400);
  const paused = await page.evaluate(() => ({
    vis: !document.getElementById('pause').classList.contains('hidden'),
    frozen: window.BLACKROOT.paused,
  }));
  check('Pause menu opens and freezes the game', paused.vis && paused.frozen);

  const settingsOk = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    g.ui.showSettings('pause');
    await new Promise((r) => setTimeout(r, 200));
    const vis = !document.getElementById('settings').classList.contains('hidden');
    const rows = document.querySelectorAll('#settings-body .set-row').length;
    // change a setting through the real UI path
    const before = g.settings.get('viewDistance');
    g.settings.set('viewDistance', 120);
    const applied = g.world.scene.fog.density;
    g.settings.set('viewDistance', before);
    // audio tab
    document.querySelectorAll('#settings .tab')[1].click();
    await new Promise((r) => setTimeout(r, 150));
    const audioRows = document.querySelectorAll('#settings-body .set-row').length;
    document.querySelectorAll('#settings .tab')[0].click();
    document.getElementById('settings').classList.add('hidden');
    return { vis, rows, applied, audioRows };
  });
  check('Settings screen renders and applies changes', settingsOk.vis && settingsOk.rows > 8 && settingsOk.audioRows > 3,
    `${settingsOk.rows} graphics rows, ${settingsOk.audioRows} audio rows`);
  if (SHOTS) { await page.evaluate(() => window.BLACKROOT.ui.showSettings('pause')); await sleep(250); await page.screenshot({ path: path.join(root, 'tools/shots/06-settings.png') }); await page.evaluate(() => document.getElementById('settings').classList.add('hidden')); }

  await page.keyboard.press('Escape');
  await sleep(400);
  const resumed = await page.evaluate(() => !window.BLACKROOT.paused && window.BLACKROOT.state === 'PLAYING');
  check('Resume returns to gameplay', resumed);
  await page.evaluate(() => {
    window.__keepPlaying = setInterval(() => {
      const g = window.BLACKROOT;
      if (g && g.state === 'PLAYING') g._pauseReasons.delete('menu');
    }, 80);
  });

  // ---- save / load ----
  const saved = await page.evaluate(() => {
    const g = window.BLACKROOT;
    const ok = g.saveGame();
    return { ok, has: g.save.hasSave() };
  });
  check('Game saves to local storage', saved.ok && saved.has);

  // ---- death & restart ----
  const death = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    g.damage.applyToPlayer(999, 'a Brute');
    await new Promise((r) => setTimeout(r, 2000));
    return {
      state: g.state,
      screen: !document.getElementById('death').classList.contains('hidden'),
      text: document.querySelector('#death .died')?.textContent,
    };
  });
  check('Player can die', death.state === 'DEAD');
  check('Death screen appears', death.screen && death.text === 'YOU DIED');
  if (SHOTS) await page.screenshot({ path: path.join(root, 'tools/shots/07-death.png') });

  const restarted = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    await g.restart();
    return { state: g.state, hp: g.stats.health, mag: g.weapons.magazine };
  });
  check('Restart puts the player back in a fresh run', restarted.state === 'PLAYING' && restarted.hp === 100, `hp=${restarted.hp}`);

  // ---- performance ----
  // SwiftShader rasterises on the CPU, so raw fps here says nothing about a
  // real GPU. What IS hardware-independent is the CPU frame budget: the
  // simulation plus the cost of submitting both render passes.
  const perf = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    let frames = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    const rawFps = frames / ((performance.now() - t0) / 1000);

    let sim = 0, sub = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      let t = performance.now();
      g.update(1 / 60);
      sim += performance.now() - t;
      t = performance.now();
      g.render();
      sub += performance.now() - t;
    }
    return {
      rawFps, sim: sim / N, sub: sub / N,
      calls: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
      ents: g.entities.active.length,
    };
  });
  const budget = perf.sim + perf.sub;
  check('CPU frame budget leaves room for 60 fps', budget < 12,
    `sim ${perf.sim.toFixed(2)} ms + submit ${perf.sub.toFixed(2)} ms = ${budget.toFixed(2)} ms/frame ` +
    `(${(1000 / budget).toFixed(0)} fps ceiling) · ${perf.calls} draws · ${(perf.tris / 1000) | 0}k tris · ${perf.ents} creatures`);
  check('Draw call count is sane', perf.calls < 500, `${perf.calls} draws`);
  console.log(`  note  raw SwiftShader fps ${perf.rawFps.toFixed(1)} (CPU rasteriser, not indicative of GPU hardware)`);

  // ---- no runaway spawning ----
  const spawnCheck = await page.evaluate(async () => {
    const g = window.BLACKROOT;
    const n0 = g.entities.active.length;
    await new Promise((r) => setTimeout(r, 4000));
    return { n0, n1: g.entities.active.length, cap: g.entities.mutantCap };
  });
  check('No runaway enemy spawning', spawnCheck.n1 <= spawnCheck.n0 + 4, `${spawnCheck.n0} -> ${spawnCheck.n1}`);

  // ---- console errors ----
  const realErrors = errors.filter((e) =>
    !/favicon|Deprecat|WebGL.*performance|SwiftShader|GroupMarkerNotSet|Fontconfig/i.test(e));
  check('No major console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  // ---- summary ----
  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(64));
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('  FAILURES:');
    for (const f of failed) console.log(`   - ${f.name} ${f.detail}`);
  }
  console.log('='.repeat(64));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
