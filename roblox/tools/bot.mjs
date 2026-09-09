#!/usr/bin/env node
/**
 * blackroot-bot — the Roblox side of the build pipeline.
 *
 * What it is: a small command-line agent that holds your Roblox Open Cloud
 * API key and does the repetitive things for you — publish a place, push a
 * live message into a running server, read and write DataStore entries, and
 * patch product ids into the Luau catalogue.
 *
 * What it is NOT: a way around Roblox's rules. It authenticates with an Open
 * Cloud API key that YOU create, scoped to YOUR experience, and it can only do
 * what that key is permitted to do. It never asks for your Roblox password and
 * never touches a .ROBLOSECURITY cookie. If a tutorial anywhere tells you to
 * paste your account cookie into a script, close the tab.
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 * The key is read from the environment, never from a file in this repo and
 * never from the command line (arguments show up in your shell history and in
 * `ps`). Set it for one shell session:
 *
 *     export ROBLOX_API_KEY='…'          # macOS / Linux
 *     $env:ROBLOX_API_KEY='…'            # Windows PowerShell
 *
 * Create the key at create.roblox.com → Open Cloud → API Keys, add the
 * permissions each command lists below, and restrict it to your own IP range
 * if you can. The key is printed nowhere: not in errors, not in --verbose.
 *
 * ── Commands ──────────────────────────────────────────────────────────────
 *   whoami                       check the key and show the universe it reaches
 *   publish [--file <path>]      publish a .rbxl/.rbxlx as a live version
 *   save    [--file <path>]      upload as a saved (not live) version
 *   watch   [--file <path>]      re-publish whenever the file changes
 *   announce <topic> <message>   push a message to every running server
 *   ds-get <store> <key>         read a DataStore entry
 *   ds-set <store> <key> <json>  write a DataStore entry
 *   products --set k=id [k=id…]  paste product ids into Products.luau
 *   passes   --set k=id [k=id…]  paste game pass ids into Products.luau
 *   ids                          show which catalogue entries are still 0
 *
 * ── Config ────────────────────────────────────────────────────────────────
 * universeId and placeId come from roblox/blackroot.config.json, or from
 * --universe / --place, or from ROBLOX_UNIVERSE_ID / ROBLOX_PLACE_ID.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG_PATH = path.join(ROOT, 'blackroot.config.json');
const PRODUCTS_PATH = path.join(ROOT, 'src/ReplicatedStorage/Shared/Products.luau');

const API = 'https://apis.roblox.com';

// ── plumbing ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const command = argv[0];
const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  } else {
    positional.push(a);
  }
}

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  gold: (s) => `\x1b[33m${s}\x1b[0m`,
};

function die(message, hint) {
  console.error(`${c.red('✗')} ${message}`);
  if (hint) console.error(c.dim(`  ${hint}`));
  process.exit(1);
}

function loadConfig() {
  let file = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      die(`blackroot.config.json is not valid JSON: ${e.message}`);
    }
  }
  const universeId = flags.universe || process.env.ROBLOX_UNIVERSE_ID || file.universeId;
  const placeId = flags.place || process.env.ROBLOX_PLACE_ID || file.placeId;
  return { ...file, universeId, placeId };
}

function apiKey() {
  const key = process.env.ROBLOX_API_KEY;
  if (!key) {
    die(
      'ROBLOX_API_KEY is not set.',
      "Create a key at create.roblox.com → Open Cloud → API Keys, then: export ROBLOX_API_KEY='…'",
    );
  }
  return key;
}

/** Never let the key reach a log line, even by accident. */
function scrub(text) {
  const key = process.env.ROBLOX_API_KEY;
  if (!key) return text;
  return String(text).split(key).join('<ROBLOX_API_KEY>');
}

async function call(method, url, { body, contentType, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'x-api-key': apiKey(),
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(headers || {}),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    const where = url.replace(/\/\/[^/]+/, '//apis.roblox.com');
    let detail = scrub(text).slice(0, 600);
    if (res.status === 401 || res.status === 403) {
      detail += '\n  Usually this means the key exists but lacks the permission this call needs,';
      detail += '\n  or the key is IP-restricted and your address is not on the list.';
    }
    if (res.status === 404) {
      detail += '\n  Check universeId and placeId — a place id is not a universe id.';
    }
    die(`${method} ${where} → ${res.status}`, detail);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function requireUniverse(cfg) {
  if (!cfg.universeId || String(cfg.universeId) === '0') {
    die(
      'No universeId.',
      'Put it in roblox/blackroot.config.json, or pass --universe <id>. Find it at create.roblox.com → your experience → the number in the URL.',
    );
  }
  return cfg.universeId;
}

function requirePlace(cfg) {
  if (!cfg.placeId || String(cfg.placeId) === '0') {
    die('No placeId.', 'Put it in roblox/blackroot.config.json, or pass --place <id>.');
  }
  return cfg.placeId;
}

function resolvePlaceFile(cfg) {
  const rel = flags.file || cfg.placeFile || 'build/BLACKROOT.rbxlx';
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    die(
      `No place file at ${abs}`,
      'Run `npm run roblox:place` to generate one from the Luau sources, or point --file at a .rbxl you saved out of Studio.',
    );
  }
  return abs;
}

// ── commands ────────────────────────────────────────────────────────────────

const commands = {};

commands.whoami = async () => {
  const cfg = loadConfig();
  const universeId = requireUniverse(cfg);
  // Needs: universe.read (Open Cloud v2 "Read" on the experience).
  const info = await call('GET', `${API}/cloud/v2/universes/${universeId}`);
  console.log(`${c.green('✓')} key works`);
  console.log(`  universe  ${universeId}`);
  if (info && typeof info === 'object') {
    if (info.displayName) console.log(`  name      ${info.displayName}`);
    if (info.visibility) console.log(`  visibility ${info.visibility}`);
  }
  if (cfg.placeId) console.log(`  place     ${cfg.placeId}`);
};

async function upload(versionType) {
  const cfg = loadConfig();
  const universeId = requireUniverse(cfg);
  const placeId = requirePlace(cfg);
  const file = resolvePlaceFile(cfg);
  const xml = file.endsWith('.rbxlx');

  const body = fs.readFileSync(file);
  const url = `${API}/universes/v1/${universeId}/places/${placeId}/versions?versionType=${versionType}`;
  const out = await call('POST', url, {
    body,
    contentType: xml ? 'application/xml' : 'application/octet-stream',
  });

  const version = out && out.versionNumber;
  const verb = versionType === 'Published' ? 'published' : 'saved';
  console.log(
    `${c.green('✓')} ${verb} ${path.basename(file)} (${(body.length / 1024).toFixed(0)} KB)` +
      (version ? ` as version ${version}` : ''),
  );
  if (versionType === 'Published') {
    console.log(c.dim(`  https://www.roblox.com/games/${placeId}`));
  }
  return version;
}

commands.publish = () => upload('Published');
commands.save = () => upload('Saved');

commands.watch = async () => {
  const cfg = loadConfig();
  const file = resolvePlaceFile(cfg);
  console.log(`${c.gold('watching')} ${file}`);
  console.log(c.dim('  every save re-publishes. ctrl-c to stop.'));

  let busy = false;
  let pending = false;
  const run = async () => {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      await upload('Published');
    } catch (e) {
      console.error(c.red(scrub(e.message)));
    }
    busy = false;
    if (pending) {
      pending = false;
      setTimeout(run, 250);
    }
  };

  let timer = null;
  fs.watch(file, () => {
    clearTimeout(timer);
    timer = setTimeout(run, 400); // editors write in bursts
  });
  await new Promise(() => {});
};

commands.announce = async () => {
  const cfg = loadConfig();
  const universeId = requireUniverse(cfg);
  const [topic, ...rest] = positional;
  const message = rest.join(' ');
  if (!topic || !message) die('usage: bot announce <topic> <message…>');
  // Needs: universe-messaging-service:publish
  await call('POST', `${API}/messaging-service/v1/universes/${universeId}/topics/${topic}`, {
    body: JSON.stringify({ message }),
    contentType: 'application/json',
  });
  console.log(`${c.green('✓')} sent to every running server on topic "${topic}"`);
};

function dsUrl(universeId, store, key) {
  const q = new URLSearchParams({ datastoreName: store, entryKey: key });
  return `${API}/datastores/v1/universes/${universeId}/standard-datastores/datastore/entries/entry?${q}`;
}

commands['ds-get'] = async () => {
  const cfg = loadConfig();
  const universeId = requireUniverse(cfg);
  const [store, key] = positional;
  if (!store || !key) die('usage: bot ds-get <datastore> <key>');
  // Needs: universe-datastores.objects:read
  const out = await call('GET', dsUrl(universeId, store, key));
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
};

commands['ds-set'] = async () => {
  const cfg = loadConfig();
  const universeId = requireUniverse(cfg);
  const [store, key, ...rest] = positional;
  const raw = rest.join(' ');
  if (!store || !key || !raw) die('usage: bot ds-set <datastore> <key> <json>');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw; // a bare string is a perfectly good entry
  }
  const body = JSON.stringify(value);
  // Roblox wants a content-md5 of the body; node has it built in.
  const { createHash } = await import('node:crypto');
  const md5 = createHash('md5').update(body).digest('base64');
  // Needs: universe-datastores.objects:create and :update
  await call('POST', dsUrl(universeId, store, key), {
    body,
    contentType: 'application/json',
    headers: { 'content-md5': md5 },
  });
  console.log(`${c.green('✓')} wrote ${store}/${key}`);
};

// ── catalogue patching ──────────────────────────────────────────────────────

function readProducts() {
  if (!fs.existsSync(PRODUCTS_PATH)) die(`Products.luau not found at ${PRODUCTS_PATH}`);
  return fs.readFileSync(PRODUCTS_PATH, 'utf8');
}

/** Find `key = "x", …  id = N,` pairs so we can report and rewrite them. */
function scanCatalogue(src) {
  const entries = [];
  const re = /key\s*=\s*"([A-Za-z0-9_]+)"\s*,\s*\n\s*id\s*=\s*(\d+)\s*,/g;
  let m;
  while ((m = re.exec(src))) {
    entries.push({ key: m[1], id: Number(m[2]), index: m.index, match: m[0] });
  }
  return entries;
}

function patchIds(pairs) {
  let src = readProducts();
  const known = new Set(scanCatalogue(src).map((e) => e.key));
  const applied = [];

  for (const [key, id] of pairs) {
    if (!known.has(key)) {
      die(`no catalogue entry called "${key}"`, `known keys: ${[...known].join(', ')}`);
    }
    if (!/^\d+$/.test(String(id))) die(`"${id}" is not a product id`);
    const re = new RegExp(`(key\\s*=\\s*"${key}"\\s*,\\s*\\n\\s*id\\s*=\\s*)\\d+`, 'm');
    src = src.replace(re, `$1${id}`);
    applied.push(`${key} → ${id}`);
  }

  fs.writeFileSync(PRODUCTS_PATH, src);
  console.log(`${c.green('✓')} patched Products.luau`);
  for (const line of applied) console.log(`  ${line}`);
  console.log(c.dim('  re-sync Studio (or re-run npm run roblox:place) to pick these up.'));
}

function parsePairs() {
  const raw = flags.set;
  const list = [];
  if (typeof raw === 'string') list.push(raw);
  for (const p of positional) list.push(p);
  const pairs = [];
  for (const item of list) {
    const eq = item.indexOf('=');
    if (eq < 0) die(`expected key=id, got "${item}"`);
    pairs.push([item.slice(0, eq).trim(), item.slice(eq + 1).trim()]);
  }
  if (pairs.length === 0) {
    die(
      'nothing to set',
      'usage: bot products --set medkit=1234567 ammo=1234568   (ids come from the dashboard URL: …/developer-products/<ID>)',
    );
  }
  return pairs;
}

commands.products = () => patchIds(parsePairs());
commands.passes = () => patchIds(parsePairs());

commands.ids = () => {
  const entries = scanCatalogue(readProducts());
  const missing = entries.filter((e) => e.id === 0);
  console.log(`${entries.length - missing.length}/${entries.length} catalogue entries have real ids.`);
  if (missing.length) {
    console.log(c.gold('\nstill placeholders:'));
    for (const e of missing) console.log(`  ${e.key}`);
    console.log(
      c.dim(
        `\nfill them in with:\n  npm run roblox:bot -- products --set ${missing
          .map((e) => `${e.key}=<id>`)
          .join(' ')}`,
      ),
    );
  } else {
    console.log(c.green('everything is configured.'));
  }
};

commands.help = () => {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const doc = text.slice(text.indexOf('/**') + 3, text.indexOf('*/'));
  console.log(doc.replace(/^ ?\* ?/gm, ''));
};

// ── go ──────────────────────────────────────────────────────────────────────

const fn = commands[command];
if (!fn) {
  if (command) console.error(`${c.red('✗')} unknown command "${command}"\n`);
  commands.help();
  process.exit(command ? 1 : 0);
}

// Some commands are synchronous; wrap so both kinds report failures the same.
Promise.resolve()
  .then(fn)
  .catch((e) => {
    console.error(c.red(scrub(e.stack || e.message)));
    process.exit(1);
  });
