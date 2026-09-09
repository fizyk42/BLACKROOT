#!/usr/bin/env node
/**
 * installplugin — copy the Studio plugin into Studio's local plugins folder.
 *
 *     node roblox/tools/installplugin.mjs        # or: npm run roblox:plugin
 *
 * Studio loads any .luau file in that folder as a local plugin on startup, so
 * this is the whole install. Restart Studio afterwards and a BLACKROOT toolbar
 * appears. If the folder cannot be found (a portable install, or Studio has
 * never run on this machine), the script prints the path to copy it to by hand
 * rather than guessing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '../plugin/BlackrootSync.server.luau');

function candidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [path.join(local, 'Roblox', 'Plugins')];
  }
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Documents', 'Roblox', 'Plugins'),
      path.join(home, 'Library', 'Application Support', 'Roblox', 'Plugins'),
    ];
  }
  // Linux: Studio runs under Wine/Sober, so the path varies too much to guess.
  return [
    path.join(home, '.local', 'share', 'Roblox', 'Plugins'),
    path.join(home, '.var', 'app', 'org.vinegarhq.Sober', 'data', 'sober', 'Plugins'),
  ];
}

const found = candidates().find((dir) => fs.existsSync(dir));

if (!found) {
  console.log('Could not find a Studio plugins folder on this machine.');
  console.log('\nCopy this file there yourself:');
  console.log(`  ${SOURCE}`);
  console.log('\nThe folder is usually one of:');
  for (const dir of candidates()) console.log(`  ${dir}`);
  console.log('\nOr, inside Studio: paste the file into a Script, right-click it in the');
  console.log('Explorer, and choose "Save as Local Plugin".');
  process.exit(0);
}

const target = path.join(found, 'BlackrootSync.server.luau');
fs.copyFileSync(SOURCE, target);
console.log(`✓ installed to ${target}`);
console.log('  restart Studio, then: npm run roblox:sync  and press SYNC in the BLACKROOT toolbar.');
