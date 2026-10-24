// server/index.js
// HTTP static server + WebSocket game server (zombies, rooms, missions).
//   npm start            -> http://localhost:3000
//   PORT=8080 npm start  -> custom port (hosting services set PORT themselves)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acceptUpgrade } from './ws.js';
import { RoomManager, cleanName } from './rooms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const LOCAL_THREE = path.join(ROOT, 'node_modules', 'three');
const THREE_VERSION = '0.170.0'; // keep identical to package.json; used when three is not installed (CDN fallback)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

// Import map: use the locally installed three (same origin = fastest, works offline),
// otherwise fall back to the jsDelivr CDN.
function importMap(threeDir) {
  const local = fs.existsSync(path.join(threeDir, 'build', 'three.module.js'));
  const base = local ? '/vendor/three' : `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
  return JSON.stringify({ imports: { three: `${base}/build/three.module.js`, 'three/addons/': `${base}/examples/jsm/` } });
}

const gzCache = new Map(); // file -> { mtime, buf }

// Sends a file with ETag (304 on repeat visits) and gzip: matters a lot for phones on mobile data.
function sendFile(req, res, file, cacheControl = 'no-cache') {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl, ETag: etag, 'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }

    const wantsGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (!wantsGzip) {
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
      return;
    }
    const send = (buf) => {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': buf.length });
      res.end(req.method === 'HEAD' ? undefined : buf);
    };
    const hit = gzCache.get(file);
    if (hit && hit.mtime === st.mtimeMs) { send(hit.buf); return; }
    fs.readFile(file, (e1, raw) => {
      if (e1) { res.writeHead(500); res.end(); return; }
      zlib.gzip(raw, { level: 9 }, (e2, gz) => {
        if (e2) { res.writeHead(500); res.end(); return; }
        gzCache.set(file, { mtime: st.mtimeMs, buf: gz });
        send(gz);
      });
    });
  });
}

function safeJoin(dir, rel) {
  const full = path.normalize(path.join(dir, rel));
  return full === dir || full.startsWith(dir + path.sep) ? full : null;
}

function handleHttp(req, res, threeDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }

  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(500); res.end('index.html missing'); return; }
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(html.replace('<!--IMPORTMAP-->', `<script type="importmap">${importMap(threeDir)}</script>`));
    });
    return;
  }
  let file = null, cache = 'no-cache';
  if (pathname.startsWith('/shared/')) file = safeJoin(SHARED_DIR, pathname.slice(8));
  else if (pathname.startsWith('/vendor/three/')) {
    // only build/ and examples/jsm/ of the three package are public. Check the path AFTER resolving
    // "..", otherwise build/../package.json would slip through.
    const full = safeJoin(threeDir, pathname.slice(14));
    const rel = full && path.relative(threeDir, full).split(path.sep).join('/');
    if (rel && (rel.startsWith('build/') || rel.startsWith('examples/jsm/'))) { file = full; cache = 'public, max-age=86400'; }
  } else file = safeJoin(PUBLIC_DIR, pathname.slice(1));
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  sendFile(req, res, file, cache);
}

// game: optional balance overrides (the tests use this), e.g. { zombieCount: 0 }
// threeDir: where the three package lives (tests point it at a fixture folder)
export function startServer({ port = 3000, host = '0.0.0.0', game = {}, maxRooms = 40, maxConns = 300, threeDir = LOCAL_THREE } = {}) {
  const rooms = new RoomManager(game, { maxRooms });
  const server = http.createServer((req, res) => handleHttp(req, res, threeDir));
  const conns = new Set();

  server.on('upgrade', (req, socket) => {
    if (conns.size >= maxConns) { socket.destroy(); return; }
    const conn = acceptUpgrade(req, socket, { maxPayload: 8192 });
    if (!conn) return;
    conns.add(conn);
    let room = null, player = null;
    let tokens = 60, last = Date.now();

    conn.on('message', (text) => {
      const now = Date.now(); // simple flood protection: 60 burst, 40 msg/s sustained
      tokens = Math.min(60, tokens + ((now - last) / 1000) * 40); last = now;
      if (tokens < 1) return;
      tokens -= 1;

      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (!m || typeof m.t !== 'string') return;

      if (!player) { // lobby phase
        if (m.t === 'create') {
          const r = rooms.create();
          if (!r) return conn.send(JSON.stringify({ t: 'error', msg: 'सर्वर पर अभी बहुत सारे रूम चल रहे हैं। थोड़ी देर बाद कोशिश करो या दोस्त के रूम में जुड़ो।' }));
          room = r;
          player = room.addPlayer(conn, cleanName(m.name, 'खिलाड़ी'));
        } else if (m.t === 'join') {
          const r = rooms.get(m.code);
          if (!r) return conn.send(JSON.stringify({ t: 'error', msg: 'ऐसा कोई रूम नहीं मिला। कोड दोबारा जाँचो।' }));
          if (r.full) return conn.send(JSON.stringify({ t: 'error', msg: 'रूम भरा हुआ है (अधिकतम 4 खिलाड़ी)।' }));
          room = r;
          player = room.addPlayer(conn, cleanName(m.name, 'खिलाड़ी'));
        }
        return;
      }
      // Only these four client messages exist. Kills, damage and zombies are server-only: a client
      // cannot send "kill" (or anything else) to fake them.
      if (m.t === 'state') room.onState(player, m);
      else if (m.t === 'attack') room.onAttack(player, m.ry);
      else if (m.t === 'chat') room.onChat(player, m.text);
      else if (m.t === 'collect' || m.t === 'visit') room.onAction(player, m.t, m.id);
    });

    conn.on('close', () => {
      conns.delete(conn);
      if (room && player) { room.removePlayer(player); rooms.remove(room); }
    });
  });

  let lastTick = Date.now();
  const tick = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.2, (now - lastTick) / 1000); // never simulate a giant step after a stall
    lastTick = now;
    rooms.tick(dt);
  }, 1000 / 15);
  const beat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.terminate(); continue; }
      c.alive = false; c.ping();
    }
  }, 25000);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server, rooms, port: server.address().port,
        close() {
          clearInterval(tick); clearInterval(beat);
          for (const c of conns) c.terminate();
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}

// Run directly: node server/index.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  startServer({ port, host: process.env.HOST || '0.0.0.0' })
    .then(({ port: p }) => {
      const local = fs.existsSync(path.join(LOCAL_THREE, 'build', 'three.module.js'));
      console.log('\n🧟 Jungle Ruins (zombie edition) server चालू है\n');
      console.log(`   इसी कंप्यूटर पर:   http://localhost:${p}`);
      for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) {
          if (i.family === 'IPv4' && !i.internal) console.log(`   उसी WiFi पर दोस्त: http://${i.address}:${p}`);
        }
      }
      console.log(`\n   Three.js: ${local ? 'इस सर्वर से (node_modules)' : 'CDN से (npm install चलाओगे तो सर्वर से मिलेगा, तेज़ और ऑफ़लाइन भी)'}`);
      console.log('   बंद करने के लिए Ctrl+C दबाओ.\n');
    })
    .catch((e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} पहले से इस्तेमाल में है. PORT=3001 npm start आज़माओ.` : e);
      process.exit(1);
    });
}
