// test/client-stub.js  --  part of `npm test`
//   node test/client-stub.js          desktop controls (keyboard + mouse)
//   node test/client-stub.js touch    phone controls (joystick, look pad, buttons)
//
// Runs the REAL client (public/js/main.js and everything it imports) in Node, connected over a real
// WebSocket to the REAL game server, with a fake browser (test/fake-dom.js) and a fake three.js
// (test/three-stub.js). It proves that the client and server speak the same protocol, that the
// HUD / zombies / combat / death / respawn / disconnect code paths run without errors, and that the
// touch controls drive the character. It cannot prove the picture looks right or that a phone is
// fast enough: only a real browser can show that.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { startServer } from '../server/index.js';
import { createWorld } from '../shared/worldgen.js';
import { GAME } from '../shared/config.js';
import { installDom } from './fake-dom.js';

const mode = process.argv[2] === 'touch' ? 'touch' : 'desktop';
const touch = mode === 'touch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.error('client-stub: overall timeout'); process.exit(1); }, 90000).unref();

console.log(`client (${mode} controls) against the real server`);

const srv = await startServer({
  port: 0, host: '127.0.0.1',
  game: { zombieCount: 3, zombieDamage: 30, zombieWindup: 0.1, respawnDelay: 0.6, spawnShield: 0, zombieRespawn: 60 },
});
const dom = installDom({ port: srv.port, search: touch ? '?touch=1' : '' });
register('./stub-loader.js', import.meta.url);
await import('../public/js/main.js');

// run client frames (50 per second) while real time passes, so the server keeps up
async function play(ms) { for (let i = 0; i < Math.round(ms / 20); i++) { dom.pump(1, 20); await sleep(20); } }
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout waiting for: ' + label);
    dom.pump(1, 20); await sleep(20);
  }
}
const text = (id) => dom.el(id).textContent;
const missionRows = () => dom.el('missionList').children.map((d) => d.children[0].textContent);

// ----------------------------------------------- "install as app" button in the lobby
{
  assert.equal(dom.el('btnInstall').hidden, true);   // hidden until the browser says the game can be installed
  assert.equal(dom.el('installHint').hidden, true);  // iPhone hint only shows on iPhones
  let prompted = 0;
  dom.winFire('beforeinstallprompt', { prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert.equal(dom.el('btnInstall').hidden, false);
  dom.el('btnInstall').dispatch('click');
  await sleep(20);
  assert.equal(prompted, 1);
  assert.equal(dom.el('btnInstall').hidden, true);
  ok('lobby shows the install button when the browser allows it; a tap opens the install prompt');
}

// ------------------------------------------------------------------ lobby -> game
dom.el('name').value = 'Tester';
assert.equal(dom.el('hud').hidden, true);
dom.el('btnCreate').dispatch('click');
await waitFor(() => globalThis.__game, 8000, 'game to start');
const game = globalThis.__game;
assert.equal(dom.el('lobby').hidden, true);
assert.equal(dom.el('hud').hidden, false);
assert.equal(dom.el('touch').hidden, !touch);
assert.equal(dom.el('tipsTouch').hidden, !touch);
const code = text('roomCode');
assert.match(code, /^[A-Z2-9]{4}$/);
const room = srv.rooms.get(code);
const me = [...room.players.values()][0];
const world = createWorld(room.seed);
assert.equal(me.name, 'Tester');
assert.equal(text('hpText'), `❤ ${GAME.playerHp} / ${GAME.playerHp}`);
const rows = missionRows();
assert.equal(rows.length, 3);
assert.match(rows[0], /0\/5/); assert.match(rows[2], new RegExp(`0/${GAME.killGoal}`));
ok(`lobby -> room ${code}: HUD, health and 3 missions shown (${touch ? 'touch UI on' : 'touch UI off'})`);

await play(300);
assert.equal(game.zviews.size, 3);
ok('3 zombies from the server snapshot are created on the client');

// ----------------------------------------------------------------- movement
const sp0 = { x: game.body.pos.x, z: game.body.pos.z };
if (touch) {
  dom.el('zoneMove').dispatch('pointerdown', { pointerId: 1, clientX: 150, clientY: 300 });
  dom.el('zoneMove').dispatch('pointermove', { pointerId: 1, clientX: 150, clientY: 230 }); // pushed to the edge = run
} else {
  dom.winFire('keydown', { code: 'KeyW', repeat: false });
}
await play(1000);
const moved = Math.hypot(game.body.pos.x - sp0.x, game.body.pos.z - sp0.z);
if (touch) dom.el('zoneMove').dispatch('pointerup', { pointerId: 1 }); else dom.winFire('keyup', { code: 'KeyW' });
await play(400);
assert.ok(moved > 3, `moved only ${moved.toFixed(1)} m`); // walking is 5.2 m/s minus the speed-up at the start
ok(`${touch ? 'joystick' : 'W key'} moves the character (${moved.toFixed(1)} m in 1 s)${touch ? ', pushed to the edge = running' : ''}`);

assert.ok(Math.hypot(me.x - game.body.pos.x, me.z - game.body.pos.z) < 0.8, 'server position should follow the client');
ok('the server sees the same position as the client (state messages work)');

const yaw0 = game.input.yaw;
if (touch) {
  dom.el('zoneLook').dispatch('pointerdown', { pointerId: 2, clientX: 600, clientY: 200 });
  dom.el('zoneLook').dispatch('pointermove', { pointerId: 2, clientX: 500, clientY: 200 });
  dom.el('zoneLook').dispatch('pointerup', { pointerId: 2 });
} else {
  dom.winFire('keydown', { code: 'KeyQ' }); await play(300); dom.winFire('keyup', { code: 'KeyQ' });
}
assert.notEqual(game.input.yaw, yaw0);
ok(`${touch ? 'look pad' : 'Q key'} turns the camera`);

{
  const groundY = world.heightAt(game.body.pos.x, game.body.pos.z);
  if (touch) dom.el('btnJump').dispatch('pointerdown'); else dom.winFire('keydown', { code: 'Space', repeat: false });
  let peak = -Infinity;
  for (let i = 0; i < 40; i++) { dom.pump(1, 20); peak = Math.max(peak, game.body.pos.y); await sleep(20); }
  assert.ok(peak - groundY > 1.0, `jump only ${(peak - groundY).toFixed(2)} m`);
  ok(`jump ${touch ? 'button' : 'key'} works (${(peak - groundY).toFixed(2)} m)`);
}

// ------------------------------------------------------- a second player (friend)
const R = new WebSocket(`ws://127.0.0.1:${srv.port}`);
const rIn = [];
R.onmessage = (e) => rIn.push(JSON.parse(e.data));
await new Promise((res, rej) => { R.onopen = res; R.onerror = rej; });
R.send(JSON.stringify({ t: 'join', name: 'Friend', code: code.toLowerCase() }));
await waitFor(() => rIn.some((m) => m.t === 'joined'), 3000, 'friend to join');
const friend = rIn.find((m) => m.t === 'joined');
await play(400);
assert.equal(game.remotes.size, 1);
assert.equal(dom.el('players').children.length, 2);
R.send(JSON.stringify({ t: 'state', x: 10, y: 1, z: -6, ry: 1, sp: 5, g: 1 }));
await play(500);
const rem = [...game.remotes.values()][0];
assert.equal(rem.target.x, 10);
assert.ok(Math.abs(rem.avatar.group.position.x - 10) < 1.5, 'remote avatar should glide to the friend position');
await waitFor(() => rIn.some((m) => m.t === 'snap' && m.p.length === 2), 2000, 'friend to receive snapshots');
ok('friend joins the same world: avatar appears, follows their position, roster lists both');

// ---------------------------------------------------------------------- chat
{
  const log = dom.el('chatLog');
  const last = () => log.children[log.children.length - 1];
  const got = (txt) => rIn.some((m) => m.t === 'chat' && m.text === txt);
  assert.equal(dom.el('chatBox').hidden, true);

  R.send(JSON.stringify({ t: 'chat', text: 'ज़ॉम्बी पीछे है! <b>x</b>' }));
  await waitFor(() => log.children.length === 1, 3000, 'friend chat message on the HUD');
  assert.equal(last().children[0].textContent, 'Friend:');
  assert.equal(last().children[1].textContent, 'ज़ॉम्बी पीछे है! <b>x</b>'); // plain text, never HTML
  assert.equal(last().className, 'msg');
  ok("friend's chat message appears in the chat log (name + text, as plain text)");

  if (touch) dom.el('btnChat').onclick(); else dom.winFire('keydown', { code: 'Enter' });
  assert.equal(dom.el('chatBox').hidden, false);
  assert.equal(dom.el('chatQuick').children.length, 6);
  const p0 = { x: game.body.pos.x, z: game.body.pos.z };
  dom.winFire('keydown', { code: 'KeyW', target: { tagName: 'INPUT' } }); // typing the letter W into the box
  await play(500);
  dom.winFire('keyup', { code: 'KeyW', target: { tagName: 'INPUT' } });
  assert.ok(Math.hypot(game.body.pos.x - p0.x, game.body.pos.z - p0.z) < 0.3, 'typing must not move the character');
  ok(`${touch ? '💬 button' : 'Enter key'} opens the chat box; typing in it does not move the character`);

  dom.el('chatInput').value = 'आ रहा हूँ, रुको';
  dom.el('chatForm').dispatch('submit');
  await waitFor(() => got('आ रहा हूँ, रुको'), 3000, 'friend to receive my chat');
  assert.equal(rIn.find((m) => m.t === 'chat' && m.text === 'आ रहा हूँ, रुको').name, 'Tester');
  await waitFor(() => log.children.length === 2, 3000, 'my own message in my log');
  assert.equal(last().className, 'msg me');
  assert.equal(dom.el('chatBox').hidden, true);
  assert.equal(dom.el('chatInput').value, '');
  ok('typed message goes to the friend, shows in my own log, and the box closes');

  if (touch) dom.el('btnChat').onclick(); else dom.winFire('keydown', { code: 'Enter' });
  dom.el('chatQuick').children[0].dispatch('click');
  await waitFor(() => got('🆘 मदद!'), 3000, 'quick phrase to arrive');
  assert.equal(dom.el('chatBox').hidden, true);
  ok('one-tap quick phrase (🆘 मदद!) is sent');

  if (touch) dom.el('btnChat').onclick(); else dom.winFire('keydown', { code: 'Enter' });
  dom.el('chatInput').value = 'half typed';
  dom.el('chatInput').dispatch('keydown', { code: 'Escape' });
  assert.equal(dom.el('chatBox').hidden, true);
  assert.equal(dom.el('chatInput').value, '');
  await play(200);
  assert.ok(!got('half typed'));
  ok('Esc closes the chat box without sending');
}

R.close();
await waitFor(() => game.remotes.size === 0, 3000, 'remote avatar to be removed');
assert.equal(dom.el('players').children.length, 1);
ok('friend leaves: avatar and roster entry are removed');

// ------------------------------------------------------------------- combat
const zs = room.zombies.list;
zs[1].x = 100; zs[1].z = 100; zs[1].chasing = false; // keep the other zombies out of the way
zs[2].x = -100; zs[2].z = -100; zs[2].chasing = false;
const z0 = zs[0];
z0.x = me.x + 1.3; z0.z = me.z; z0.hp = GAME.zombieHp;
const attack = () => { if (touch) dom.el('btnAttack').dispatch('pointerdown'); else dom.winFire('keydown', { code: 'KeyF', repeat: false }); };

await waitFor(() => text('hpText').startsWith('❤ 70'), 4000, 'first zombie bite on the HUD');
assert.ok(dom.el('damage').classList.contains('hit'));
ok('zombie bites: health bar drops to 70 and the red damage flash plays');

// the test teleported the zombie, so let its drawing glide over first (real zombies walk, so view and server stay close)
const zv = game.zviews.get(z0.id);
await waitFor(() => Math.hypot(zv.view.group.position.x - z0.x, zv.view.group.position.z - z0.z) < 0.3, 4000, 'zombie view to arrive');
attack();
await waitFor(() => z0.hp === GAME.zombieHp - GAME.attackDamage, 2000, 'first hit to land');
ok('attack button/key sends a swing and the server applies damage (aim assist faces the zombie)');
await play(800); // client cooldown
attack();
await waitFor(() => text('kills') === '☠ 1', 3000, 'kill counter');
await waitFor(() => /1\/\d+/.test(missionRows()[2]), 3000, 'zombie mission progress');
assert.equal(me.kills, 1);
await waitFor(() => game.zviews.size === 2, 5000, 'dead zombie to disappear');
ok('second hit kills: kill counter ☠ 1, mission 1/15 on the HUD, the corpse view is cleaned up');

// ------------------------------------------------------------ death + respawn
const z1 = zs[0];
z1.x = me.x + 1.2; z1.z = me.z; z1.chasing = false;
await waitFor(() => dom.el('death').hidden === false, 8000, 'death screen');
z1.x = 100; z1.z = -100; z1.chasing = false; // so nothing waits at the respawn point
assert.match(text('deathSec'), /^\d+$/);
assert.equal(me.alive, false);
ok('zombies take the last health: death screen with a countdown is shown');

await waitFor(() => dom.el('death').hidden === true, 4000, 'respawn');
const sp = world.spawns[me.slot];
assert.ok(Math.hypot(game.body.pos.x - sp.x, game.body.pos.z - sp.z) < 0.5, 'respawn at the start point');
await waitFor(() => text('hpText') === `❤ ${GAME.playerHp} / ${GAME.playerHp}`, 3000, 'full health after respawn');
ok('respawn: back at the start point with full health, death screen gone');

// --------------------------------------------------------------- disconnect
await srv.close();
await waitFor(() => dom.el('overlay').hidden === false, 4000, 'disconnect overlay');
assert.equal(text('ovTitle'), 'कनेक्शन टूट गया');
ok('server stops: "connection lost" screen is shown');

console.log(`\n${passed} client checks passed (${mode})`);
process.exit(0);
