// public/js/main.js  -- entry point: lobby -> world -> game loop
import * as THREE from 'three';
import { createWorld } from '../../shared/worldgen.js';
import { GAME } from '../../shared/config.js';
import { buildWorld } from './world.js';
import { setupLighting } from './lighting.js';
import { Fireflies } from './effects.js';
import { Avatar } from './avatar.js';
import { ZombieView } from './zombie.js';
import { PlayerBody } from './physics.js';
import { Input } from './controls.js';
import { Net } from './net.js';
import { QUALITY, isTouchDevice, pickQuality } from './quality.js';
import * as UI from './ui.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
const touch = isTouchDevice(params);
const quality = pickQuality(params, touch);
const cfg = QUALITY[quality];
const canvas = document.getElementById('game');

UI.setTouchMode(touch);
{
  let pref = 'auto';
  try { pref = localStorage.getItem('jr_quality') || 'auto'; } catch { /* ignore */ }
  const shown = QUALITY[params.get('quality')] ? params.get('quality') : (QUALITY[pref] ? pref : 'auto');
  UI.initQualitySelect(shown, (v) => {
    try { localStorage.setItem('jr_quality', v); localStorage.setItem('jr_name', UI.getName()); } catch { /* ignore */ }
    const u = new URL(location.href);
    u.searchParams.delete('quality');
    location.assign(u.toString()); // the renderer is created once, so reload with the new preset
  });
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: cfg.antialias, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  UI.setLobbyMessage('आपके ब्राउज़र में WebGL चालू नहीं है। Chrome / Edge / Firefox / Safari का नया वर्शन इस्तेमाल करो।', true);
  throw e;
}
const basePR = Math.min(window.devicePixelRatio || 1, cfg.pixelRatio);
let curPR = basePR;
renderer.setPixelRatio(curPR);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.shadowMap.enabled = cfg.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---- install as an app (PWA): the browser's own install prompt, an iPhone hint, and the service worker
{
  let installEvt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; UI.showInstall(true); });
  addEventListener('appinstalled', () => { installEvt = null; UI.showInstall(false); });
  UI.onInstall(async () => {
    if (!installEvt) return;
    const evt = installEvt; installEvt = null; UI.showInstall(false);
    try { evt.prompt(); await evt.userChoice; } catch { /* ignore */ }
  });
  try {
    const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) UI.showInstallHint(true); // iOS has no install prompt
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  } catch { /* ignore */ }
}

const net = new Net();
const input = new Input(canvas, touch);

const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
const r2 = (v) => Math.round(v * 100) / 100;
const IDLE_INPUT = { dx: 0, dz: 0, len: 0, run: false, jump: false };

// keep the phone screen awake while playing (needs https; silently ignored if unsupported)
let wakeLock = null;
async function keepAwake() {
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLock) keepAwake(); });

// ------------------------------------------------------------------ lobby
const qRoom = (params.get('room') || '').toUpperCase().slice(0, 4);
if (qRoom) UI.setCode(qRoom);
try { UI.setName(localStorage.getItem('jr_name') || ''); } catch { /* ignore */ }
UI.onNameInput(() => { try { localStorage.setItem('jr_name', UI.getName()); } catch { /* ignore */ } });

async function enter(kind) {
  const name = UI.getName();
  if (kind === 'join' && UI.getCode().length !== 4) { UI.setLobbyMessage('4 अक्षर का रूम कोड डालो।', true); return; }
  UI.setBusy(true);
  UI.setLobbyMessage('सर्वर से कनेक्ट हो रहा है… (मुफ़्त होस्टिंग पर सर्वर को जागने में 1 मिनट लग सकता है)');
  try {
    await net.connect();
    const info = await net.request(kind === 'create' ? { t: 'create', name } : { t: 'join', name, code: UI.getCode() });
    UI.setLobbyMessage('जंगल बन रहा है… कुछ सेकंड रुको');
    await new Promise((r) => setTimeout(r, 60)); // let the browser paint the message first
    startGame(info);
  } catch (err) {
    UI.setLobbyMessage(err.message || 'कुछ गड़बड़ हुई।', true);
    UI.setBusy(false);
    try { net.ws && net.ws.close(); } catch { /* ignore */ }
  }
}
UI.onCreate(() => enter('create'));
UI.onJoin(() => enter('join'));

// ------------------------------------------------------------------- game
function startGame(info) {
  const world = createWorld(info.seed);
  const maxHp = info.maxHp || GAME.playerHp;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, cfg.far);
  const lighting = setupLighting(scene, { shadows: cfg.shadows, shadowMap: cfg.shadowMap, fog: cfg.fog, far: cfg.far });
  const visuals = buildWorld(world, { quality });
  scene.add(visuals.group);
  const flies = new Fireflies(scene, visuals.glowTexture, cfg.fireflies);

  const roster = new Map(info.players.map((p) => [p.id, p]));
  const stats = new Map(); // id -> { hp, alive, kills }
  const me = roster.get(info.id);
  const spawn = world.spawns[info.slot];
  const body = new PlayerBody(world);
  body.spawn(spawn);
  const avatar = new Avatar(me.color, '');
  avatar.group.rotation.y = spawn.yaw;
  scene.add(avatar.group);
  input.yaw = spawn.yaw;

  const remotes = new Map();   // other players
  const zviews = new Map();    // zombies: id -> { view, target, st }
  const sent = new Map();
  let alive = true, atkCd = 0, myHp = maxHp, myKills = 0, rosterT = 0;
  const game = { world, scene, camera, body, avatar, remotes, zviews, input };
  window.__game = game; // handy for debugging in the browser console

  UI.setHealth(myHp, maxHp);
  UI.setKills(0);

  function addRemote(p) {
    if (p.id === info.id || remotes.has(p.id)) return;
    const av = new Avatar(p.color, p.name);
    const sp = world.spawns[p.slot];
    av.group.position.set(sp.x, sp.y, sp.z);
    scene.add(av.group);
    remotes.set(p.id, { avatar: av, target: { x: sp.x, y: sp.y, z: sp.z, ry: 0 }, speed: 0, grounded: true, fresh: true, alive: true });
  }
  info.players.forEach(addRemote);

  function makeZombie(id, x, y, z, ry) {
    const view = new ZombieView(id);
    view.group.position.set(x, y, z);
    view.group.rotation.y = ry;
    scene.add(view.group);
    const v = { view, target: { x, y, z, ry }, st: 0 };
    zviews.set(id, v);
    return v;
  }

  let game_missions = info.missions;
  const refreshRoster = () => UI.renderPlayers([...roster.values()], info.id, stats);
  function applyMissions(list) {
    game_missions = list;
    const relics = list.find((m) => m.id === 'relics');
    visuals.setCollected(relics ? relics.items : []);
    UI.renderMissions(list);
  }

  UI.enterGameUI(info.code, touch);
  UI.initChat((text) => net.send({ t: 'chat', text }));
  addEventListener('keydown', (e) => { // Enter opens the chat box (PC)
    if (e.code === 'Enter' && e.target.tagName !== 'INPUT' && !UI.isChatOpen()) { e.preventDefault(); UI.openChat(); }
  });
  refreshRoster();
  applyMissions(info.missions);
  UI.toast(touch
    ? 'जॉयस्टिक से चलो · ⚔ वार · ⤒ कूद · 💬 से दोस्तों से बात करो'
    : 'WASD चलो · Shift दौड़ो · Space कूदो · F / क्लिक से वार · Enter = दोस्तों से बात (पहले क्लिक करके माउस पकड़ो)', 7000);
  if (!touch) {
    UI.setClickHint(true);
    document.addEventListener('pointerlockchange', () => UI.setClickHint(!input.locked));
  }
  try { // so a reload brings you back to the same room code
    const u = new URL(location.href); u.searchParams.set('room', info.code);
    history.replaceState(null, '', u);
  } catch { /* ignore */ }
  keepAwake();
  input.enabled = true;

  // ---- network events
  net.on('player_joined', (m) => {
    roster.set(m.player.id, m.player);
    addRemote(m.player);
    refreshRoster();
    UI.toast(`${m.player.name} जंगल में आ गया`);
  });
  net.on('player_left', (m) => {
    const p = roster.get(m.id);
    roster.delete(m.id); stats.delete(m.id);
    const r = remotes.get(m.id);
    if (r) { scene.remove(r.avatar.group); r.avatar.dispose(); remotes.delete(m.id); }
    refreshRoster();
    if (p) UI.toast(`${p.name} चला गया`);
  });

  net.on('snap', (m) => {
    for (const [id, x, y, z, ry, sp, g, hp, al, kills] of m.p) {
      stats.set(id, { hp, alive: !!al, kills });
      if (id === info.id) {
        if (hp !== myHp) { myHp = hp; UI.setHealth(hp, maxHp); }
        if (kills !== myKills) { myKills = kills; UI.setKills(kills); }
        continue;
      }
      const r = remotes.get(id);
      if (!r) continue;
      r.target.x = x; r.target.y = y; r.target.z = z; r.target.ry = ry;
      r.speed = sp; r.grounded = !!g;
      if (r.alive !== !!al) { r.alive = !!al; r.avatar.setDead(!al); }
      if (r.fresh) { r.fresh = false; r.avatar.group.position.set(x, y, z); r.avatar.group.rotation.y = ry; }
    }
    const seen = new Set();
    for (const [id, x, y, z, ry, st] of m.z) {
      seen.add(id);
      const v = zviews.get(id) || makeZombie(id, x, y, z, ry);
      v.target.x = x; v.target.y = y; v.target.z = z; v.target.ry = ry; v.st = st;
    }
    for (const [id, v] of zviews) if (!seen.has(id)) v.view.die(); // gone from the server = dead
  });

  net.on('ev', (m) => {
    if (m.k === 'swing') { const r = remotes.get(m.id); if (r) r.avatar.attack(); }
    else if (m.k === 'zhit') { const v = zviews.get(m.id); if (v) v.view.flash(); }
    else if (m.k === 'zdie') {
      const v = zviews.get(m.id);
      if (v) v.view.die();
      if (m.by === info.id) UI.toast('☠ ज़ॉम्बी ढेर!', 900);
    } else if (m.k === 'hurt') {
      if (m.id === info.id) { UI.flashDamage(); myHp = m.hp; UI.setHealth(m.hp, maxHp); }
    } else if (m.k === 'pdie') {
      if (m.id === info.id) {
        alive = false; avatar.setDead(true); UI.showDeath(m.in);
      } else {
        const r = remotes.get(m.id), p = roster.get(m.id);
        if (r) { r.alive = false; r.avatar.setDead(true); }
        if (p) UI.toast(`${p.name} गिर गया!`);
      }
    } else if (m.k === 'respawn') {
      if (m.id === info.id) {
        body.pos.x = m.x; body.pos.z = m.z; body.pos.y = world.heightAt(m.x, m.z);
        body.vel.x = body.vel.y = body.vel.z = 0; body.grounded = true;
        avatar.group.rotation.y = m.yaw; input.yaw = m.yaw;
        alive = true; atkCd = 0; avatar.setDead(false);
        UI.hideDeath();
        UI.toast('वापस आ गए! कुछ सेकंड सुरक्षित हो', 2500);
      } else {
        const r = remotes.get(m.id);
        if (r) { r.alive = true; r.avatar.setDead(false); r.avatar.group.position.set(m.x, m.y, m.z); r.target.x = m.x; r.target.y = m.y; r.target.z = m.z; }
      }
    }
  });

  net.on('chat', (m) => UI.addChat(String(m.name), Number(m.color) || 0xffffff, String(m.text), m.id === info.id));

  let won = false;
  net.on('mission', (m) => {
    applyMissions(m.missions);
    const who = roster.get(m.by);
    const name = who ? (m.by === info.id ? 'तुमने' : who.name + ' ने') : 'किसी ने';
    if (m.event === 'collect') UI.toast(`✨ ${name} एक प्राचीन अवशेष उठाया!`);
    if (m.event === 'visit') UI.toast(`🏛 ${name} नया रुइन्स खोजा`);
    if (m.event === 'kill' && m.missions.find((x) => x.id === 'zombies')?.done) UI.toast('🧟 ज़ॉम्बी शिकारी मिशन पूरा!');
    if (m.allDone && !won) {
      won = true;
      UI.showOverlay('🎉 जंगल का रहस्य सुलझ गया!', 'सभी मिशन पूरे हुए। जंगल में घूमते रहो, या पेज रीलोड करके नया रूम बनाओ।', 'खेलते रहो');
    }
  });
  net.on('close', () => {
    input.enabled = false;
    UI.showOverlay('कनेक्शन टूट गया', 'सर्वर से संपर्क खत्म हो गया (फ़ोन की स्क्रीन बंद हुई या सर्वर रीस्टार्ट हुआ होगा)। पेज रीलोड करके दोबारा जुड़ो।', 'रीलोड करो', () => location.reload());
  });

  function setPixelRatio(v) {
    curPR = v;
    renderer.setPixelRatio(v);
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  const request = (kind, id, now) => {
    const key = kind + id;
    if ((sent.get(key) || 0) > now - 1500) return; // wait for the server before asking again
    sent.set(key, now);
    net.send({ t: kind, id });
  };
  function checkMissions(now) {
    const p = body.pos;
    const relicM = game_missions.find((m) => m.id === 'relics');
    const exploreM = game_missions.find((m) => m.id === 'explore');
    if (relicM && !relicM.done) {
      for (const rel of world.relics) {
        if (relicM.items.includes(rel.id)) continue;
        if (Math.hypot(p.x - rel.x, p.z - rel.z) < 2.4 && Math.abs(p.y - (rel.y - 2.2)) < 3) request('collect', rel.id, now);
      }
    }
    if (exploreM && !exploreM.done) {
      for (const ru of world.ruins) {
        if (exploreM.items.includes(ru.id)) continue;
        if (Math.hypot(p.x - ru.x, p.z - ru.z) < ru.radius - 3) request('visit', ru.id, now);
      }
    }
  }

  const head = new THREE.Vector3(), desired = new THREE.Vector3();
  let last = performance.now(), t = 0, sendAcc = 0, firstFrame = true;
  let warm = 90, accT = 0, accN = 0; // frames to ignore (shader compile), then frame-time average

  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now; t += dt;

    // --- adaptive resolution: if the phone cannot keep up, render fewer pixels
    if (warm > 0) warm--;
    else {
      accT += rawDt; accN++;
      if (accN >= 60) {
        const avg = accT / accN; accT = 0; accN = 0;
        if (avg > 0.034 && curPR > 0.55) setPixelRatio(Math.max(0.55, curPR * 0.85));
        else if (avg < 0.0185 && curPR < basePR - 0.01) setPixelRatio(Math.min(basePR, curPR * 1.1));
      }
    }

    // --- local player
    const raw = input.update(dt);
    const inp = alive ? raw : IDLE_INPUT;
    const wasGrounded = body.grounded;
    body.step(dt, inp);
    if (inp.jump && wasGrounded && !body.grounded) input.consumeJump();
    avatar.group.position.set(body.pos.x, body.pos.y, body.pos.z);
    if (alive && inp.len > 0.05) avatar.group.rotation.y = lerpAngle(avatar.group.rotation.y, Math.atan2(inp.dx, inp.dz), 1 - Math.exp(-14 * dt));
    avatar.animate(dt, body.speed, body.grounded);

    // --- attack: turn towards the nearest living zombie (aim assist), swing, tell the server
    atkCd = Math.max(0, atkCd - dt);
    if (alive && atkCd <= 0 && input.consumeAttack()) {
      atkCd = GAME.attackCooldown;
      let best = null, bd = GAME.attackRange + 1.2;
      for (const v of zviews.values()) {
        if (v.view.dying >= 0) continue;
        const g = v.view.group.position;
        const d = Math.hypot(g.x - body.pos.x, g.z - body.pos.z);
        if (d < bd) { bd = d; best = g; }
      }
      if (best) avatar.group.rotation.y = Math.atan2(best.x - body.pos.x, best.z - body.pos.z);
      avatar.attack();
      net.send({ t: 'attack', ry: r2(wrapAngle(avatar.group.rotation.y)) });
    } else if (!alive) input.consumeAttack();

    // --- network: 15 position updates per second (fallen players send nothing)
    sendAcc += dt;
    if (sendAcc >= 1 / 15) {
      sendAcc = 0;
      if (alive) {
        net.send({
          t: 'state', x: r2(body.pos.x), y: r2(body.pos.y), z: r2(body.pos.z),
          ry: r2(wrapAngle(avatar.group.rotation.y)), sp: r2(body.speed), g: body.grounded ? 1 : 0,
        });
      }
    }
    if (alive) checkMissions(now);

    // --- remote players and zombies: smooth towards the latest server snapshot
    const k = 1 - Math.exp(-12 * dt);
    for (const r of remotes.values()) {
      const g = r.avatar.group;
      g.position.x += (r.target.x - g.position.x) * k;
      g.position.y += (r.target.y - g.position.y) * k;
      g.position.z += (r.target.z - g.position.z) * k;
      g.rotation.y = lerpAngle(g.rotation.y, r.target.ry, k);
      r.avatar.animate(dt, r.speed, r.grounded);
    }
    const kz = 1 - Math.exp(-10 * dt);
    for (const [id, v] of zviews) {
      const g = v.view.group;
      if (v.view.dying < 0) {
        g.position.x += (v.target.x - g.position.x) * kz;
        g.position.y += (v.target.y - g.position.y) * kz;
        g.position.z += (v.target.z - g.position.z) * kz;
        g.rotation.y = lerpAngle(g.rotation.y, v.target.ry, kz);
      }
      v.view.animate(dt, v.st);
      if (v.view.done) { scene.remove(g); v.view.dispose(); zviews.delete(id); }
    }

    rosterT += dt;
    if (rosterT > 0.5) { rosterT = 0; refreshRoster(); }

    // --- third-person camera
    head.set(body.pos.x, body.pos.y + 1.55, body.pos.z);
    const cp = Math.cos(input.pitch), sp = Math.sin(input.pitch);
    desired.set(
      head.x - Math.sin(input.yaw) * input.dist * cp,
      head.y + input.dist * sp,
      head.z - Math.cos(input.yaw) * input.dist * cp,
    );
    const minY = world.heightAt(desired.x, desired.z) + 0.5; // keep the camera above the ground
    if (desired.y < minY) desired.y = minY;
    if (firstFrame) { camera.position.copy(desired); firstFrame = false; }
    else camera.position.lerp(desired, 1 - Math.exp(-16 * dt));
    camera.lookAt(head);

    lighting.update(head, camera.position);
    visuals.update(dt, t);
    flies.update(t, body.pos, world.heightAt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
