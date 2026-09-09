#!/usr/bin/env node
/**
 * syncserver — serves the Luau source tree to the Studio plugin.
 *
 * Roblox Studio cannot read your disk. What it can do is make an HTTP request
 * to localhost, which is how every Roblox source-sync tool works, this one
 * included. Run this, press SYNC in the BLACKROOT toolbar inside Studio, and
 * the plugin rebuilds ServerScriptService.Blackroot, ReplicatedStorage.Shared
 * and StarterPlayerScripts from these files.
 *
 *     node roblox/tools/syncserver.mjs            # or: npm run roblox:sync
 *
 * It binds to 127.0.0.1 only — nothing outside this machine can reach it —
 * serves nothing but .luau files under roblox/src, and refuses any path with
 * a ".." in it. It is a development tool; there is no reason to run it on a
 * server and no way to use it as one.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');
const PORT = Number(process.env.BLACKROOT_SYNC_PORT || 34872);

/**
 * Map a filename to the instance it becomes, the same convention Rojo uses so
 * the two tools agree about this tree.
 *   init.server.luau  → the containing folder becomes a Script
 *   init.luau         → the containing folder becomes a ModuleScript
 *   Name.server.luau  → Script
 *   Name.client.luau  → LocalScript
 *   Name.luau         → ModuleScript
 */
function classify(name) {
  if (name === 'init.server.luau') return { kind: 'init', className: 'Script' };
  if (name === 'init.client.luau') return { kind: 'init', className: 'LocalScript' };
  if (name === 'init.luau') return { kind: 'init', className: 'ModuleScript' };
  if (name.endsWith('.server.luau')) return { kind: 'leaf', className: 'Script', stem: name.slice(0, -12) };
  if (name.endsWith('.client.luau')) return { kind: 'leaf', className: 'LocalScript', stem: name.slice(0, -12) };
  if (name.endsWith('.luau')) return { kind: 'leaf', className: 'ModuleScript', stem: name.slice(0, -5) };
  return null;
}

function walk(dir, name) {
  const node = { name, className: 'Folder', source: null, children: [] };
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      node.children.push(walk(full, entry.name));
      continue;
    }
    const info = classify(entry.name);
    if (!info) continue;
    const source = fs.readFileSync(full, 'utf8');
    if (info.kind === 'init') {
      node.className = info.className;
      node.source = source;
    } else {
      node.children.push({ name: info.stem, className: info.className, source, children: [] });
    }
  }
  return node;
}

function buildTree() {
  const roots = [
    { target: 'ServerScriptService', dir: path.join(SRC, 'ServerScriptService/Blackroot'), name: 'Blackroot' },
    { target: 'ReplicatedStorage', dir: path.join(SRC, 'ReplicatedStorage/Shared'), name: 'Shared' },
    {
      target: 'StarterPlayerScripts',
      dir: path.join(SRC, 'StarterPlayer/StarterPlayerScripts'),
      name: null, // its children go straight into StarterPlayerScripts
    },
  ];

  const out = [];
  for (const r of roots) {
    if (!fs.existsSync(r.dir)) continue;
    const tree = walk(r.dir, r.name || 'StarterPlayerScripts');
    out.push({ target: r.target, inline: r.name === null, tree });
  }
  const payload = { version: 1, generatedAt: new Date().toISOString(), roots: out };
  payload.hash = createHash('sha1').update(JSON.stringify(out)).digest('hex').slice(0, 12);
  return payload;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: 'blackroot-sync' }));
    return;
  }

  if (url.pathname === '/hash') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hash: buildTree().hash }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (url.pathname === '/tree') {
    try {
      const body = JSON.stringify(buildTree());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Only listen when run directly. buildplace.mjs and the test suite import
// buildTree() from here, and importing a module should never open a socket.
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, '127.0.0.1', () => {
    const t = buildTree();
    let count = 0;
    const tally = (n) => {
      if (n.className !== 'Folder') count++;
      n.children.forEach(tally);
    };
    t.roots.forEach((r) => tally(r.tree));
    console.log(`blackroot-sync on http://127.0.0.1:${PORT}  (${count} scripts, tree ${t.hash})`);
    console.log('open Studio, then press SYNC in the BLACKROOT toolbar.');
  });
}

export { buildTree, classify };
