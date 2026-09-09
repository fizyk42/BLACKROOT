/**
 * wsock — a small, dependency-free RFC 6455 server.
 *
 * BLACKROOT ships with exactly one runtime dependency (three), and adding a
 * WebSocket library for a protocol that fits in two hundred lines would be a
 * poor trade: the server has to be something a player can clone and run with
 * `npm run server` without a build step or a native module.
 *
 * What this implements: the upgrade handshake, text and binary data frames,
 * fragmentation (continuation frames), ping/pong, and close. What it does not
 * implement, deliberately: permessage-deflate (our payloads are tiny), and
 * client-side masking (a server never masks).
 *
 * Everything is defensive. A socket on the open internet is hostile input:
 * oversized frames, bad opcodes, unmasked client frames and dribbled TCP
 * chunks all have to end in a clean close rather than a thrown exception in
 * the room loop.
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Anything bigger than this from a client is a bug or an attack, not a move. */
export const MAX_FRAME = 64 * 1024;
export const MAX_MESSAGE = 256 * 1024;

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

export function accept(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

/**
 * A live connection. Emits 'message' (string), 'pong', 'close' and 'error'.
 * `send` accepts a string; objects should be stringified by the caller so the
 * room loop can serialise a snapshot once and fan it out to eight sockets.
 */
export class Conn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.open = true;
    this.alive = true;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this._buf = Buffer.alloc(0);
    this._frags = [];
    this._fragOp = 0;
    this._fragLen = 0;

    socket.on('data', (chunk) => this._feed(chunk));
    socket.on('close', () => this._done());
    socket.on('end', () => this._done());
    socket.on('error', (e) => { this.emit('error', e); this._done(); });
    socket.setNoDelay(true);
  }

  /* ---------------- outbound ---------------- */

  send(data) {
    if (!this.open) return false;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    return this._frame(Buffer.isBuffer(data) ? OP.BIN : OP.TEXT, payload);
  }

  ping(data = '') { return this._frame(OP.PING, Buffer.from(String(data), 'utf8')); }
  pong(payload) { return this._frame(OP.PONG, payload); }

  close(code = 1000, reason = '') {
    if (!this.open || this._closeSent) return;
    const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this._closeSent = true;
    this._frame(OP.CLOSE, p);
    this.open = false;
    // Give the close frame a moment to leave before tearing the socket down.
    setTimeout(() => this.socket.destroy(), 40);
  }

  destroy() { this.open = false; try { this.socket.destroy(); } catch { /* already gone */ } }

  _frame(opcode, payload) {
    if (!this.open && opcode !== OP.CLOSE) return false;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.alloc(2);
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[1] = 127;
      head.writeUInt32BE(0, 2);
      head.writeUInt32BE(len, 6);
    }
    head[0] = 0x80 | opcode;          // FIN + opcode; we never fragment outbound
    this.bytesOut += head.length + len;
    try {
      this.socket.write(head);
      if (len) this.socket.write(payload);
      return true;
    } catch (e) {
      this.emit('error', e);
      this._done();
      return false;
    }
  }

  /* ---------------- inbound ---------------- */

  _feed(chunk) {
    this.bytesIn += chunk.length;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    // A slow client that never completes a frame must not be allowed to grow
    // our heap one byte at a time.
    if (this._buf.length > MAX_FRAME + 16) { this.close(1009, 'frame too large'); return; }
    for (;;) {
      const f = this._read();
      if (!f) break;
      try { this._handle(f); } catch (e) { this.emit('error', e); this.close(1011, 'bad frame'); return; }
      if (!this.open) return;
    }
  }

  /** Pull one whole frame off the buffer, or null if it has not arrived yet. */
  _read() {
    const b = this._buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const rsv = b[0] & 0x70;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (rsv) { this.close(1002, 'reserved bits'); return null; }
    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const hi = b.readUInt32BE(off);
      const lo = b.readUInt32BE(off + 4);
      if (hi !== 0) { this.close(1009, 'too large'); return null; }
      len = lo; off += 8;
    }
    if (len > MAX_FRAME) { this.close(1009, 'too large'); return null; }
    // Clients MUST mask. An unmasked client frame is a protocol violation and
    // is also how a naive proxy-poisoning attempt looks.
    if (!masked) { this.close(1002, 'unmasked'); return null; }
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4); off += 4;
    const payload = Buffer.allocUnsafe(len);
    b.copy(payload, 0, off, off + len);
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    this._buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }

  _handle(f) {
    switch (f.opcode) {
      case OP.PING: this.pong(f.payload); return;
      case OP.PONG: this.alive = true; this.emit('pong', f.payload); return;
      case OP.CLOSE: {
        const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
        this.open = false;
        // Echo the close exactly once. A second close frame is a protocol
        // error at the other end ("close received after close"), and it is
        // easy to reach: the server closes a socket that is already closing.
        if (!this._closeSent) {
          this._closeSent = true;
          this._frame(OP.CLOSE, f.payload.subarray(0, 2));
        }
        setTimeout(() => this.socket.destroy(), 20);
        this.emit('close', code);
        return;
      }
      case OP.TEXT:
      case OP.BIN:
        if (this._frags.length) { this.close(1002, 'interleaved'); return; }
        if (f.fin) { this._deliver(f.opcode, f.payload); return; }
        this._fragOp = f.opcode;
        this._frags = [f.payload];
        this._fragLen = f.payload.length;
        return;
      case OP.CONT: {
        if (!this._frags.length) { this.close(1002, 'orphan continuation'); return; }
        this._fragLen += f.payload.length;
        if (this._fragLen > MAX_MESSAGE) { this.close(1009, 'message too large'); return; }
        this._frags.push(f.payload);
        if (!f.fin) return;
        const whole = Buffer.concat(this._frags, this._fragLen);
        const op = this._fragOp;
        this._frags = []; this._fragLen = 0;
        this._deliver(op, whole);
        return;
      }
      default: this.close(1002, 'bad opcode');
    }
  }

  _deliver(opcode, payload) {
    if (opcode === OP.TEXT) this.emit('message', payload.toString('utf8'));
    else this.emit('binary', payload);
  }

  _done() {
    if (!this.open && this._closedEmitted) return;
    this.open = false;
    if (this._closedEmitted) return;
    this._closedEmitted = true;
    this.emit('close', 1006);
  }
}

/**
 * Attach to a node http server. `onConn(conn, req)` is called once the
 * handshake completes; requests to any other path are left alone so the same
 * server can go on serving the game's files.
 */
export function attach(server, pathname, onConn) {
  server.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    if (url !== pathname) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`
    );
    const conn = new Conn(socket);
    if (head && head.length) conn._feed(head);
    onConn(conn, req);
  });
}
