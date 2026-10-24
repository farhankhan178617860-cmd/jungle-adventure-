// server/missions.js
// Server-authoritative mission progress for one room.
import { missionDefs } from '../shared/missions.js';

const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export class MissionTracker {
  constructor(world) {
    this.world = world;
    this.state = missionDefs(world).map((d) => ({ ...d, items: [], done: false }));
  }

  // Is the player (last reported position) close enough to the item?
  validate(event, itemId, pos) {
    const w = this.world;
    if (event === 'collect') {
      const relic = w.relics[itemId];
      return !!relic && d2(pos.x, pos.z, relic.x, relic.z) < 7 && Math.abs(pos.y - (relic.y - 2.2)) < 6;
    }
    if (event === 'kill') return true; // only the server itself reports kills (clients cannot send 'kill')
    if (event === 'visit') {
      const ruin = w.ruins[itemId];
      return !!ruin && d2(pos.x, pos.z, ruin.x, ruin.z) < ruin.radius;
    }
    return false;
  }

  // trusted = true is used by the server itself (kills). Missions flagged `server`
  // can ONLY be advanced that way, and client-reported missions can never be advanced that way.
  // Returns the updated mission if something changed, otherwise null.
  handle(event, itemId, pos, trusted = false) {
    const m = this.state.find((s) => s.event === event);
    if (!m || m.done || !!m.server !== trusted) return null;
    if (!Number.isInteger(itemId) || m.items.includes(itemId)) return null;
    if (!trusted && !this.validate(event, itemId, pos)) return null;
    m.items.push(itemId);
    if (m.items.length >= m.goal) m.done = true;
    return m;
  }

  get allDone() { return this.state.every((m) => m.done); }

  snapshot() {
    return this.state.map((m) => ({
      id: m.id, title: m.title, desc: m.desc, goal: m.goal,
      progress: m.items.length, items: m.server ? [] : [...m.items], done: m.done,
    }));
  }
}
