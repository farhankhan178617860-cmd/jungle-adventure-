// public/js/net.js
// Thin WebSocket client. Messages are JSON: { t: 'type', ...payload }.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('सर्वर से कनेक्ट नहीं हो पाया।'));
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        const list = this.handlers.get(m.t);
        if (list) for (const fn of [...list]) fn(m);
      };
      ws.onclose = () => { const list = this.handlers.get('close'); if (list) for (const fn of [...list]) fn({}); };
    });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const l = this.handlers.get(type);
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  // send a lobby message and wait for 'joined' (success) or 'error'
  request(msg) {
    return new Promise((resolve, reject) => {
      const done = () => { offJ(); offE(); };
      const offJ = this.on('joined', (m) => { done(); resolve(m); });
      const offE = this.on('error', (m) => { done(); reject(new Error(m.msg || 'त्रुटि')); });
      this.send(msg);
    });
  }
}
