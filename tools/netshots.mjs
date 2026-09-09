/**
 * Reference captures of the co-op surfaces: the lobby before and after
 * hosting, and the squad readout with another operator standing in front of
 * you in the world.
 *
 *   node tools/netshots.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8793;
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(root, 'tools/shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });
const srv = spawn(process.execPath, [path.join(root, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', QUIET: '1' },
  stdio: 'ignore',
});
for (let i = 0; i < 60; i++) {
  await sleep(120);
  try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not yet */ }
}

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});

async function client(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.BLACKROOT && window.BLACKROOT.state === "MENU"', null, { timeout: 40000 });
  await page.evaluate((n) => {
    const S = window.BLACKROOT.settings;
    S.applyPreset('low'); S.set('renderScale', 0.3); S.set('viewDistance', 90); S.set('shadows', 'off');
    window.BLACKROOT.net.setName(n);
  }, name);
  return page;
}

const A = await client('VESPER');
const B = await client('KESTREL');

await A.evaluate(() => window.BLACKROOT.coop.show());
await sleep(400);
await A.screenshot({ path: path.join(OUT, 'coop-lobby.png') });

const code = await A.evaluate(async (url) => {
  const g = window.BLACKROOT;
  const seed = 0x51EED;
  await g.net.host(url, { seed, route: g.routeFor(seed) });
  g.coop.show();
  return g.net.code;
}, `ws://127.0.0.1:${PORT}/net`);

await B.evaluate(async ({ url, code }) => {
  await window.BLACKROOT.net.join(url, code);
  window.BLACKROOT.net.say('on your left, watch the treeline');
}, { url: `ws://127.0.0.1:${PORT}/net`, code });

await sleep(1200);
await A.screenshot({ path: path.join(OUT, 'coop-hosted.png') });

await A.evaluate(() => window.BLACKROOT.startCoop());
await A.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 120000 });
await B.evaluate(() => window.BLACKROOT.startCoop());
await B.waitForFunction('window.BLACKROOT.state === "PLAYING"', null, { timeout: 120000 });

// Put the other operator a few metres in front of the camera, lit, and look
// at them: the squad HUD and the nameplate are the point of the shot.
// Freeze the guest's transmissions so the shot can pose them; otherwise their
// real position keeps arriving at 15 Hz and overwrites the pose.
await B.evaluate(() => { window.BLACKROOT.net.send = () => false; });

await A.evaluate(async () => {
  const g = window.BLACKROOT;
  const p = [...g.net.players.values()][0];
  if (!p) return;
  if (!g.flashlight.on) g.flashlight.toggle();
  // Hold the other operator a fixed distance in front of the camera for the
  // duration of the shot: the player is still being simulated, so a one-off
  // placement drifts out from under them.
  const place = () => {
    const c = g.camera;
    const f = new (p.group.position.constructor)();
    c.getWorldDirection(f);
    f.y = 0; f.normalize();
    const rx = -f.z, rz = f.x;
    const x = c.position.x + f.x * 6.0 + rx * -2.6;
    const z = c.position.z + f.z * 6.0 + rz * -2.6;
    const y = g.world.terrain.heightAt(x, z);
    p.buffer.length = 0;
    p.push(p.clock + 0.001, x, y, z, Math.atan2(-f.x, -f.z), 0, 16, 82);
    p.group.position.set(x, y, z);
  };
  for (let i = 0; i < 60; i++) { place(); await new Promise((r) => requestAnimationFrame(r)); }
  // Turn to face wherever they actually ended up.
  const t = p.group.position;
  g.player.yaw = Math.atan2(-(t.x - g.player.position.x), -(t.z - g.player.position.z));
  g.player.pitch = -0.04;
  for (let i = 0; i < 30; i++) { place(); await new Promise((r) => requestAnimationFrame(r)); }
});
await sleep(2500);
await A.screenshot({ path: path.join(OUT, 'coop-ingame.png') });

await browser.close();
srv.kill('SIGKILL');
console.log('shots in tools/shots/: coop-lobby.png, coop-hosted.png, coop-ingame.png');
