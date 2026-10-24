// public/js/ui.js  -- all DOM / HUD code lives here
const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export function getName() { return $('name').value.trim(); }
export function getCode() { return $('code').value.trim().toUpperCase(); }
export function setCode(c) { $('code').value = c; }
export function setName(n) { $('name').value = n; }
export function onNameInput(fn) { $('name').addEventListener('input', fn); }

export function setLobbyMessage(text, isError = false) {
  const el = $('lobbyMsg');
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}
export function setBusy(b) { $('btnCreate').disabled = b; $('btnJoin').disabled = b; }
export function onCreate(fn) { $('btnCreate').addEventListener('click', fn); }
export function onJoin(fn) { $('btnJoin').addEventListener('click', fn); }

// "install as an app" button (Android / desktop Chrome) and the iPhone hint
export function showInstall(on) { $('btnInstall').hidden = !on; }
export function showInstallHint(on) { $('installHint').hidden = !on; }
export function onInstall(fn) { $('btnInstall').addEventListener('click', fn); }

export function setTouchMode(on) {
  document.body.classList.toggle('touch', !!on);
  $('tipsTouch').hidden = !on;
  $('tipsDesktop').hidden = !!on;
}

// quality <select>: 'auto' | 'high' | 'medium' | 'low'
export function initQualitySelect(current, onChange) {
  const sel = $('quality');
  sel.value = current;
  sel.addEventListener('change', () => onChange(sel.value));
}

export function enterGameUI(code, touch) {
  $('lobby').hidden = true;
  $('hud').hidden = false;
  $('touch').hidden = !touch;
  $('roomCode').textContent = code;
  $('copyLink').onclick = async () => {
    const link = `${location.origin}/?room=${code}`;
    try { await navigator.clipboard.writeText(link); toast('लिंक कॉपी हो गया — दोस्त को भेज दो'); }
    catch { prompt('यह लिंक दोस्त को भेजो:', link); }
  };
  const full = $('btnFull');
  const canFull = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled);
  full.hidden = !canFull; // iPhone Safari has no fullscreen: use "Add to Home Screen" instead
  full.onclick = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch { /* ignore */ }
  };
}

// ------------------------------------------------------------------ chat
// Messages are inserted with textContent only, so nobody can inject HTML through a chat message.
const QUICK_PHRASES = ['🆘 मदद!', '👉 इधर आओ', '🧟 ज़ॉम्बी आ रहे हैं!', '🏃 भागो!', '👍 ठीक है', '✨ अवशेष मिल गया'];
const CHAT_KEEP = 6, CHAT_SHOW_MS = 14000;
let chatOnSend = null;
const chatRows = [];

export function isChatOpen() { return !$('chatBox').hidden; }

export function openChat() {
  if (!$('overlay').hidden || $('hud').hidden) return; // not during the end / disconnect screen
  if (document.exitPointerLock) document.exitPointerLock(); // free the mouse so typing and clicking work
  $('chatBox').hidden = false;
  const inp = $('chatInput');
  if (inp.focus) inp.focus();
}

export function closeChat() {
  $('chatBox').hidden = true;
  const inp = $('chatInput');
  inp.value = '';
  if (inp.blur) inp.blur();
}

export function sendChat(text) {
  const t = String(text || '').trim();
  if (t && chatOnSend) chatOnSend(t);
  closeChat();
}

// onSend(text) is called with every message the player wants to say
export function initChat(onSend) {
  chatOnSend = onSend;
  $('btnChat').onclick = () => (isChatOpen() ? closeChat() : openChat());
  $('chatClose').onclick = closeChat;
  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('chatInput').value); });
  $('chatInput').addEventListener('keydown', (e) => { if (e.code === 'Escape') closeChat(); });
  const quick = $('chatQuick');
  quick.textContent = '';
  for (const phrase of QUICK_PHRASES) { // one-tap messages: easy on a phone keyboard-less moment
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = phrase;
    b.addEventListener('click', () => sendChat(phrase));
    quick.append(b);
  }
}

export function addChat(name, color, text, mine) {
  const log = $('chatLog');
  const row = document.createElement('div');
  row.className = 'msg' + (mine ? ' me' : '');
  const who = document.createElement('b');
  who.textContent = name + ':';
  who.style.color = hex(color);
  const body = document.createElement('span');
  body.textContent = text;
  row.append(who, body);
  log.append(row);
  chatRows.push(row);
  while (chatRows.length > CHAT_KEEP) chatRows.shift().remove(); // only the last few messages stay on screen
  setTimeout(() => row.remove(), CHAT_SHOW_MS);                  // and each one fades away after a while
}

// stats: Map id -> { hp, alive, kills }
export function renderPlayers(list, selfId, stats) {
  const ul = $('players');
  ul.textContent = '';
  for (const p of list) {
    const st = stats && stats.get(p.id);
    const li = document.createElement('li');
    if (st && !st.alive) li.className = 'down';
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = hex(p.color);
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === selfId ? ' (तुम)' : '');
    li.append(dot, name);
    if (st) {
      const s = document.createElement('span');
      s.className = 'pstat';
      s.textContent = (st.alive ? `❤${st.hp}` : '💀') + `  ☠${st.kills}`;
      li.append(s);
    }
    ul.append(li);
  }
}

export function renderMissions(missions) {
  const box = $('missionList');
  box.textContent = '';
  for (const m of missions) {
    const d = document.createElement('div');
    d.className = 'mission' + (m.done ? ' done' : '');
    const h = document.createElement('div');
    h.className = 'mtitle';
    h.textContent = (m.done ? '✔ ' : '') + m.title + `  ${m.progress}/${m.goal}`;
    const p = document.createElement('div');
    p.className = 'mdesc'; p.textContent = m.desc;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = Math.round((m.progress / m.goal) * 100) + '%';
    bar.append(fill);
    d.append(h, p, bar);
    box.append(d);
  }
}

export function setHealth(hp, max) {
  $('hpFill').style.width = Math.max(0, Math.min(100, (hp / max) * 100)) + '%';
  $('hpText').textContent = `❤ ${Math.ceil(hp)} / ${max}`;
  $('hpBox').classList.toggle('low', hp <= max * 0.3);
}
export function setKills(n) { $('kills').textContent = '☠ ' + n; }

export function flashDamage() {
  const el = $('damage');
  el.classList.remove('hit');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('hit');
}

let deathTimer = 0;
export function showDeath(seconds) {
  const end = performance.now() + seconds * 1000;
  $('death').hidden = false;
  clearInterval(deathTimer);
  const tick = () => { $('deathSec').textContent = String(Math.max(0, Math.ceil((end - performance.now()) / 1000))); };
  tick();
  deathTimer = setInterval(tick, 200);
}
export function hideDeath() {
  clearInterval(deathTimer);
  $('death').hidden = true;
}

let toastTimer = 0;
export function toast(text, ms = 3500) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function setClickHint(show) { $('clickHint').hidden = !show; }

export function showOverlay(title, body, btnText, onClick) {
  if (document.exitPointerLock) document.exitPointerLock(); // free the mouse so the button is clickable
  $('ovTitle').textContent = title;
  $('ovBody').textContent = body;
  const b = $('ovBtn');
  b.textContent = btnText;
  b.onclick = () => { $('overlay').hidden = true; onClick && onClick(); };
  $('overlay').hidden = false;
}
