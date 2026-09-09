/**
 * Difficulty test — is it survivable?
 *
 * "Too hard" is not a matter of taste you can argue about; it is measurable.
 * A player who takes a beating and then gets thirty seconds of quiet should be
 * most of the way back to fighting shape, two creatures arriving together
 * should not be able to remove a health bar with nothing you can do about it,
 * and the ladder should still have a top rung for anyone who wants it.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8577;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };

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
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state === "MENU"', null, { timeout: 45000 });
await page.evaluate(() => {
  const S = window.BLACKROOT.settings;
  S.applyPreset('low'); S.set('renderScale', 0.12); S.set('viewDistance', 70); S.set('foliage', 0.2);
});

/* ================= the ladder ================= */

const tiers = await page.evaluate(async () => {
  const S = await import('/scripts/core/Settings.js');
  return Object.entries(S.DIFFICULTY).map(([k, d]) => ({ k, ...d }));
});
check('There are four difficulties, not three', tiers.length === 4, tiers.map((t) => t.k).join(', '));
check('The default is a forgiving one', await page.evaluate(() => window.BLACKROOT.settings.get('difficulty')) === 'normal');

const normal = tiers.find((t) => t.k === 'normal');
const harsh = tiers.find((t) => t.k === 'harsh');
const brutal = tiers.find((t) => t.k === 'brutal');
check('The default takes well under full damage', normal.dmgTaken < 0.7, `×${normal.dmgTaken} incoming`);
check('  …hits harder than it is hit', normal.dmgDealt > 1.2, `×${normal.dmgDealt} outgoing`);
check('  …finds more, and meets fewer', normal.lootMul > 1.2 && normal.enemyDensity < 0.85,
  `loot ×${normal.lootMul}, density ×${normal.enemyDensity}`);
check('The ladder still climbs', harsh.dmgTaken > normal.dmgTaken && brutal.dmgTaken > harsh.dmgTaken,
  `${normal.dmgTaken} < ${harsh.dmgTaken} < ${brutal.dmgTaken}`);
check('  …and the old balance is still there for anyone who wants it',
  harsh.dmgTaken === 1.0 && harsh.dmgDealt === 1.0 && harsh.enemyDensity === 1.0);
check('BRUTAL heals you not at all', brutal.regen === 0);

/* ================= in a real game ================= */

await page.evaluate(() => window.BLACKROOT.startNewGame(0xC0FFEE));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 240000 });
await page.evaluate(() => { window.BLACKROOT.director.calmPeriod = 900; });

const kit = await page.evaluate(() => {
  const g = window.BLACKROOT;
  const have = (id) => g.inventory.count(id);
  // Fifteen of the rounds are already in the pistol, so reserve alone
  // undercounts what the player actually has.
  return {
    ammo: have('ammo9') + (g.weapons.mags.get('pistol9') || 0),
    bandage: have('bandage'), medkit: have('medkit'), food: have('berries'), water: have('water'),
  };
});
check('You start with enough to survive being surprised twice',
  kit.ammo >= 60 && kit.bandage >= 4 && kit.medkit >= 1,
  `${kit.ammo} rounds, ${kit.bandage} bandages, ${kit.medkit} trauma kit, ${kit.food} food`);

const heal = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.stats.health = 30;
  g.stats.bleeding = 0; g.stats.poison = 0;
  g.stats.lastDamageAt = g.stats.timeAlive;
  const t0 = g.time;
  // Thirty seconds of quiet.
  while (g.time - t0 < 30) await new Promise((r) => setTimeout(r, 40));
  return { hp: g.stats.health, cap: g.stats.maxHealth * g.stats.diff.regenCap };
});
check('Thirty seconds of quiet gets you most of the way back',
  heal.hp > 70, `30 hp -> ${Math.round(heal.hp)} hp`);
// Past the cap the fast recovery hands over to a slow trickle, so half a
// minute gets you fighting fit but not pristine — a bandage is still worth
// carrying, and a fight still costs you something.
check('  …but not all the way, so a bandage still matters',
  heal.hp < 96, `${Math.round(heal.hp)} hp, fast recovery capped at ${Math.round(heal.cap)}`);

const noHealInFight = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.stats.health = 40;
  const t0 = g.time;
  // Keep taking hits: healing must not start while something is hitting you.
  while (g.time - t0 < 6) {
    g.stats.lastDamageAt = g.stats.timeAlive;
    await new Promise((r) => setTimeout(r, 40));
  }
  return g.stats.health;
});
check('It does not heal you mid-fight', noHealInFight <= 40.5, `${Math.round(noHealInFight)} hp after 6 s under fire`);

const bleedBlocks = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.stats.health = 50; g.stats.bleeding = 2;
  g.stats.lastDamageAt = g.stats.timeAlive - 60;
  const t0 = g.time;
  while (g.time - t0 < 5) await new Promise((r) => setTimeout(r, 40));
  const bleeding = g.stats.health;
  g.stats.bleeding = 0;
  return { bleeding };
});
check('  …or while you are bleeding', bleedBlocks.bleeding < 50, `${Math.round(bleedBlocks.bleeding)} hp — still going down`);

/* ================= the recovery window ================= */

const grace = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.stats.health = 100; g.stats.bleeding = 0; g.stats.dead = false;
  // Five hits in the same instant, the way two creatures reaching you at once
  // used to feel.
  let dealt = 0;
  for (let i = 0; i < 5; i++) dealt += g.damage.applyToPlayer(18, 'the test');
  const burst = g.stats.health;

  // The same five hits spread out past the window: all of them should land.
  g.stats.health = 100;
  g.stats._graceUntil = 0;
  let spread = 0;
  for (let i = 0; i < 5; i++) {
    g.stats._graceUntil = 0;
    spread += g.damage.applyToPlayer(18, 'the test');
  }
  return { burst, dealt, spread, after: g.stats.health };
});
check('Hits in the same instant cannot stack you to death',
  grace.burst > 70, `five 18-damage hits at once cost ${Math.round(100 - grace.burst)} hp`);
check('  …but hits you could have avoided all land',
  grace.after < grace.burst - 20, `spread out, the same five cost ${Math.round(100 - grace.after)} hp`);

/* ================= HARSH is still HARSH ================= */

const harshRun = await page.evaluate(async () => {
  const g = window.BLACKROOT;
  g.settings.set('difficulty', 'harsh');
  g.stats.diff = g.settings.difficulty();
  g.stats.health = 30;
  g.stats.bleeding = 0; g.stats.poison = 0;
  g.stats.lastDamageAt = g.stats.timeAlive;
  const t0 = g.time;
  while (g.time - t0 < 30) await new Promise((r) => setTimeout(r, 40));
  const hp = g.stats.health;
  g.settings.set('difficulty', 'normal');
  g.stats.diff = g.settings.difficulty();
  return hp;
});
check('HARSH still barely heals you', harshRun < 60, `30 hp -> ${Math.round(harshRun)} hp in the same 30 s`);

check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log('\n================================================================');
console.log(`  ${pass}/${pass + fail} difficulty checks passed`);
if (fail) { console.log('  FAILURES:'); for (const f of failures) console.log('   · ' + f); }
console.log('================================================================');
process.exit(fail ? 1 : 0);
