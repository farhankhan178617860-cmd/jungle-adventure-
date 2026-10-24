// test/smoke.js  --  part of `npm test`
// Checks: deterministic world, character physics, HTTP routes + security, and full multiplayer
// sessions over real WebSockets: rooms, join limits, snapshots, missions, zombies (chase, damage,
// kills, death, respawn).  Server logic only: the 3D client is covered by test/client-stub.js.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWorld, RUIN_COUNT } from '../shared/worldgen.js';
import { GAME } from '../shared/config.js';
import { PlayerBody } from '../public/js/physics.js';
import { startServer } from '../server/index.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ world
{
  console.log('world generation');
  const t0 = performance.now();
  const a = createWorld(123456), b = createWorld(123456), c = createWorld(999);
  const ms = Math.round(performance.now() - t0);
  assert.equal(a.ruins.length, RUIN_COUNT);
  assert.deepEqual(a.ruins, b.ruins);
  assert.deepEqual(a.trees.slice(0, 50), b.trees.slice(0, 50));
  assert.deepEqual(a.vines, b.vines);
  for (const [x, z] of [[0, 0], [30, -40], [-77, 12], [100, 100]]) assert.equal(a.heightAt(x, z), b.heightAt(x, z));
  ok(`same seed -> identical world (3 worlds built in ${ms} ms)`);
  assert.notDeepEqual(a.ruins, c.ruins);
  ok('different seed -> different world');
  for (let i = 0; i < a.ruins.length; i++) for (let j = i + 1; j < a.ruins.length; j++) {
    assert.ok(Math.hypot(a.ruins[i].x - a.ruins[j].x, a.ruins[i].z - a.ruins[j].z) >= 34);
  }
  assert.ok(a.trees.length > 900, 'trees: ' + a.trees.length);
  assert.equal(a.relics.length, RUIN_COUNT);
  assert.equal(a.spawns.length, 4);
  for (const s of a.spawns) assert.ok(Number.isFinite(s.y) && Number.isFinite(s.yaw));
  let lo = Infinity, hi = -Infinity;
  for (let x = -120; x <= 120; x += 4) for (let z = -120; z <= 120; z += 4) {
    const h = a.heightAt(x, z); assert.ok(Number.isFinite(h)); lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  ok(`${a.trees.length} trees, ${a.rocks.length} rocks, ${a.ferns.length} ferns, ${a.vines.length} vines, ${a.colliders.length} colliders, terrain ${lo.toFixed(1)}..${hi.toFixed(1)} m`);
}

// ---------------------------------------------------------------- physics
{
  console.log('character physics');
  const w = createWorld(42);
  const body = new PlayerBody(w);
  body.spawn(w.spawns[0]);
  for (let i = 0; i < 180; i++) body.step(1 / 60, { dx: 0, dz: 1, run: true, jump: false });
  assert.ok(Number.isFinite(body.pos.x + body.pos.y + body.pos.z));
  assert.ok(body.grounded && Math.abs(body.pos.y - w.heightAt(body.pos.x, body.pos.z)) < 0.01);
  ok(`runs 3 s without NaN, stays on the ground (speed ${body.speed.toFixed(1)} m/s)`);

  body.spawn(w.spawns[1]);
  const gy = body.pos.y; let peak = gy;
  body.step(1 / 60, { dx: 0, dz: 0, run: false, jump: true });
  for (let i = 0; i < 90; i++) { body.step(1 / 60, { dx: 0, dz: 0, run: false, jump: false }); peak = Math.max(peak, body.pos.y); }
  assert.ok(peak - gy > 1.2 && peak - gy < 2.5, 'jump height ' + (peak - gy));
  assert.ok(body.grounded);
  ok(`jump peaks ${(peak - gy).toFixed(2)} m and lands again`);

  const tree = w.trees[0];
  body.pos.x = tree.x - 6; body.pos.z = tree.z; body.pos.y = w.heightAt(body.pos.x, body.pos.z);
  for (let i = 0; i < 240; i++) body.step(1 / 60, { dx: 1, dz: 0, run: true, jump: false });
  const near = w.collidersNear(body.pos.x, body.pos.z);
  for (const c of near) assert.ok(Math.hypot(body.pos.x - c.x, body.pos.z - c.z) >= c.r + 0.4 - 0.02, 'penetrated a collider');
  ok('cannot walk through tree trunks / pillars');

  for (let i = 0; i < 600; i++) body.step(1 / 60, { dx: 1, dz: 1, run: true, jump: false });
  assert.ok(Math.abs(body.pos.x) <= w.half - 3.9 && Math.abs(body.pos.z) <= w.half - 3.9);
  ok('map edge stops the player');
}

// ----------------------------------------------------------- test helpers
const getRaw = (srv, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path, headers }, (res) => {
    const chunks = [];
    res.on('data', (d) => chunks.push(d));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});
const get = async (srv, path) => { const r = await getRaw(srv, path); return { ...r, body: r.body.toString('utf8') }; };

function mkClient(srv) {
  return (name) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
    const c = { ws, name, inbox: [], closed: false };
    ws.onmessage = (e) => c.inbox.push(JSON.parse(e.data));
    ws.onclose = () => { c.closed = true; };
    c.opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    c.send = (o) => ws.send(JSON.stringify(o));
    c.wait = async (type, pred = () => true, ms = 2000) => {
      const end = Date.now() + ms;
      for (;;) {
        const i = c.inbox.findIndex((m) => m.t === type && pred(m));
        if (i >= 0) return c.inbox.splice(i, 1)[0];
        if (Date.now() > end) throw new Error(`${name}: timeout waiting for ${type}`);
        await sleep(10);
      }
    };
    c.none = async (type, ms = 300) => { await sleep(ms); assert.ok(!c.inbox.some((m) => m.t === type), `${name}: unexpected ${type}`); };
    return c;
  };
}

// ============================================================ server A: no zombies
console.log('server (rooms, missions, security)');
const srv = await startServer({ port: 0, host: '127.0.0.1', game: { zombieCount: 0 } });
const client = mkClient(srv);

{
  const idx = await get(srv, '/');
  assert.equal(idx.status, 200);
  assert.match(idx.body, /<script type="importmap">/);
  assert.ok(!idx.body.includes('<!--IMPORTMAP-->'));
  assert.match(idx.body, /three/);
  assert.match(idx.body, /name="viewport"/);
  ok('GET / serves index.html with the three.js import map and a mobile viewport');
  for (const f of ['/js/main.js', '/js/world.js', '/js/zombie.js', '/js/controls.js', '/style.css', '/shared/worldgen.js', '/shared/missions.js', '/shared/config.js']) {
    const r = await get(srv, f); assert.equal(r.status, 200, f);
  }
  ok('static files + shared modules are served');
  assert.equal((await get(srv, '/health')).status, 200);
  for (const evil of ['/shared/..%2fserver%2findex.js', '/..%2f..%2fetc%2fpasswd', '/%2e%2e/package.json', '/vendor/three/package.json']) {
    const r = await get(srv, evil);
    assert.ok(r.status === 403 || r.status === 404, `${evil} -> ${r.status}`);
    assert.ok(!r.body.includes('startServer') && !r.body.includes('root:'), evil);
  }
  ok('path traversal is blocked');

  // installable app (PWA): manifest, icons, service worker
  {
    const idx = await get(srv, '/');
    assert.match(idx.body, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(idx.body, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
    const mf = await getRaw(srv, '/manifest.webmanifest');
    assert.equal(mf.status, 200);
    assert.match(mf.headers['content-type'], /^application\/manifest\+json/);
    const m = JSON.parse(mf.body.toString('utf8'));
    assert.equal(m.start_url, '/'); assert.equal(m.display, 'fullscreen'); assert.equal(m.orientation, 'landscape');
    assert.ok(m.name && m.short_name && /^#[0-9a-f]{6}$/i.test(m.theme_color) && /^#[0-9a-f]{6}$/i.test(m.background_color));
    const sizes = new Set(m.icons.map((i) => i.sizes));
    assert.ok(sizes.has('192x192') && sizes.has('512x512'), 'icons 192 and 512 are required for installing');
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
    for (const ic of m.icons) {
      const r = await getRaw(srv, ic.src);
      assert.equal(r.status, 200, ic.src);
      assert.equal(r.headers['content-type'], 'image/png');
      assert.equal(r.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', ic.src + ' is not a PNG');
      const [w, h] = [r.body.readUInt32BE(16), r.body.readUInt32BE(20)];
      assert.equal(`${w}x${h}`, ic.sizes, `${ic.src} is ${w}x${h}`);
    }
    assert.equal((await getRaw(srv, '/apple-touch-icon.png')).status, 404); // path in <head> is /icons/..., nothing else is exposed
    assert.equal((await getRaw(srv, '/icons/apple-touch-icon.png')).status, 200);
    const sw = await getRaw(srv, '/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.headers['content-type'], /javascript/);
    assert.equal(sw.headers['cache-control'], 'no-cache'); // a service worker must never be cached for long, or updates would not reach phones
    assert.match(sw.body.toString('utf8'), /addEventListener\('fetch'/);
    ok(`installable app: manifest (fullscreen, landscape), ${m.icons.length} real PNG icons with correct sizes, service worker served with no-cache`);
  }

  const gz = await getRaw(srv, '/js/world.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  const plain = await getRaw(srv, '/js/world.js');
  assert.ok(gz.body.length < plain.body.length * 0.6, 'gzip should shrink the file');
  const again = await getRaw(srv, '/js/world.js', { 'If-None-Match': gz.headers.etag });
  assert.equal(again.status, 304);
  ok(`gzip (${plain.body.length} -> ${gz.body.length} bytes) and ETag/304 caching work (saves mobile data)`);

  const post = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/' }, (res) => resolve(res.statusCode));
    req.end();
  });
  assert.equal(post, 405);
  ok('non-GET requests are refused');
}

const A = client('A'); await A.opened;
A.send({ t: 'create', name: 'Asha' });
const ja = await A.wait('joined');
assert.match(ja.code, /^[A-Z2-9]{4}$/);
assert.equal(ja.players.length, 1);
assert.equal(ja.missions.length, 3);
assert.equal(ja.maxHp, GAME.playerHp);
assert.equal(ja.slot, 0);
ok(`create room -> code ${ja.code}, seed ${ja.seed}, 3 missions`);

const world = createWorld(ja.seed);
const roomA = srv.rooms.get(ja.code);

const B = client('B'); await B.opened;
B.send({ t: 'join', name: 'Bilal', code: ja.code.toLowerCase() });
const jb = await B.wait('joined');
assert.equal(jb.seed, ja.seed);
assert.equal(jb.players.length, 2);
assert.equal(jb.slot, 1);
const pj = await A.wait('player_joined');
assert.equal(pj.player.name, 'Bilal');
ok('second player joins with lower-case code, first player is notified');

const X = client('X'); await X.opened;
X.send({ t: 'join', name: 'x', code: 'ZZZZ' });
assert.match((await X.wait('error')).msg, /रूम/);
ok('unknown room code -> error');

const C = client('C'); await C.opened; C.send({ t: 'join', name: 'Chitra', code: ja.code }); await C.wait('joined');
const D = client('D'); await D.opened; D.send({ t: 'join', name: 'Dev', code: ja.code }); const jd = await D.wait('joined');
assert.equal(jd.players.length, 4);
X.send({ t: 'join', name: 'late', code: ja.code });
assert.match((await X.wait('error')).msg, /भरा/);
ok('room holds exactly 4 players; the 5th is refused');

B.send({ t: 'state', x: 10.5, y: 3, z: -4.25, ry: 1.2, sp: 5.5, g: 1 });
const snap = await A.wait('snap', (m) => m.p.some((r) => r[0] === jb.id && r[1] === 10.5));
const row = snap.p.find((r) => r[0] === jb.id);
assert.deepEqual(row.slice(1, 7), [10.5, 3, -4.25, 1.2, 5.5, 1]);
assert.equal(row[7], GAME.playerHp); assert.equal(row[8], 1); assert.equal(row[9], 0);
assert.deepEqual(snap.z, []);
ok('position snapshots (with hp / alive / kills) reach other players');

B.send({ t: 'state', x: 'abc', y: null, z: NaN, ry: 0, sp: 0 });
B.ws.send('not json'); B.ws.send('{"t":5}');
await sleep(150);
ok('garbage messages are ignored');

// text chat
{
  const drain = (c) => { const got = c.inbox.filter((m) => m.t === 'chat'); c.inbox = c.inbox.filter((m) => m.t !== 'chat'); return got; };

  A.send({ t: 'chat', text: '  नमस्ते   दोस्तो!  ' });
  const ca = await A.wait('chat'), cb = await B.wait('chat'), cd = await D.wait('chat');
  assert.equal(ca.text, 'नमस्ते दोस्तो!');
  assert.equal(ca.id, ja.id); assert.equal(ca.name, 'Asha'); assert.equal(typeof ca.color, 'number');
  assert.deepEqual([cb.text, cb.name], [ca.text, 'Asha']); assert.equal(cd.text, ca.text);
  ok('chat: a message reaches every player in the room (the sender too); extra spaces are cleaned');

  B.send({ t: 'chat', text: '\u0000\u202eevil\u200b\n\ttext' }); // NUL, right-to-left override, zero-width space, newline, tab
  assert.equal((await A.wait('chat', (m) => m.id === jb.id)).text, 'evil text');
  B.send({ t: 'chat', text: 'x'.repeat(300) });
  assert.equal((await A.wait('chat', (m) => m.id === jb.id)).text.length, 120);
  B.send({ t: 'chat', text: '🧟'.repeat(200) });
  const emo = (await A.wait('chat', (m) => m.id === jb.id)).text;
  assert.equal(Array.from(emo).length, 120); assert.ok(!emo.includes('�') && emo === '🧟'.repeat(120), 'an emoji must never be cut in half');
  B.send({ t: 'chat', text: '<b onclick="x()">hi</b>' });
  assert.equal((await A.wait('chat', (m) => m.id === jb.id)).text, '<b onclick="x()">hi</b>'); // shown with textContent on the client, so it stays plain text
  ok('chat: control / invisible characters removed, long text cut at 120 characters, emoji never split');

  drain(A);
  for (const bad of [123, '   ', '\n\t', { a: 1 }, null, undefined]) B.send({ t: 'chat', text: bad });
  B.send({ t: 'chat' });
  await A.none('chat');
  ok('chat: empty or non-text messages are ignored');

  drain(D);
  for (let i = 0; i < 12; i++) C.send({ t: 'chat', text: 'spam ' + i });
  await sleep(500);
  const got = drain(D);
  assert.ok(got.length >= 4 && got.length <= 5, `flood limit: ${got.length} of 12 delivered`);
  assert.deepEqual(got.map((m) => m.text), got.map((_, i) => 'spam ' + i)); // the first ones get through, in order
  ok(`chat: flooding is limited (${got.length} of 12 rapid messages delivered, in order)`);
  for (const c of [A, B, C, D]) drain(c);
}

// missions: validation is done by the server
const r0 = world.relics[0];
A.send({ t: 'state', x: world.spawns[0].x, y: 0, z: world.spawns[0].z, ry: 0, sp: 0, g: 1 });
await sleep(60);
A.send({ t: 'collect', id: 0 });
await A.none('mission');
ok('collecting a relic from far away is rejected');

A.send({ t: 'state', x: r0.x, y: r0.y - 2.2, z: r0.z, ry: 0, sp: 0, g: 1 });
await sleep(60);
A.send({ t: 'collect', id: 0 });
const mA = await A.wait('mission'); const mB = await B.wait('mission');
const relicsM = mA.missions.find((m) => m.id === 'relics');
assert.equal(relicsM.progress, 1); assert.deepEqual(relicsM.items, [0]);
assert.equal(mA.by, ja.id); assert.equal(mA.event, 'collect'); assert.equal(mB.missions.find((m) => m.id === 'relics').progress, 1);
ok('valid relic pickup is accepted and broadcast to the whole room');

A.send({ t: 'collect', id: 0 });
await A.none('mission');
A.send({ t: 'collect', id: 99 }); A.send({ t: 'collect', id: 'x' }); A.send({ t: 'collect', id: -1 });
A.send({ t: 'kill', id: 1 }); A.send({ t: 'kill', id: 2, trusted: true });
await A.none('mission');
assert.equal(roomA.missions.state.find((m) => m.id === 'zombies').items.length, 0);
ok('duplicate / invalid ids ignored; clients cannot fake zombie kills');

for (const rel of world.relics) {
  A.send({ t: 'state', x: rel.x, y: rel.y - 2.2, z: rel.z, ry: 0, sp: 0, g: 1 });
  await sleep(40);
  A.send({ t: 'collect', id: rel.id });
  A.send({ t: 'visit', id: rel.ruinId });
  await sleep(40);
}
await sleep(150);
const stateNow = roomA.missions.snapshot();
assert.ok(stateNow.find((m) => m.id === 'relics').done && stateNow.find((m) => m.id === 'explore').done);
assert.ok(!stateNow.find((m) => m.id === 'zombies').done);
A.inbox.length = 0;
// the zombie mission is finished by the server itself (white-box: no zombies exist on this server)
for (let i = 0; i < GAME.killGoal - 1; i++) roomA.missions.handle('kill', 1000 + i, null, true);
assert.ok(roomA.missions.handle('kill', 5000, null, true));
roomA.announceMission(roomA.players.get(ja.id), 'kill', 5000);
const last = await A.wait('mission', (m) => m.allDone);
assert.ok(last.missions.every((m) => m.done && m.progress === m.goal));
ok('all three missions complete -> allDone flag sent');

B.ws.close();
const left = await A.wait('player_left');
assert.equal(left.id, jb.id);
ok('player_left is broadcast when someone disconnects');

const status = await new Promise((resolve) => {
  const req = http.request({
    host: '127.0.0.1', port: srv.port, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: 'http://evil.example',
    },
  });
  req.on('response', (res) => resolve(res.statusCode));
  req.on('upgrade', () => resolve(101));
  req.on('error', () => resolve('error'));
  req.end();
});
assert.equal(status, 403);
ok('cross-site WebSocket connections are refused');

const big = client('big'); await big.opened;
big.ws.send('x'.repeat(20000));
await sleep(300);
assert.ok(big.closed, 'oversize frame should close the socket');
ok('oversized messages close the connection');

for (const cl of [A, C, D, X]) cl.ws.close();
await sleep(150);
assert.equal(srv.rooms.rooms.size, 0, 'empty rooms must be deleted');
ok('empty rooms are cleaned up');
await srv.close();

// ================================================ server with three.js installed
// Online (after `npm install` on the host) three.js is served by the game server itself.
// A tiny fixture folder stands in for node_modules/three; its package.json must never be reachable.
console.log('three.js served from node_modules (online deployment path)');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '.fixture-three');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'examples', 'jsm', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'build', 'three.module.js'), 'export const REVISION = "fixture";');
  fs.writeFileSync(path.join(dir, 'examples', 'jsm', 'objects', 'Sky.js'), 'export const Sky = 1;');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"secret":"must-not-be-served"}');
  const s3 = await startServer({ port: 0, host: '127.0.0.1', game: { zombieCount: 0 }, threeDir: dir });
  try {
    const idx = await get(s3, '/');
    assert.match(idx.body, /"three":"\/vendor\/three\/build\/three\.module\.js"/);
    assert.match(idx.body, /"three\/addons\/":"\/vendor\/three\/examples\/jsm\/"/);
    const lib = await getRaw(s3, '/vendor/three/build/three.module.js');
    assert.equal(lib.status, 200);
    assert.match(lib.headers['cache-control'], /max-age/);
    assert.equal((await get(s3, '/vendor/three/examples/jsm/objects/Sky.js')).status, 200);
    ok('importmap points at /vendor/three; the library and addons are served and cacheable');
    for (const evil of ['/vendor/three/package.json', '/vendor/three/build/..%2fpackage.json', '/vendor/three/build/%2e%2e/package.json',
      '/vendor/three/examples/jsm/..%2f..%2fpackage.json', '/vendor/three/build/../../server/index.js', '/vendor/three/build%2f..%2f..%2fserver%2findex.js']) {
      const r = await get(s3, evil);
      assert.ok(r.status === 403 || r.status === 404, `${evil} -> ${r.status}`);
      assert.ok(!r.body.includes('must-not-be-served') && !r.body.includes('startServer'), evil);
    }
    ok('only build/ and examples/jsm/ are public: ../ tricks are refused');
  } finally {
    await s3.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ======================================================== server B: zombies
console.log('zombies (server-side AI, combat, death, respawn)');
const srvZ = await startServer({
  port: 0, host: '127.0.0.1',
  game: { zombieCount: 4, zombieDamage: 60, respawnDelay: 0.8, spawnShield: 0.3, zombieRespawn: 30 },
});
const zclient = mkClient(srvZ);
const P = zclient('P'); await P.opened;
P.send({ t: 'create', name: 'Sam' });
const jp = await P.wait('joined');
const roomZ = srvZ.rooms.get(jp.code);
const worldZ = createWorld(jp.seed);
assert.equal(roomZ.zombies.list.length, 4);
for (const z of roomZ.zombies.list) {
  assert.ok(Math.hypot(z.x, z.z) >= 40, 'zombies must not spawn in the start clearing');
  assert.ok(Math.abs(z.x) < worldZ.half && Math.abs(z.z) < worldZ.half);
}
const s0 = await P.wait('snap');
assert.equal(s0.z.length, 4);
assert.equal(s0.z[0].length, 7);
ok('4 zombies spawn away from the start; snapshots carry them even for a single player');

const me = jp.id;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const stand = (x, z) => P.send({ t: 'state', x, y: 0, z, ry: 0, sp: 0, g: 1 });
const towardsCentre = (v, d) => (v > 0 ? v - d : v + d);

// 1. a zombie notices the player and chases
const z0 = roomZ.zombies.list[0];
const pos = { x: towardsCentre(z0.x, 8), z: z0.z };
stand(pos.x, pos.z);
await sleep(100);
const d0 = dist(z0, pos);
await sleep(1200);
assert.ok(z0.chasing, 'zombie should be chasing');
assert.ok(dist(z0, pos) < d0 - 1.5, `zombie should close in (${d0.toFixed(1)} -> ${dist(z0, pos).toFixed(1)})`);
ok(`zombie chases a player in range (${d0.toFixed(1)} m -> ${dist(z0, pos).toFixed(1)} m in 1.2 s)`);

// 2. melee: two hits kill it; the kill counts for the team mission
async function strike(zom) {
  const dx = zom.x > 0 ? -2 : 2; // stand 2 m closer to the map centre, facing the zombie along x
  stand(zom.x + dx, zom.z);
  await sleep(60);
  P.send({ t: 'attack', ry: Math.atan2(-dx, 0) });
}
P.inbox.length = 0;
await strike(z0);
await P.wait('ev', (m) => m.k === 'zhit' && m.id === z0.id);
assert.equal(z0.hp, GAME.zombieHp - GAME.attackDamage);
assert.ok(z0.stun > 0, 'a hit stuns the zombie');
await sleep(600);
await strike(z0);
const dead = await P.wait('ev', (m) => m.k === 'zdie' && m.id === z0.id);
assert.equal(dead.by, me);
const km = await P.wait('mission', (m) => m.event === 'kill');
assert.equal(km.missions.find((m) => m.id === 'zombies').progress, 1);
assert.equal(roomZ.zombies.list.length, 3);
const sk = await P.wait('snap', (m) => m.p[0][9] === 1);
assert.ok(!sk.z.some((r) => r[0] === z0.id));
ok('two hits kill a zombie: zdie event, mission progress 1/15, kill counter 1, gone from snapshots');

P.send({ t: 'attack', ry: 0 }); P.send({ t: 'attack', ry: 0 });
await sleep(200);
ok('attack spam is rate limited by the server cooldown');

// 3. a zombie hurts, then downs the player; dead players cannot act; then they respawn
const z1 = roomZ.zombies.list[0];
const near1 = { x: towardsCentre(z1.x, 1), z: z1.z };
stand(near1.x, near1.z);
P.inbox.length = 0;
const hurt = await P.wait('ev', (m) => m.k === 'hurt' && m.id === me, 3000);
assert.equal(hurt.hp, GAME.playerHp - 60);
const down = await P.wait('ev', (m) => m.k === 'pdie' && m.id === me, 4000);
assert.equal(down.in, 0.8);
const pl = roomZ.players.get(me);
assert.equal(pl.alive, false);
const frozen = { x: pl.x, z: pl.z };
stand(0, 0);
P.send({ t: 'attack', ry: 0 });
await sleep(150);
assert.deepEqual({ x: pl.x, z: pl.z }, frozen);
assert.equal(pl.atkCd, 0);
ok('zombie damage: 100 -> 40 -> downed; a downed player cannot move or attack');

const rez = await P.wait('ev', (m) => m.k === 'respawn' && m.id === me, 3000);
const sp = worldZ.spawns[jp.slot];
assert.ok(Math.abs(rez.x - sp.x) < 0.01 && Math.abs(rez.z - sp.z) < 0.01);
const healthy = await P.wait('snap', (m) => m.p[0][8] === 1 && m.p[0][7] === GAME.playerHp);
assert.ok(healthy);
ok('player respawns at their start point with full health');

P.ws.close();
await sleep(150);
assert.equal(srvZ.rooms.rooms.size, 0);
ok('room with zombies is cleaned up when the last player leaves');
await srvZ.close();

console.log(`\n${passed} checks passed`);
