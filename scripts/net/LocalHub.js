/**
 * LocalHub — co-op with no server at all.
 *
 * The dedicated server is the right answer for playing with someone in another
 * house. It is the wrong answer for the far more common case: one person who
 * has just double-clicked an HTML file, pressed CO-OP, and been told *"Could
 * not reach the server."* — which is true, and completely useless, because
 * there is no server and they were never told they needed to start one.
 *
 * So when the socket cannot be reached, the game runs the room itself. This is
 * the *same* room code from `server/protocol.mjs`, driven over a message bus
 * between browser windows instead of over TCP: one window hosts, gets a code,
 * and anyone who opens the game in another window or tab on the same computer
 * and types that code lands in the same world. Same codes, same seed sharing,
 * same rift handling, same downed-and-revived — because it is the same code.
 *
 * The bus is a BroadcastChannel where one exists, and falls back to
 * localStorage `storage` events where it does not — notably pages opened from
 * `file://`, where a BroadcastChannel is not shared between windows in every
 * browser. Both are same-origin-only, which is precisely the boundary of what
 * this can honestly do: this makes co-op work *on one computer*, and it says
 * so rather than pretending otherwise.
 */
import { Hub, LIMITS } from '../../server/rooms.js';
import { doHello, handle, tickRooms, TICK_HZ } from '../../server/protocol.js';

const BUS = 'blackroot.coop.bus';
const ADVERT = 'blackroot.coop.rooms';
const ADVERT_TTL = 8000;

/* ================= the bus ================= */

/**
 * A same-origin message bus between windows. Two mechanisms, because neither
 * works everywhere: BroadcastChannel is clean but is not shared between
 * `file://` windows in some browsers, and the localStorage `storage` event is
 * shared but only fires in *other* windows, never the one that wrote it.
 */
class LocalBus {
  constructor() {
    this.subs = new Set();
    this.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this._seen = new Set();

    try {
      this.channel = new BroadcastChannel(BUS);
      this.channel.onmessage = (e) => this._deliver(e.data);
    } catch { this.channel = null; }

    this._onStorage = (e) => {
      if (e.key !== BUS || !e.newValue) return;
      try { this._deliver(JSON.parse(e.newValue)); } catch { /* torn write */ }
    };
    try { window.addEventListener('storage', this._onStorage); } catch { /* no window */ }
  }

  post(msg) {
    const framed = { ...msg, _n: `${this.id}:${(this._seq = (this._seq || 0) + 1)}` };
    if (this.channel) { try { this.channel.postMessage(framed); } catch { /* closed */ } }
    // The storage path is a fallback *and* a belt: on file:// it may be the
    // only thing that crosses windows.
    try { localStorage.setItem(BUS, JSON.stringify(framed)); } catch { /* full or private */ }
    // Neither transport echoes to the window that sent the message, so the
    // common case — one window hosting a room *and* playing in it — would
    // never hear itself. Deliver locally too; the sequence number keeps a
    // remote echo from being handled twice.
    setTimeout(() => this._deliver(framed), 0);
  }

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }

  _deliver(msg) {
    if (!msg || !msg._n) return;
    // Both transports may carry the same message. Deliver it once.
    if (this._seen.has(msg._n)) return;
    this._seen.add(msg._n);
    if (this._seen.size > 400) this._seen = new Set([...this._seen].slice(-200));
    for (const fn of this.subs) { try { fn(msg); } catch (e) { console.warn('[coop]', e); } }
  }

  close() {
    try { this.channel?.close(); } catch { /* already */ }
    try { window.removeEventListener('storage', this._onStorage); } catch { /* none */ }
    this.subs.clear();
  }
}

let bus = null;
const theBus = () => (bus = bus || new LocalBus());

/* ================= the host side ================= */

/**
 * One window owns the rooms it created and runs their tick. Everything the
 * dedicated server does per socket, this does per bus peer.
 */
class LocalServer {
  constructor() {
    this.hub = new Hub({ log: () => {} });
    this.peers = new Map();          // peerId -> { conn, player }
    this.bus = theBus();
    this._off = this.bus.on((m) => this._onBus(m));
    this._tick = setInterval(() => tickRooms(this.hub), Math.round(1000 / TICK_HZ));
    this._advert = setInterval(() => this._advertise(), 2500);
    this._advertise();
  }

  get rooms() { return this.hub.rooms; }

  /** Publish which codes this window is hosting, so a joiner can find them. */
  _advertise() {
    try {
      const now = Date.now();
      const all = JSON.parse(localStorage.getItem(ADVERT) || '{}');
      for (const [code, at] of Object.entries(all)) if (now - at > ADVERT_TTL) delete all[code];
      for (const code of this.hub.rooms.keys()) all[code] = now;
      localStorage.setItem(ADVERT, JSON.stringify(all));
    } catch { /* private mode: joining by code still works, listing does not */ }
  }

  _onBus(m) {
    if (m.to !== 'server') return;
    if (m.k === 'open') { this._accept(m.from, m.hello); return; }
    const peer = this.peers.get(m.from);
    if (!peer) {
      // A message from a peer we do not know: it belongs to a different
      // window's room, or ours went away. Silence is correct.
      return;
    }
    if (m.k === 'msg') {
      if (!peer.player) return;
      const text = JSON.stringify(m.d);
      if (!peer.player.charge(text.length)) { peer.conn.close(4029, 'too fast'); return; }
      handle(peer.player, m.d);
      return;
    }
    if (m.k === 'bye') peer.conn.close(1000, 'bye');
  }

  /**
   * A peer wants in. Build it a connection object shaped like the server's
   * socket wrapper, then hand it to exactly the same hello handler.
   */
  _accept(peerId, hello) {
    if (this.peers.has(peerId)) return;
    const bus = this.bus;
    const conn = {
      alive: true,
      open: true,
      send: (str) => { if (conn.open) bus.post({ to: peerId, k: 'msg', d: JSON.parse(str) }); },
      ping: () => { conn.alive = true; },
      close: (code, reason) => {
        if (!conn.open) return;
        conn.open = false;
        bus.post({ to: peerId, k: 'close', code, reason });
        this._drop(peerId);
      },
    };
    // Only answer for codes we actually host — otherwise every window would
    // reply "no such room" to every join and the real host's welcome would be
    // buried in refusals.
    if (!hello.host) {
      const code = String(hello.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!this.hub.get(code)) return;
    }
    const player = doHello(this.hub, conn, hello, 'this computer');
    if (!player) return;               // doHello already sent the refusal
    this.peers.set(peerId, { conn, player });
    this._advertise();
  }

  _drop(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    const p = peer.player;
    const room = p?.room;
    if (room) {
      room.remove(p);
      room.broadcast({ t: 'left', id: p.id, name: p.name });
      if (!room.size) this.hub.rooms.delete(room.code);
    }
    if (p) p.room = null;
    this._advertise();
  }

  dispose() {
    clearInterval(this._tick);
    clearInterval(this._advert);
    this._off?.();
    for (const [id, peer] of this.peers) { peer.conn.close(1001, 'host left'); this.peers.delete(id); }
    try {
      const all = JSON.parse(localStorage.getItem(ADVERT) || '{}');
      for (const code of this.hub.rooms.keys()) delete all[code];
      localStorage.setItem(ADVERT, JSON.stringify(all));
    } catch { /* private mode */ }
    this.hub.rooms.clear();
  }
}

let server = null;
export function localServer() { return (server = server || new LocalServer()); }
export function localRoomCount() { return server ? server.rooms.size : 0; }

/** Codes currently hosted by any window on this computer. */
export function localRooms() {
  try {
    const now = Date.now();
    const all = JSON.parse(localStorage.getItem(ADVERT) || '{}');
    return Object.entries(all).filter(([, at]) => now - at < ADVERT_TTL).map(([code]) => code);
  } catch { return []; }
}

/* ================= the client side ================= */

/**
 * A WebSocket-shaped object backed by the bus.
 *
 * NetClient does not need to know which transport it got — it sets `onopen`,
 * `onmessage`, `onclose`, calls `send`, and reads `readyState`. Presenting the
 * same shape here is what lets one client implementation serve both, rather
 * than growing a second code path that only the local case exercises.
 */
export class LocalSocket {
  constructor(hello) {
    this.readyState = 0;                     // CONNECTING
    this.local = true;
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    this._bus = theBus();
    this._id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this._hello = hello;

    // Hosting is done by this very window; joining looks for whoever is.
    if (hello.host) localServer();

    this._off = this._bus.on((m) => {
      if (m.to !== this._id) return;
      if (m.k === 'msg') { this.onmessage?.({ data: JSON.stringify(m.d) }); return; }
      if (m.k === 'close') this._shut(m.code || 1000, m.reason || '');
    });

    // Give the host window a moment to answer. Nobody home is the normal
    // outcome of a mistyped code, and it has to read as that rather than as a
    // network failure.
    this._timer = setTimeout(() => {
      // Gated on having been *welcomed*, not on the socket being open: this
      // socket reports itself open the moment it is constructed, so testing
      // readyState here would let a code nobody is hosting look like a
      // successful connection that simply never says anything.
      if (this._accepted || this.readyState === 3) return;
      this.onmessage?.({
        data: JSON.stringify({
          t: 'err', code: 'nosuch',
          m: hello.host
            ? 'Could not open a room on this computer.'
            : `No game with the code ${(hello.code || '').toUpperCase() || '—'} on this computer. `
              + 'For a friend on another machine, one of you has to run the server.',
        }),
      });
      this._shut(4404, 'no local room');
    }, 900);

    // Opened on the next turn of the loop so callers can attach handlers first.
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
      this._bus.post({ to: 'server', k: 'open', from: this._id, hello: this._hello });
    }, 0);
  }

  send(str) {
    if (this.readyState !== 1) return;
    let d;
    try { d = JSON.parse(str); } catch { return; }
    // The welcome is the proof somebody answered; stop the "nobody home" timer.
    this._bus.post({ to: 'server', k: 'msg', from: this._id, d });
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this._bus.post({ to: 'server', k: 'bye', from: this._id });
    this._shut(code, reason);
  }

  /** Called by NetClient the moment a welcome lands, so the timer stands down. */
  accepted() { this._accepted = true; clearTimeout(this._timer); }

  _shut(code, reason) {
    if (this.readyState === 3) return;
    clearTimeout(this._timer);
    this.readyState = 3;
    this._off?.();
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }
}

export { LIMITS };
