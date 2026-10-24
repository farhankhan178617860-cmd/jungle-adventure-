// server/ws.js
// ---------------------------------------------------------------------------
// Tiny dependency-free WebSocket (RFC 6455) server side: handshake + framing.
// Enough for JSON text messages from browsers. If the project grows you can
// swap this file for the `ws` package; WSConn exposes the same basics:
//   conn.send(string), conn.close(code), conn.on('message'|'close', fn)
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WSConn extends EventEmitter {
  constructor(socket, maxPayload = 8192) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
    this.open = true;
    this.alive = true;
    this.fragOp = 0;
    this.frag = null;
    this.fragLen = 0;
    this.closedEmitted = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => {});
  }

  _onData(chunk) {
    this.alive = true;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        if (buf.readUInt32BE(2) !== 0) return this.close(1009);
        len = buf.readUInt32BE(6); off = 10;
      }
      if (len > this.maxPayload) return this.close(1009);
      if (!masked) return this.close(1002); // clients must mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = buf.subarray(off + 4 + len);
      this._frame(fin, op, payload);
      if (!this.open) return;
    }
  }

  _frame(fin, op, payload) {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this._write(0xa, payload); return; }
    if (op === 0xa) { this.alive = true; return; }
    if (op === 0x1 || op === 0x2) {
      this.fragOp = op; this.frag = [payload]; this.fragLen = payload.length;
    } else if (op === 0x0) {
      if (!this.frag) return this.close(1002);
      this.frag.push(payload); this.fragLen += payload.length;
    } else return this.close(1002);
    if (this.fragLen > this.maxPayload) return this.close(1009);
    if (!fin) return;
    const data = Buffer.concat(this.frag);
    const isText = this.fragOp === 0x1;
    this.frag = null; this.fragLen = 0;
    if (isText) this.emit('message', data.toString('utf8'));
  }

  _write(op, payload) {
    if (!this.open && op !== 0x8) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(len, 6); }
    if (this.socket.writableLength > 1 << 20) { this.terminate(); return; } // very slow client
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(str) { if (this.open) this._write(0x1, Buffer.from(str, 'utf8')); }
  ping() { if (this.open) this._write(0x9, Buffer.alloc(0)); }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    this._write(0x8, p);
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this._closed();
  }

  terminate() { this.open = false; this.socket.destroy(); this._closed(); }

  _closed() {
    this.open = false;
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.emit('close');
  }
}

// Performs the HTTP -> WebSocket upgrade. Returns a WSConn or null (and answers the error itself).
export function acceptUpgrade(req, socket, { maxPayload } = {}) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const reject = (code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
    return null;
  };
  if (upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') return reject(400, 'Bad Request');
  // Block cross-site WebSocket hijacking: a browser page from another site must not talk to us.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* ignore */ }
    if (host !== req.headers.host) return reject(403, 'Forbidden');
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return new WSConn(socket, maxPayload);
}
