// Multiplayer integration test.
//
// This starts the real server as a child process and connects two independent
// WebSocket clients to it. Nothing is mocked: the room code is the one the server
// generated, the movement one client sees is the movement the other one sent, and
// the duplicate-reward rejection is the server's own decision.
//
// Run with: npm run test:net

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}/ws`;

let passed = 0, failed = 0;
const log = [];

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TestClient {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.byType = new Map();
    this.ws = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS);
      this.ws = ws;
      ws.on('open', resolve);
      ws.on('error', reject);
      ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch (e) { return; }
        this.messages.push(m);
        if (!this.byType.has(m.t)) this.byType.set(m.t, []);
        this.byType.get(m.t).push(m);
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  last(t) { const a = this.byType.get(t); return a ? a[a.length - 1] : null; }
  all(t) { return this.byType.get(t) || []; }
  /** Wait until a message of type `t` satisfying `pred` arrives. */
  async wait(t, pred = () => true, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hit = (this.byType.get(t) || []).find(pred);
      if (hit) return hit;
      await sleep(25);
    }
    throw new Error(`${this.name}: timed out waiting for "${t}"`);
  }
  close() { try { this.ws.close(); } catch (e) { /* already gone */ } }
}

async function main() {
  console.log('\nStarting the real server on port ' + PORT);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push('ERR ' + String(d)));

  // Wait for the HTTP server to answer.
  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/healthz');
      if (r.ok) { up = true; break; }
    } catch (e) { /* not listening yet */ }
    await sleep(100);
  }
  check('server starts and answers /healthz', up, log.join(''));
  if (!up) { child.kill(); process.exit(1); }

  console.log('\nStatic file serving');
  const idx = await fetch(BASE + '/');
  const idxText = await idx.text();
  check('serves index.html', idx.ok && idxText.includes('PACIFIC'));
  const mainJs = await fetch(BASE + '/src/main.js');
  check('serves client modules with a JavaScript MIME type',
    mainJs.ok && (mainJs.headers.get('content-type') || '').includes('javascript'));
  const three = await fetch(BASE + '/vendor/three/three.module.js');
  check('serves the vendored three.js build', three.ok);
  const gltf = await fetch(BASE + '/assets/characters/citizen.gltf');
  check('serves the character asset', gltf.ok);
  const missing = await fetch(BASE + '/nope.txt');
  check('returns 404 for unknown paths', missing.status === 404);
  const traversal = await fetch(BASE + '/../server/server.js');
  check('refuses to serve files outside the client directory', traversal.status !== 200 || !(await traversal.text()).includes('WebSocketServer'));

  console.log('\nHandshake and room codes');
  const host = new TestClient('host');
  const guest = new TestClient('guest');
  await host.connect();
  await guest.connect();
  check('two clients connect at the same time', host.ws.readyState === 1 && guest.ws.readyState === 1);

  host.send({ t: 'hello', name: 'Maya' });
  guest.send({ t: 'hello', name: 'Dante' });
  const hw = await host.wait('welcome');
  const gw = await guest.wait('welcome');
  check('server issues a session token to each client', !!hw.token && !!gw.token && hw.token !== gw.token);
  check('each client gets a distinct id', hw.id !== gw.id);
  check('starting balance comes from the server', hw.wallet.money === 500, JSON.stringify(hw.wallet));

  host.send({ t: 'create' });
  const room = await host.wait('room');
  const code = room.code;
  check('host receives a six-digit room code', /^\d{6}$/.test(code), 'got ' + code);

  const lookupGood = await (await fetch(`${BASE}/api/room-exists?code=${code}`)).json();
  check('the code resolves in the lobby lookup', lookupGood.exists === true && lookupGood.players === 1);
  const lookupBad = await (await fetch(`${BASE}/api/room-exists?code=000000`)).json();
  check('an unallocated code does not resolve', lookupBad.exists === false || code === '000000');
  const lookupJunk = await (await fetch(`${BASE}/api/room-exists?code=abcdef`)).json();
  check('a malformed code is rejected by the lookup', lookupJunk.exists === false);

  guest.send({ t: 'join', code: '999999' === code ? '888888' : '999999' });
  const err = await guest.wait('error');
  check('joining a nonexistent room returns a clear error', err.message === 'no-such-room');

  guest.send({ t: 'join', code });
  const guestRoom = await guest.wait('room');
  check('guest joins using the code the host was given', guestRoom.code === code);
  const joined = await host.wait('joined');
  check('host is told who joined', joined.name === 'Dante');
  check('roster shows both players', guestRoom.roster.length === 2 || joined.roster.length === 2);
  check('host flag is set on the host only',
    joined.roster.find((r) => r.name === 'Maya').host === true &&
    joined.roster.find((r) => r.name === 'Dante').host === false);

  console.log('\nState replication');
  // The host drives east; the guest should see it in the snapshot stream.
  for (let i = 0; i < 12; i++) {
    host.send({
      t: 'state', x: 100 + i * 5, y: 0, z: 250, yaw: 1.57, speed: 18,
      anim: 'Driving_Loop', health: 100,
      veh: { spec: 'sports', colour: 0xb02c22, yaw: 1.57 },
    });
    await sleep(40);
  }
  await sleep(200);
  const snap = await guest.wait('snapshot', (m) => m.players.some((p) => p.id === hw.id && p.x > 140));
  const seen = snap.players.find((p) => p.id === hw.id);
  check('guest receives the host position from the server', seen && seen.x > 140, JSON.stringify(seen));
  check('guest receives the host vehicle', !!(seen && seen.veh) && seen.veh.spec === 'sports');
  check('guest receives the host animation state', seen.anim === 'Driving_Loop');
  check('snapshots include the guest itself so clients can filter locally',
    snap.players.some((p) => p.id === gw.id));

  const snapCount = guest.all('snapshot').length;
  await sleep(1000);
  const rate = guest.all('snapshot').length - snapCount;
  check('snapshots arrive at roughly 20 Hz', rate >= 14 && rate <= 26, `measured ${rate}/s`);

  console.log('\nChat');
  guest.send({ t: 'chat', text: 'code worked' });
  const chat = await host.wait('chat');
  check('chat reaches the other player', chat.text === 'code worked' && chat.from === 'Dante');

  console.log('\nServer-authoritative money');
  host.send({ t: 'claim', id: 'job_delivery_1', kind: 'delivery', amount: 900 });
  const c1 = await host.wait('claim-result', (m) => m.id === 'job_delivery_1');
  check('a first reward claim is paid', c1.ok === true && c1.amount === 900);
  check('the wallet the server returns reflects the payment', c1.wallet.money === 1400, JSON.stringify(c1.wallet));

  host.send({ t: 'claim', id: 'job_delivery_1', kind: 'delivery', amount: 900 });
  const c2 = await host.wait('claim-result', (m) => m.id === 'job_delivery_1' && m.ok === false);
  check('replaying the same claim is refused', c2.ok === false && c2.reason === 'already-claimed');
  check('the refused replay did not change the balance', c2.wallet.money === 1400);

  host.send({ t: 'claim', id: 'job_delivery_2', kind: 'delivery', amount: 999999 });
  const c3 = await host.wait('claim-result', (m) => m.id === 'job_delivery_2');
  check('an inflated payout is clamped to the band the server allows',
    c3.ok === true && c3.amount === 3000, 'paid ' + c3.amount);

  host.send({ t: 'claim', id: 'job_x', kind: 'not-a-real-kind', amount: 100 });
  const c4 = await host.wait('claim-result', (m) => m.id === 'job_x');
  check('an unknown reward kind is refused', c4.ok === false && c4.reason === 'unknown-reward');

  host.send({ t: 'buy-vehicle', id: 'veh_a', spec: 'sports', colour: 1, price: 4000 });
  const b1 = await host.wait('buy-result', (m) => m.id === 'veh_a');
  check('buying a vehicle debits the server-side wallet', b1.ok === true && b1.wallet.money === 400);
  host.send({ t: 'buy-vehicle', id: 'veh_a', spec: 'sports', colour: 1, price: 0 });
  const b2 = await host.wait('buy-result', (m) => m.ok === false);
  check('the same vehicle id cannot be granted twice', b2.reason === 'already-owned');
  host.send({ t: 'buy-vehicle', id: 'veh_b', spec: 'suv', colour: 1, price: 50000 });
  const b3 = await host.wait('buy-result', (m) => m.reason === 'insufficient');
  check('a purchase beyond the balance is refused', b3.ok === false);

  console.log('\nReconnection cannot duplicate progress');
  const walletBefore = c3.wallet.money;
  host.close();
  await sleep(300);
  const host2 = new TestClient('host-again');
  await host2.connect();
  host2.send({ t: 'hello', name: 'Maya', token: hw.token });
  const rw = await host2.wait('welcome');
  check('reconnecting with the saved token restores the same profile',
    rw.wallet.money === 400, `expected 400, got ${rw.wallet.money} (was ${walletBefore} before the vehicle purchase)`);
  check('the reward ledger survives the reconnection', rw.wallet.ledger.includes('job_delivery_1'));

  host2.send({ t: 'claim', id: 'job_delivery_1', kind: 'delivery', amount: 900 });
  const c5 = await host2.wait('claim-result', (m) => m.id === 'job_delivery_1');
  check('a reward claimed before the disconnect is still refused after it',
    c5.ok === false && c5.reason === 'already-claimed');
  check('the balance is unchanged by the replayed claim', c5.wallet.money === 400);

  console.log('\nLeaving and cleanup');
  const guestBefore = guest.all('left').length;
  host2.send({ t: 'join', code });
  await host2.wait('room');
  host2.send({ t: 'leave' });
  await guest.wait('left', (m) => guest.all('left').length > guestBefore);
  check('the remaining player is told when someone leaves', true);

  guest.send({ t: 'leave' });
  await sleep(250);
  const afterEmpty = await (await fetch(`${BASE}/api/room-exists?code=${code}`)).json();
  check('the room code is released once the room empties', afterEmpty.exists === false);

  const stats = await (await fetch(BASE + '/healthz')).json();
  check('server reports zero live rooms afterwards', stats.rooms === 0, JSON.stringify(stats));

  console.log('\nRobustness');
  const junk = new TestClient('junk');
  await junk.connect();
  junk.ws.send('this is not json');
  junk.send({ t: 'state', x: 'NaN', z: {} });   // no hello, garbage payload
  junk.send({ t: 'unknown-message-type' });
  await sleep(300);
  const stillUp = await fetch(BASE + '/healthz');
  check('malformed messages do not take the server down', stillUp.ok);
  junk.close();

  guest.close();
  host2.close();
  await sleep(200);
  child.kill();
  await sleep(200);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nServer output:\n' + log.join(''));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nTest harness error:', e);
  console.error(log.join(''));
  process.exit(1);
});
