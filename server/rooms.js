// server/rooms.js
// A room = 2-4 players + one shared world seed + zombies + mission state. Everything that matters
// for fairness (zombies, damage, kills, missions) is decided here on the server.
import { createWorld, MAX_PLAYERS } from '../shared/worldgen.js';
import { GAME } from '../shared/config.js';
import { MissionTracker } from './missions.js';
import { ZombieManager } from './zombies.js';

const COLORS = [0xe4572e, 0x2e86e4, 0xf2c14e, 0x8e44ad];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
let nextId = 1;

const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

export function cleanName(name, fallback) {
  const s = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  return s || fallback;
}

// Chat text: no control / invisible direction characters, single spaces, at most 120 characters.
export const CHAT_MAX = 120;
// control characters, zero-width and text-direction tricks (right-to-left override etc.)
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g');
export function cleanChat(text) {
  const s = String(text ?? '')
    .replace(INVISIBLE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, CHAT_MAX).join(''); // Array.from: never cut an emoji in half
}

export class Room {
  constructor(code, cfg = GAME) {
    this.code = code;
    this.cfg = cfg;
    this.seed = (Math.random() * 2 ** 32) >>> 0;
    this.world = createWorld(this.seed);
    this.missions = new MissionTracker(this.world);
    this.zombies = new ZombieManager(this.world, cfg);
    this.players = new Map();
    this.killSeq = 0;
  }

  get full() { return this.players.size >= MAX_PLAYERS; }
  get empty() { return this.players.size === 0; }

  addPlayer(conn, name) {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const sp = this.world.spawns[slot];
    const p = {
      id: 'p' + nextId++, slot, color: COLORS[slot % COLORS.length],
      name: cleanName(name, 'खिलाड़ी ' + (slot + 1)), conn,
      x: sp.x, y: sp.y, z: sp.z, ry: sp.yaw, sp: 0, g: 1,
      hp: this.cfg.playerHp, alive: true, respawnT: 0, atkCd: 0,
      shield: this.cfg.spawnShield, sinceHurt: 99, kills: 0,
      chatTokens: 4, chatLast: Date.now(), // chat flood limit: burst of 4, then one message per 1.2 s
    };
    this.players.set(p.id, p);
    conn.send(JSON.stringify({
      t: 'joined', id: p.id, code: this.code, seed: this.seed, slot, maxHp: this.cfg.playerHp,
      players: [...this.players.values()].map((q) => this.publicInfo(q)),
      missions: this.missions.snapshot(),
    }));
    this.broadcast({ t: 'player_joined', player: this.publicInfo(p) }, p.id);
    return p;
  }

  publicInfo(p) { return { id: p.id, name: p.name, slot: p.slot, color: p.color }; }

  removePlayer(p) {
    if (!this.players.delete(p.id)) return;
    this.broadcast({ t: 'player_left', id: p.id });
  }

  broadcast(obj, exceptId) {
    const s = JSON.stringify(obj);
    for (const q of this.players.values()) if (q.id !== exceptId) q.conn.send(s);
  }

  ev(obj) { this.broadcast({ t: 'ev', ...obj }); }

  // ---- messages from a player ------------------------------------------------
  onState(p, m) {
    if (!p.alive) return; // lying on the ground: position is frozen until respawn
    const h = this.world.half;
    const x = num(m.x, -h, h), y = num(m.y, -80, 120), z = num(m.z, -h, h);
    const ry = num(m.ry, -10, 10), sp = num(m.sp, 0, 25);
    if (x === null || y === null || z === null || ry === null || sp === null) return;
    p.x = x; p.y = y; p.z = z; p.ry = ry; p.sp = sp; p.g = m.g ? 1 : 0;
  }

  // text chat: the whole room sees it (the sender too, so everybody has the same order).
  // Fallen players can still talk. Too many messages in a row are silently dropped.
  onChat(p, text) {
    if (typeof text !== 'string') return;
    const msg = cleanChat(text);
    if (!msg) return;
    const now = Date.now();
    p.chatTokens = Math.min(4, p.chatTokens + (now - p.chatLast) / 1200);
    p.chatLast = now;
    if (p.chatTokens < 1) return;
    p.chatTokens -= 1;
    this.broadcast({ t: 'chat', id: p.id, name: p.name, color: p.color, text: msg });
  }

  // collect / visit: the tracker checks the player's last reported position
  onAction(p, event, itemId) {
    if (!p.alive || (event !== 'collect' && event !== 'visit')) return;
    if (this.missions.handle(event, itemId, p)) this.announceMission(p, event, itemId);
  }

  announceMission(p, event, item) {
    this.broadcast({
      t: 'mission', missions: this.missions.snapshot(),
      by: p.id, event, item, allDone: this.missions.allDone,
    });
  }

  // machete swing; `yaw` is the direction the player is facing
  onAttack(p, yaw) {
    if (!p.alive || p.atkCd > 0) return;
    p.atkCd = this.cfg.attackCooldown * 0.85; // a bit shorter than the client's, so jitter never eats a swing
    const a = num(yaw, -10, 10) ?? p.ry;
    p.ry = a;
    this.ev({ k: 'swing', id: p.id });
    for (const { z, died } of this.zombies.melee(p.x, p.z, Math.sin(a), Math.cos(a))) {
      this.ev({ k: 'zhit', id: z.id });
      if (!died) continue;
      p.kills++;
      this.ev({ k: 'zdie', id: z.id, by: p.id });
      const id = ++this.killSeq;
      if (this.missions.handle('kill', id, null, true)) this.announceMission(p, 'kill', id); // trusted: only the server reports kills
    }
  }

  // ---- damage ------------------------------------------------------------------
  hurt(p, dmg) {
    if (!p.alive || p.shield > 0) return;
    p.hp = Math.max(0, p.hp - dmg);
    p.sinceHurt = 0;
    p.conn.send(JSON.stringify({ t: 'ev', k: 'hurt', id: p.id, hp: Math.round(p.hp) }));
    if (p.hp <= 0) {
      p.alive = false;
      p.respawnT = this.cfg.respawnDelay;
      this.ev({ k: 'pdie', id: p.id, in: this.cfg.respawnDelay });
    }
  }

  respawn(p) {
    const sp = this.world.spawns[p.slot];
    p.x = sp.x; p.y = sp.y; p.z = sp.z; p.sp = 0; p.g = 1;
    p.hp = this.cfg.playerHp; p.alive = true; p.shield = this.cfg.spawnShield; p.sinceHurt = 99;
    this.ev({ k: 'respawn', id: p.id, x: r2(sp.x), y: r2(sp.y), z: r2(sp.z), yaw: r2(sp.yaw) });
  }

  // ---- simulation: called ~15x per second --------------------------------------
  update(dt) {
    const list = [...this.players.values()];
    for (const p of list) {
      p.atkCd = Math.max(0, p.atkCd - dt);
      p.sinceHurt += dt;
      if (p.shield > 0) p.shield -= dt;
    }
    this.zombies.update(dt, list, (p, dmg) => this.hurt(p, dmg));
    for (const p of list) {
      if (!p.alive) { p.respawnT -= dt; if (p.respawnT <= 0) this.respawn(p); }
      else if (p.hp < this.cfg.playerHp && p.sinceHurt > this.cfg.regenDelay) {
        p.hp = Math.min(this.cfg.playerHp, p.hp + this.cfg.regenRate * dt);
      }
    }
    this.snapshot(list);
  }

  // players: [id,x,y,z,yaw,speed,grounded,hp,alive,kills]   zombies: [id,x,y,z,yaw,state,hp]
  snapshot(list) {
    if (!list.length) return;
    this.broadcast({
      t: 'snap',
      p: list.map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), r2(p.sp), p.g, Math.round(p.hp), p.alive ? 1 : 0, p.kills]),
      z: this.zombies.rows(),
    });
  }
}

export class RoomManager {
  // game: optional balance overrides on top of shared/config.js (the tests use this)
  constructor(game = {}, { maxRooms = 40 } = {}) {
    this.cfg = { ...GAME, ...game };
    this.maxRooms = maxRooms;
    this.rooms = new Map();
  }

  create() {
    if (this.rooms.size >= this.maxRooms) return null; // protects a small free server from being flooded
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    } while (this.rooms.has(code));
    const room = new Room(code, this.cfg);
    this.rooms.set(code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code ?? '').trim().toUpperCase()); }

  remove(room) { if (room.empty) this.rooms.delete(room.code); }

  tick(dt) { for (const r of this.rooms.values()) r.update(dt); }
}
