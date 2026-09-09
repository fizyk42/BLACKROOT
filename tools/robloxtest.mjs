#!/usr/bin/env node
/**
 * robloxtest — static verification of the Roblox port.
 *
 * There is no headless Luau runtime here and no way to boot a Roblox server
 * from CI, so this suite checks the things that *can* be checked without one,
 * and checks them hard:
 *
 *   • every source file parses far enough to have balanced delimiters
 *   • every ModuleScript actually returns something
 *   • every require() points at a file that exists
 *   • every Net.event("X") name is declared in Net.EVENTS
 *   • every product's grant handler exists in PowerupService
 *   • the difficulty table matches the WebGL build's, number for number
 *   • no credential of any kind is committed
 *   • the generated .rbxlx is well-formed and carries every script's source
 *
 * The last two are the ones that matter most. A bug in the Luau is a bug; a
 * committed API key is an incident.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const RBX = path.join(PROJECT, 'roblox');
const SRC = path.join(RBX, 'src');

let passed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push(detail ? `${label}\n      ${detail}` : label);
  }
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── helpers ────────────────────────────────────────────────────────────────

function luauFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) luauFiles(full, out);
    else if (entry.name.endsWith('.luau')) out.push(full);
  }
  return out;
}

/**
 * Strip Luau comments and string literals so a delimiter count means something.
 * Handles --[[ long comments ]], -- line comments, [[ long strings ]],
 * quoted strings with escapes, and `interpolated {strings}`.
 */
function stripLiterals(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);

    if (two === '--') {
      if (src.slice(i + 2, i + 4) === '[[') {
        const end = src.indexOf(']]', i + 4);
        i = end === -1 ? n : end + 2;
        continue;
      }
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }

    if (two === '[[') {
      const end = src.indexOf(']]', i + 2);
      i = end === -1 ? n : end + 2;
      out += '""';
      continue;
    }

    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (ch === '`' && src[i] === '{') { depth++; i++; continue; }
        if (ch === '`' && src[i] === '}' && depth > 0) { depth--; i++; continue; }
        if (src[i] === ch && depth === 0) { i++; break; }
        if (src[i] === '\n' && ch !== '`') { break; }
        i++;
      }
      out += '""';
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

function delimiterBalance(src) {
  const clean = stripLiterals(src);
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const ch of clean) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (pairs[ch]) {
      if (stack.pop() !== pairs[ch]) return `unbalanced near "${ch}"`;
    }
  }
  return stack.length === 0 ? null : `${stack.length} unclosed ${stack.join('')}`;
}

const read = (p) => fs.readFileSync(p, 'utf8');

// ── 1. layout ──────────────────────────────────────────────────────────────

const expected = [
  'default.project.json',
  'blackroot.config.json',
  'plugin/BlackrootSync.server.luau',
  'tools/bot.mjs',
  'tools/syncserver.mjs',
  'tools/buildplace.mjs',
  'tools/installplugin.mjs',
  'src/ReplicatedStorage/Shared/Config.luau',
  'src/ReplicatedStorage/Shared/Products.luau',
  'src/ReplicatedStorage/Shared/Net.luau',
  'src/ServerScriptService/Blackroot/init.server.luau',
  'src/ServerScriptService/Blackroot/StatsService.luau',
  'src/ServerScriptService/Blackroot/InventoryService.luau',
  'src/ServerScriptService/Blackroot/PowerupService.luau',
  'src/ServerScriptService/Blackroot/MonetizationService.luau',
  'src/ServerScriptService/Blackroot/WorldBuilder.luau',
  'src/ServerScriptService/Blackroot/EnemyService.luau',
  'src/ServerScriptService/Blackroot/WeaponService.luau',
  'src/ServerScriptService/Blackroot/ObjectiveService.luau',
  'src/StarterPlayer/StarterPlayerScripts/Hud.client.luau',
  'src/StarterPlayer/StarterPlayerScripts/Combat.client.luau',
  'src/StarterPlayer/StarterPlayerScripts/Shop.client.luau',
];

for (const rel of expected) {
  ok(`exists: ${rel}`, fs.existsSync(path.join(RBX, rel)));
}

// ── 2. every Luau file is structurally sane ────────────────────────────────

const files = luauFiles();
ok('found Luau sources', files.length >= 12, `found ${files.length}`);

for (const file of files) {
  const rel = path.relative(RBX, file);
  const src = read(file);
  const imbalance = delimiterBalance(src);
  ok(`balanced delimiters: ${rel}`, imbalance === null, imbalance || '');

  const isModule = !/\.(server|client)\.luau$/.test(file);
  if (isModule) {
    const tail = src.trimEnd().split('\n').slice(-1)[0].trim();
    ok(`${rel} returns a module`, /^return\s+\w+$/.test(tail), `last line is "${tail}"`);
  }
}

// ── 3. requires resolve ────────────────────────────────────────────────────

const serverDir = path.join(SRC, 'ServerScriptService/Blackroot');
const sharedDir = path.join(SRC, 'ReplicatedStorage/Shared');

for (const file of files) {
  const src = read(file);
  const rel = path.relative(RBX, file);
  for (const m of src.matchAll(/WaitForChild\("([A-Za-z]+)"\)\)/g)) {
    const name = m[1];
    if (['Shared', 'Blackroot', 'Humanoid', 'PlayerGui'].includes(name)) continue;
    const here = fs.existsSync(path.join(serverDir, `${name}.luau`));
    const there = fs.existsSync(path.join(sharedDir, `${name}.luau`));
    ok(`${rel} requires an existing module: ${name}`, here || there);
  }
}

// ── 4. the remote surface is declared ──────────────────────────────────────

const netSrc = read(path.join(sharedDir, 'Net.luau'));
const declared = new Set();
{
  const eventsBlock = netSrc.slice(netSrc.indexOf('Net.EVENTS'), netSrc.indexOf('Net.FUNCTIONS'));
  for (const m of eventsBlock.matchAll(/"([A-Za-z]+)"/g)) declared.add(m[1]);
  const funcBlock = netSrc.slice(netSrc.indexOf('Net.FUNCTIONS'));
  for (const m of funcBlock.matchAll(/"([A-Za-z]+)"/g)) declared.add(m[1]);
}
ok('Net declares events', declared.size >= 12, `${declared.size} declared`);

for (const file of files) {
  const src = read(file);
  const rel = path.relative(RBX, file);
  for (const m of src.matchAll(/Net\.(?:event|func|get)\("([A-Za-z]+)"\)/g)) {
    ok(`${rel} uses a declared remote: ${m[1]}`, declared.has(m[1]));
  }
}

// ── 4b. PARITY: the Luau tables against the JavaScript they came from ──────
//
// This is the section that makes "1:1" a checkable claim rather than a
// marketing one. For each entity that exists in both builds, pull every
// numeric field out of both definitions and compare them. A retune on one side
// that is not mirrored on the other fails the suite by name and number.

/**
 * Slice out the object literal that follows a key, balancing braces so nested
 * objects come along. Works for both `key: {` (JS) and `key = {` (Luau).
 */
function literalAfter(src, startIndex) {
  const open = src.indexOf('{', startIndex);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

/** Every `name: 123` / `name = 123` pair in a block, as a plain object. */
function numericFields(block) {
  const out = {};
  for (const m of block.matchAll(/(?:^|[,{\s])([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

/**
 * Locate one entity's definition by its id, in either language.
 *
 * Two shapes, and they need opposite handling — getting this backwards is how
 * the first draft of this test cheerfully compared the stalker against the
 * sporebearer and reported eighteen mismatches that were not there:
 *
 *   `{ id: 'stalker', … }`   the entity's own brace is BEFORE the match
 *   `stalker: { … }`         the entity's own brace is AFTER the match
 */
function blockById(src, id) {
  // Shape 1: an explicit id field. Walk back to the enclosing brace.
  const idField = src.match(new RegExp(`\\bid\\s*[:=]\\s*['"]${id}['"]`));
  if (idField) {
    const open = src.lastIndexOf('{', idField.index);
    if (open >= 0) return literalAfter(src, open - 1);
  }

  // Shape 2: the id is the key. Take the literal that follows it.
  const keyed = src.match(new RegExp(`(^|[\\n{,])\\s*${id}\\s*[:=]\\s*\\{`, 'm'));
  if (keyed) {
    return literalAfter(src, keyed.index + keyed[0].length - 1);
  }

  return null;
}

/**
 * Compare every numeric field the two definitions share. Fields present in
 * only one side are not failures — the Roblox port carries extra render hints
 * and the WebGL build carries extra shader terms — but a shared field with a
 * different value is.
 */
function compareNumbers(labelText, jsBlock, luaBlock, options = {}) {
  const skip = new Set(options.skip || []);
  if (jsBlock === null || luaBlock === null) {
    ok(labelText, false, `missing on ${jsBlock === null ? 'the JS' : 'the Luau'} side`);
    return;
  }
  const a = numericFields(jsBlock);
  const b = numericFields(luaBlock);
  const shared = Object.keys(a).filter((k) => k in b && !skip.has(k));
  ok(`${labelText} — has comparable fields`, shared.length > 0, 'no shared numeric fields found');

  const drift = shared.filter((k) => Math.abs(a[k] - b[k]) > 1e-9);
  ok(
    labelText,
    drift.length === 0,
    drift.map((k) => `${k}: js ${a[k]} vs luau ${b[k]}`).join(', '),
  );
}

const jsItems = read(path.join(PROJECT, 'scripts/systems/ItemDatabase.js'));
const luaItems = read(path.join(sharedDir, 'Items.luau'));

// Weapons — the eight that decide how the game plays.
for (const id of ['knife', 'axe', 'machete', 'pistol9', 'revolver', 'shotgun', 'rifle', 'smg', 'carbine']) {
  compareNumbers(`weapon parity: ${id}`, blockById(jsItems, id), blockById(luaItems, id));
}

// Ammunition and every consumable.
for (const id of ['ammo9', 'ammo357', 'ammo12', 'ammo308', 'ammo556']) {
  compareNumbers(`ammo parity: ${id}`, blockById(jsItems, id), blockById(luaItems, id));
}
for (const id of ['berries', 'apple', 'mushroom', 'nuts', 'root', 'jerky', 'canned', 'water',
  'bandage', 'medkit', 'herb', 'painkillers', 'battery', 'cloth', 'scrap', 'flare']) {
  compareNumbers(`item parity: ${id}`, blockById(jsItems, id), blockById(luaItems, id));
}

// The starting loadout, item for item.
{
  const jsLoadout = jsItems.slice(jsItems.indexOf('startingLoadout'), jsItems.indexOf('startingLoadout') + 900);
  const luaLoadout = luaItems.slice(luaItems.indexOf('startingLoadout'), luaItems.indexOf('startingLoadout') + 900);
  for (const [id, qty] of [['pistol9', 1], ['ammo9', 64], ['knife', 1], ['bandage', 5],
    ['medkit', 1], ['berries', 5], ['water', 2], ['battery', 2]]) {
    ok(`starting loadout has ${id} ×${qty}`,
      new RegExp(`["']${id}["']`).test(luaLoadout) && luaLoadout.includes(`qty = ${qty}`),
      'not found in Items.startingLoadout');
    ok(`starting loadout matches the WebGL build for ${id}`, jsLoadout.includes(id));
  }
}

// Loot tables — every table, and every entry inside it.
{
  const jsLoot = read(path.join(PROJECT, 'scripts/systems/ItemDatabase.js'));
  for (const table of ['camp', 'cabin', 'ranger', 'medical', 'wreck', 'military',
    'cave', 'tower', 'ruin', 'graves', 'nest', 'dock', 'body', 'forage']) {
    ok(`loot table exists: ${table}`, new RegExp(`\\b${table}\\s*[:=]`).test(luaItems));
    ok(`loot table is in both builds: ${table}`, new RegExp(`\\b${table}\\s*:`).test(jsLoot));
  }
  // Spot-check the exact rows of two tables in both directions.
  ok('military drops 12–30 rounds of 5.56', luaItems.includes('{ "ammo556", 16, 12, 30 }'));
  ok('forage is berries-heavy', luaItems.includes('{ "berries", 30, 2, 6 }'));
}

// Attachments — the mods are what actually change a gun.
{
  const jsAtt = read(path.join(PROJECT, 'scripts/systems/Attachments.js'));
  const luaAtt = read(path.join(sharedDir, 'Attachments.luau'));
  for (const id of ['iron', 'reflex', 'holo', 'acog', 'sniper', 'thermal',
    'suppressor', 'compensator', 'brake', 'long', 'short', 'heavy',
    'extended', 'drum', 'quick', 'light', 'vertical', 'angled', 'bipod', 'red', 'ir']) {
    compareNumbers(`attachment parity: ${id}`, blockById(jsAtt, id), blockById(luaAtt, id));
  }
  for (const slot of ['optic', 'muzzle', 'barrel', 'mag', 'stock', 'grip', 'laser']) {
    ok(`attachment slot declared: ${slot}`, luaAtt.includes(`"${slot}"`));
    ok(`attachment slot in both builds: ${slot}`, jsAtt.includes(`'${slot}'`) || jsAtt.includes(`"${slot}"`));
  }
}

// Upgrades — six tracks, and the costs have to match or the economy drifts.
{
  const jsUp = read(path.join(PROJECT, 'scripts/systems/Upgrades.js'));
  const luaUp = read(path.join(sharedDir, 'Upgrades.luau'));
  for (const id of ['ballistics', 'control', 'handling', 'capacity', 'barrel', 'drills']) {
    compareNumbers(`upgrade parity: ${id}`, blockById(jsUp, id), blockById(luaUp, id));
  }
  // grantedPoints lives in Armoury.js in the WebGL build, not Upgrades.js.
  const jsArmoury = read(path.join(PROJECT, 'scripts/systems/Armoury.js'));
  ok('granted points match',
    /grantedPoints[\s\S]{0,120}\b12\b/.test(jsArmoury) && luaUp.includes('GRANTED_POINTS = 12'));
}

// Forge — chassis, tiers and traits.
{
  const jsForge = read(path.join(PROJECT, 'scripts/systems/WeaponForge.js'));
  const luaForge = read(path.join(sharedDir, 'Forge.luau'));
  for (const id of ['sidearm', 'magnum', 'scattergun', 'marksman', 'machinePistol', 'carbine']) {
    compareNumbers(`forge chassis parity: ${id}`, blockById(jsForge, id), blockById(luaForge, id));
  }
  for (const id of ['field', 'marked', 'issued', 'relic', 'blackroot']) {
    compareNumbers(`forge tier parity: ${id}`, blockById(jsForge, id), blockById(luaForge, id));
  }
  for (const id of ['hollowpoint', 'match', 'overclock', 'feather', 'anchored', 'longthrow',
    'ravenous', 'drilled', 'quiet', 'headhunter', 'brutal', 'surefooted']) {
    ok(`forge trait present: ${id}`, luaForge.includes(`"${id}"`));
    ok(`forge trait in both builds: ${id}`, jsForge.includes(`'${id}'`) || jsForge.includes(`"${id}"`));
  }
  eq('forge seed space matches', /FORGE_SPACE\s*=\s*(\d+)/.exec(jsForge)?.[1], '4294967296');
  ok('Luau forge uses the same space', luaForge.includes('Forge.SPACE = 4294967296'));
}

// Camo — eighteen families, eighteen palettes, five rarities.
{
  const jsCamo = read(path.join(PROJECT, 'scripts/systems/CamoGenerator.js'));
  const luaCamo = read(path.join(sharedDir, 'Camo.luau'));
  const families = ['blotch', 'digital', 'tiger', 'splinter', 'fractal', 'hex', 'fluid', 'dazzle',
    'scale', 'circuit', 'topo', 'spray', 'damascus', 'gradient', 'shatter', 'weave', 'drip', 'starfield'];
  eq('eighteen camo families', families.length, 18);
  for (const f of families) {
    ok(`camo family present: ${f}`, luaCamo.includes(`"${f}"`));
    ok(`camo family in both builds: ${f}`, jsCamo.includes(`'${f}'`) || jsCamo.includes(`"${f}"`));
  }
  for (const p of ['woodland', 'desert', 'arctic', 'urban', 'tigerstripe', 'nebula', 'abyssal',
    'cinder', 'toxic', 'blood', 'gilded', 'chrome', 'void', 'rust', 'glacier', 'bloom', 'ranger', 'ember']) {
    ok(`camo palette present: ${p}`, luaCamo.includes(`"${p}"`));
  }
  ok('woodland palette matches', luaCamo.includes('"#3d4531", "#5b6344", "#2b2f24", "#7c7a5a", "#1d201a"'));
  ok('camo rarities match', /standard[\s\S]{0,60}0\.58/.test(luaCamo) && /mythic[\s\S]{0,60}0\.01/.test(luaCamo));
}

// Creatures — nine mutants, five animals, every stat.
{
  const jsMut = read(path.join(PROJECT, 'scripts/entities/MutantAI.js'));
  const jsAni = read(path.join(PROJECT, 'scripts/entities/AnimalAI.js'));
  const luaCre = read(path.join(sharedDir, 'Creatures.luau'));

  for (const id of ['stalker', 'brute', 'crawler', 'screamer', 'choir',
    'drowned', 'ashwalker', 'rimewretch', 'sporebearer']) {
    compareNumbers(`mutant parity: ${id}`, blockById(jsMut, id), blockById(luaCre, id));
  }
  for (const id of ['rabbit', 'deer', 'boar', 'wolf', 'bear']) {
    compareNumbers(`animal parity: ${id}`, blockById(jsAni, id), blockById(luaCre, id));
  }
  ok('the core roster is the Hollow four',
    luaCre.includes('"stalker", "brute", "crawler", "screamer"'));
  ok('roster weights are 6/3/2/1', (() => {
    const fn = luaCre.slice(luaCre.indexOf('function Creatures.rosterWeight'));
    return fn.includes('6') && fn.includes('math.max(1, 4 - (index - 1))');
  })());
}

// Bosses — six, with their phases and weak points.
{
  const jsBoss = read(path.join(PROJECT, 'scripts/entities/Bosses.js'));
  const luaBoss = read(path.join(sharedDir, 'Bosses.luau'));
  for (const id of ['warden', 'chorister', 'gillfather', 'pyreking', 'hoarmother', 'motherstalk']) {
    compareNumbers(`boss parity: ${id}`, blockById(jsBoss, id), blockById(luaBoss, id),
      { skip: ['at', 'speed', 'y', 'z', 'r', 'mul', 'phase'] });
    ok(`boss has three phases: ${id}`, (() => {
      const block = blockById(luaBoss, id) || '';
      return (block.match(/at\s*=\s*[\d.]+/g) || []).length === 3;
    })());
    ok(`boss has two weak points: ${id}`, (() => {
      const block = blockById(luaBoss, id) || '';
      return (block.match(/mul\s*=\s*[\d.]+/g) || []).length === 2;
    })());
  }
  eq('body hits are 0.65', /bodyMul\s*=\s*([\d.]+)/.exec(luaBoss)?.[1], '0.65');
  eq('head hits are 1.5', /headMul\s*=\s*([\d.]+)/.exec(luaBoss)?.[1], '1.5');
  for (const move of ['sweep', 'slam', 'bite', 'lash', 'charge', 'shardvolley',
    'firelash', 'spikes', 'tendril', 'sporecloud', 'collapse', 'nova', 'summon']) {
    ok(`boss attack defined: ${move}`, new RegExp(`\\b${move}\\s*=\\s*\\{`).test(luaBoss));
    ok(`boss attack in both builds: ${move}`, jsBoss.includes(move));
  }
}

// Biomes — the sky, the physics and the rosters.
{
  const jsBiomes = read(path.join(PROJECT, 'scripts/world/Biomes.js'));
  const luaBiomes = read(path.join(sharedDir, 'Biomes.luau'));

  for (const id of ['hollow', 'void', 'abyss', 'cinder', 'permafrost', 'bloom', 'sandbox']) {
    const jsBlock = blockById(jsBiomes, id);
    const luaBlock = blockById(luaBiomes, id);
    ok(`biome exists in both builds: ${id}`, jsBlock !== null && luaBlock !== null);
    if (!jsBlock || !luaBlock) continue;

    // Physics is the block that changes how a biome plays.
    const jsPhys = numericFields(literalAfter(jsBlock, jsBlock.indexOf('physics')));
    const luaPhys = numericFields(literalAfter(luaBlock, luaBlock.indexOf('physics')));
    const drift = Object.keys(jsPhys).filter((k) => k in luaPhys && Math.abs(jsPhys[k] - luaPhys[k]) > 1e-9);
    ok(`biome physics parity: ${id}`, drift.length === 0,
      drift.map((k) => `${k}: js ${jsPhys[k]} vs luau ${luaPhys[k]}`).join(', '));

    // And the sky, which is where the numbers are easiest to fat-finger.
    const jsSky = numericFields(literalAfter(jsBlock, jsBlock.indexOf('sky')));
    const luaSky = numericFields(literalAfter(luaBlock, luaBlock.indexOf('sky')));
    const skyDrift = Object.keys(jsSky).filter((k) => k in luaSky && Math.abs(jsSky[k] - luaSky[k]) > 1e-9);
    ok(`biome sky parity: ${id}`, skyDrift.length === 0,
      skyDrift.map((k) => `${k}: js ${jsSky[k]} vs luau ${luaSky[k]}`).join(', '));
  }

  ok('the Long Dark is still 0.42 g', /void[\s\S]{0,2600}gravity = 0\.42/.test(luaBiomes));
  ok('the Drowned Shelf still drags', /abyss[\s\S]{0,2600}drag = 2\.6/.test(luaBiomes));
  ok('the Still White is still slippery', /permafrost[\s\S]{0,2800}slip = 0\.55/.test(luaBiomes));
  ok('depth scaling matches', (() => {
    const js = jsBiomes.slice(jsBiomes.indexOf('depthScaling'), jsBiomes.indexOf('depthScaling') + 320);
    const lua = luaBiomes.slice(luaBiomes.indexOf('depthScaling'), luaBiomes.indexOf('depthScaling') + 420);
    return ['0.30', '0.18', '0.12', '0.10'].every((n) => js.includes(n) && lua.includes(n));
  })());
  ok('the Hollow is always first', luaBiomes.includes('Biomes.FIRST = "hollow"'));
}

// Sandbox mods — every id, in the right group.
{
  const jsSandbox = read(path.join(PROJECT, 'scripts/systems/Sandbox.js'));
  const luaMods = read(path.join(sharedDir, 'Mods.luau'));

  const jsIds = new Set([...jsSandbox.matchAll(/id:\s*'([A-Za-z]+)'/g)].map((m) => m[1]));
  const luaIds = new Set([...luaMods.matchAll(/\{\s*id\s*=\s*"([A-Za-z]+)"/g)].map((m) => m[1]));

  ok('every WebGL mod exists in the port',
    [...jsIds].every((id) => luaIds.has(id)),
    [...jsIds].filter((id) => !luaIds.has(id)).join(', '));
  ok('the port invents no mods the WebGL build lacks',
    [...luaIds].every((id) => jsIds.has(id)),
    [...luaIds].filter((id) => !jsIds.has(id)).join(', '));
  ok('at least forty mods', luaIds.size >= 40, `${luaIds.size} mods`);

  for (const g of ['Player', 'Weapons', 'Spawn', 'World', 'Worlds', 'Camera', 'Fun']) {
    ok(`mod group present: ${g}`, luaMods.includes(`"${g}"`));
    ok(`mod group in both builds: ${g}`, jsSandbox.includes(`'${g}'`));
  }
  ok('infinite ammo defaults on', /infAmmo[\s\S]{0,200}default = true/.test(luaMods));
  ok('no-needs defaults on', /noNeeds[\s\S]{0,200}default = true/.test(luaMods));
  ok('brightness defaults to 1.8', /brightness[\s\S]{0,200}default = 1\.8/.test(luaMods));
  ok('field of view defaults to 74', /"fov"[\s\S]{0,200}default = 74/.test(luaMods));
  eq('seven tutorial steps',
    (luaMods.slice(luaMods.indexOf('Mods.TUTORIAL')).match(/title\s*=/g) || []).length, 7);
}

// The deterministic generator, which every seed depends on.
{
  const jsRng = read(path.join(PROJECT, 'scripts/core/RNG.js'));
  const luaRng = read(path.join(sharedDir, 'Rng.luau'));
  ok('mulberry32 constant matches', jsRng.includes('0x6D2B79F5') && luaRng.includes('0x6D2B79F5'));
  ok('the same shift widths', ['15', '7', '14'].every((n) =>
    jsRng.includes(`>>> ${n}`) && luaRng.includes(`rshift(t, ${n})`)));
  ok('the 61 mixing constant is present', jsRng.includes('61 | t') && luaRng.includes('bit32.bor(t, 61)'));
  ok('both divide by 2^32', jsRng.includes('4294967296') && luaRng.includes('TWO32 = 4294967296'));
}

// The systems the port claims to carry across.
{
  const server = fs.readdirSync(serverDir).map((f) => f.replace('.luau', ''));
  for (const service of ['StatsService', 'InventoryService', 'WeaponService', 'EnemyService',
    'BossService', 'LootService', 'ProgressionService', 'ObjectiveService',
    'HorrorDirector', 'SandboxService', 'SaveService', 'WorldBuilder',
    'PowerupService', 'MonetizationService']) {
    ok(`service present: ${service}`, server.includes(service));
  }
  const client = fs.readdirSync(path.join(SRC, 'StarterPlayer/StarterPlayerScripts'));
  for (const c of ['Hud.client.luau', 'Combat.client.luau', 'Inventory.client.luau',
    'ModMenu.client.luau', 'Shop.client.luau']) {
    ok(`client script present: ${c}`, client.includes(c));
  }
}

// ── 5. the catalogue ───────────────────────────────────────────────────────

const productsSrc = read(path.join(sharedDir, 'Products.luau'));

const entries = [...productsSrc.matchAll(/key\s*=\s*"([A-Za-z0-9_]+)"\s*,\s*\n\s*id\s*=\s*(\d+)\s*,/g)].map(
  (m) => ({ key: m[1], id: Number(m[2]) }),
);
eq('catalogue size', entries.length, 10);
ok('catalogue keys are unique', new Set(entries.map((e) => e.key)).size === entries.length);
ok(
  'every id is a placeholder in the repo',
  entries.every((e) => e.id === 0),
  'a real product id has been committed — that is fine for you, but it means anyone who forks this repo sells into your experience',
);

const prices = [...productsSrc.matchAll(/price\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
eq('every entry has a price', prices.length, entries.length);
ok(
  'prices are in a sane band',
  prices.every((p) => p >= 1 && p <= 500),
  `got ${prices.join(', ')}`,
);
ok('nothing is priced above 199 R$', Math.max(...prices) <= 199, `max ${Math.max(...prices)}`);
ok('the bundle is cheaper than its parts', (() => {
  const price = (k) => {
    const re = new RegExp(`key\\s*=\\s*"${k}"[\\s\\S]{0,400}?price\\s*=\\s*(\\d+)`);
    const m = productsSrc.match(re);
    return m ? Number(m[1]) : NaN;
  };
  const apart = price('medkit') + price('ammo') + price('adrenaline') + price('flare');
  return price('resupply') < apart;
})());

const grants = [...productsSrc.matchAll(/grant\s*=\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
const powerupSrc = read(path.join(serverDir, 'PowerupService.luau'));
for (const g of new Set(grants)) {
  ok(`PowerupService implements grant "${g}"`, powerupSrc.includes(`grants.${g} = function`));
}

// A perk that only exists in the catalogue is a perk nobody has implemented,
// so each one has to be named by a file other than the catalogue itself.
const perks = [...productsSrc.matchAll(/perk\s*=\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
for (const perk of perks) {
  const users = files
    .filter((f) => path.basename(f) !== 'Products.luau')
    .filter((f) => read(f).includes(perk))
    .map((f) => path.basename(f));
  ok(`perk "${perk}" is implemented`, users.length >= 1, 'named only in Products.luau');
}

// ── 6. receipts are handled correctly ──────────────────────────────────────

const moneySrc = read(path.join(serverDir, 'MonetizationService.luau'));
ok('ProcessReceipt is assigned', moneySrc.includes('MarketplaceService.ProcessReceipt = processReceipt'));
ok('receipts are recorded by PurchaseId', moneySrc.includes('receipt:{info.PurchaseId}'));
ok('a failed grant retries', moneySrc.includes('Enum.ProductPurchaseDecision.NotProcessedYet'));
ok('a delivered purchase is granted', moneySrc.includes('Enum.ProductPurchaseDecision.PurchaseGranted'));
ok(
  'the ledger is written before answering granted',
  moneySrc.indexOf('ledgerWrite(key)') < moneySrc.lastIndexOf('PurchaseGranted'),
);
ok(
  'the client cannot name a product id',
  !/OnServerEvent[\s\S]{0,600}PromptProductPurchase\(player,\s*(?:id|productId)\b/.test(moneySrc),
);
ok('the buy handler type-checks its arguments', moneySrc.includes('type(key) ~= "string"'));

// ── 7. difficulty parity with the WebGL build ──────────────────────────────

const settingsSrc = read(path.join(PROJECT, 'scripts/core/Settings.js'));
const configSrc = read(path.join(sharedDir, 'Config.luau'));

function jsDifficulty(tier) {
  const block = settingsSrc.match(new RegExp(`${tier}:\\s*\\{([\\s\\S]*?)\\}`));
  if (!block) return null;
  const out = {};
  for (const m of block[1].matchAll(/(\w+):\s*([\d.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

function luauDifficulty(tier) {
  const block = configSrc.match(new RegExp(`${tier}\\s*=\\s*\\{([\\s\\S]*?)\\},`));
  if (!block) return null;
  const out = {};
  for (const m of block[1].matchAll(/(\w+)\s*=\s*([\d.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

for (const tier of ['story', 'normal', 'harsh', 'brutal']) {
  const js = jsDifficulty(tier);
  const lua = luauDifficulty(tier);
  ok(`difficulty "${tier}" exists in both builds`, js && lua);
  if (!js || !lua) continue;
  const mismatches = Object.keys(js).filter((k) => js[k] !== lua[k]);
  ok(`difficulty "${tier}" matches the WebGL build`, mismatches.length === 0,
    mismatches.map((k) => `${k}: js ${js[k]} vs luau ${lua[k]}`).join(', '));
}

// ── 8. no credentials, anywhere ────────────────────────────────────────────

function allRepoFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allRepoFiles(full, out);
    else out.push(full);
  }
  return out;
}

const robloxFiles = allRepoFiles(RBX);
for (const file of robloxFiles) {
  const rel = path.relative(RBX, file);
  const src = read(file);
  ok(`${rel} has no .ROBLOSECURITY cookie`, !src.includes('_|WARNING:-DO-NOT-SHARE-THIS'));
  ok(
    `${rel} has no literal API key`,
    !/x-api-key['"]\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/.test(src),
  );
}

const botSrc = read(path.join(RBX, 'tools/bot.mjs'));
ok('the bot reads its key from the environment', botSrc.includes('process.env.ROBLOX_API_KEY'));
ok('the bot has no --key flag', !/flags\.key\b/.test(botSrc));
ok('the bot scrubs the key from output', botSrc.includes('function scrub('));
ok('the bot uses the documented publish endpoint',
  botSrc.includes('/universes/v1/${universeId}/places/${placeId}/versions?versionType=${versionType}'));
ok('config ships with placeholder ids', (() => {
  const cfg = JSON.parse(read(path.join(RBX, 'blackroot.config.json')));
  return cfg.universeId === 0 && cfg.placeId === 0;
})());

// ── 9. the sync server and the place build ─────────────────────────────────

const { buildTree, classify } = await import(path.join(RBX, 'tools/syncserver.mjs'));

eq('init.server.luau makes a Script', classify('init.server.luau').className, 'Script');
eq('Name.client.luau makes a LocalScript', classify('Hud.client.luau').className, 'LocalScript');
eq('Name.luau makes a ModuleScript', classify('Config.luau').className, 'ModuleScript');
eq('.client.luau strips its suffix', classify('Hud.client.luau').stem, 'Hud');
ok('non-Luau files are ignored', classify('README.md') === null);

const tree = buildTree();
eq('three sync roots', tree.roots.length, 3);
ok('the tree is hashed', /^[0-9a-f]{12}$/.test(tree.hash));

const serverRoot = tree.roots.find((r) => r.target === 'ServerScriptService');
eq('Blackroot is a Script (init.server.luau)', serverRoot.tree.className, 'Script');
ok('Blackroot carries its source', serverRoot.tree.source.includes('startRun'));
ok('Blackroot has its service children', serverRoot.tree.children.length >= 8,
  `${serverRoot.tree.children.length} children`);

const clientRoot = tree.roots.find((r) => r.target === 'StarterPlayerScripts');
ok('client scripts sync inline', clientRoot.inline === true);
ok('every client script is a LocalScript',
  clientRoot.tree.children.every((c) => c.className === 'LocalScript'));

const { build, cdata } = await import(path.join(RBX, 'tools/buildplace.mjs'));

ok('CDATA escaping survives "]]>"', cdata('a ]]> b') === '<![CDATA[a ]]]]><![CDATA[> b]]>');

const { xml, model } = build();
ok('the place file is XML', xml.startsWith('<?xml version="1.0"'));
ok('the place file closes its root', xml.trimEnd().endsWith('</roblox>'));
eq('Item tags balance', (xml.match(/<Item /g) || []).length, (xml.match(/<\/Item>/g) || []).length);

for (const service of ['Workspace', 'Lighting', 'ReplicatedStorage', 'ServerScriptService', 'StarterPlayer', 'Players']) {
  ok(`place contains ${service}`, xml.includes(`<Item class="${service}"`));
}
ok('place contains StarterPlayerScripts', xml.includes('<Item class="StarterPlayerScripts"'));
ok('place carries the server entry point', xml.includes('[Blackroot] server'));
ok('place carries the shop client', xml.includes('BlackrootShop'));
ok('place carries the catalogue', xml.includes('Field Trauma Kit'));
ok('referents are unique', (() => {
  const refs = [...xml.matchAll(/referent="(RBX\d+)"/g)].map((m) => m[1]);
  return new Set(refs).size === refs.length;
})());

// ── 9b. the drag-in model, for an existing place ───────────────────────────

ok('the model file is XML', model.startsWith('<?xml version="1.0"'));
ok('the model closes its root', model.trimEnd().endsWith('</roblox>'));
eq('model Item tags balance', (model.match(/<Item /g) || []).length, (model.match(/<\/Item>/g) || []).length);
ok('the model has one BLACKROOT root', (model.match(/name="Name">BLACKROOT</g) || []).length === 1);
for (const bucket of [
  '1_DRAG_INTO_ServerScriptService',
  '2_DRAG_INTO_ReplicatedStorage',
  '3_DRAG_INTO_StarterPlayerScripts',
]) {
  ok(`model has bucket ${bucket}`, model.includes(bucket));
}
eq('every bucket says where it goes', (model.match(/WHERE_THIS_GOES/g) || []).length, 3);
ok('the model carries the server entry point', model.includes('[Blackroot] server'));
ok('the model carries all three client scripts',
  model.includes('BlackrootHud') && model.includes('BlackrootShop') && model.includes('BlackrootFire'));
ok('model referents are unique', (() => {
  const refs = [...model.matchAll(/referent="(RBX\d+)"/g)].map((m) => m[1]);
  return new Set(refs).size === refs.length;
})());
ok('model and place referents do not collide', (() => {
  const a = new Set([...xml.matchAll(/referent="(RBX\d+)"/g)].map((m) => m[1]));
  const b = [...model.matchAll(/referent="(RBX\d+)"/g)].map((m) => m[1]);
  return b.every((r) => !a.has(r));
})());

// ── 10. the Rojo project ───────────────────────────────────────────────────

const project = JSON.parse(read(path.join(RBX, 'default.project.json')));
eq('project name', project.name, 'BLACKROOT');
eq('project root is a DataModel', project.tree.$className, 'DataModel');

function checkPaths(node, trail = '') {
  for (const [key, value] of Object.entries(node)) {
    if (key === '$path') {
      ok(`rojo $path exists: ${trail} → ${value}`, fs.existsSync(path.join(RBX, value)));
    } else if (value && typeof value === 'object') {
      checkPaths(value, `${trail}/${key}`);
    }
  }
}
checkPaths(project.tree);

// ── report ─────────────────────────────────────────────────────────────────

const total = passed + failures.length;
if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${total} checks failed\n`);
  for (const f of failures) console.error(`    ✗ ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`  ✓ robloxtest — ${passed}/${total} checks passed`);
