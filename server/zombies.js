// server/zombies.js
// ---------------------------------------------------------------------------
// Server-authoritative zombie AI. Zombies exist only on the server; clients just draw the
// positions they receive in the 15 Hz snapshot. Balance numbers live in shared/config.js.
// Yaw convention everywhere: forward = (sin yaw, cos yaw).
// ---------------------------------------------------------------------------
import { ZST } from '../shared/config.js';

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const r2 = (v) => Math.round(v * 100) / 100;

export class ZombieManager {
  constructor(world, cfg) {
    this.world = world;
    this.cfg = cfg;
    this.list = [];
    this.queue = [];      // respawn timers (seconds)
    this.nextId = 1;
    for (let i = 0; i < cfg.zombieCount; i++) this.spawn([]);
  }

  // new zombie somewhere far from the start clearing and from living players
  spawn(alivePlayers) {
    const w = this.world;
    let x = 0, z = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = (Math.random() * 2 - 1) * (w.half - 12);
      z = (Math.random() * 2 - 1) * (w.half - 12);
      if (dist(x, z, 0, 0) < 45) continue;
      if (alivePlayers.some((p) => dist(x, z, p.x, p.z) < 40)) continue;
      if (w.collidersNear(x, z).some((c) => dist(x, z, c.x, c.z) < c.r + 0.8)) continue;
      break;
    }
    this.list.push({
      id: this.nextId++, x, z, ry: Math.random() * Math.PI * 2, hp: this.cfg.zombieHp,
      state: ZST.IDLE, atk: 0, stun: 0, winding: false, chasing: false,
      wanderT: Math.random() * 3, wdx: 0, wdz: 0,
    });
  }

  // walk one step, sliding around tree trunks / pillars and not stacking on other zombies
  move(z, dx, dz, speed, dt) {
    const w = this.world, radius = this.cfg.zombieRadius;
    z.x += dx * speed * dt;
    z.z += dz * speed * dt;
    const near = w.collidersNear(z.x, z.z);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      const ox = z.x - c.x, oz = z.z - c.z, min = c.r + radius;
      const d2 = ox * ox + oz * oz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-4;
        z.x += (ox / d) * (min - d);
        z.z += (oz / d) * (min - d);
      }
    }
    for (const o of this.list) {
      if (o === z) continue;
      const ox = z.x - o.x, oz = z.z - o.z, d2 = ox * ox + oz * oz;
      if (d2 < 0.81 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        z.x += (ox / d) * (0.9 - d) * 0.5;
        z.z += (oz / d) * (0.9 - d) * 0.5;
      }
    }
    this.clamp(z);
  }

  clamp(z) {
    const lim = this.world.half - 4;
    z.x = Math.max(-lim, Math.min(lim, z.x));
    z.z = Math.max(-lim, Math.min(lim, z.z));
  }

  // players: the room's player objects (x, z, alive). onBite(player, damage) is called for every bite.
  update(dt, players, onBite) {
    const c = this.cfg;
    const alive = players.filter((p) => p.alive);

    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.queue[i] -= dt;
      if (this.queue[i] <= 0) { this.queue.splice(i, 1); this.spawn(alive); }
    }

    for (const z of this.list) {
      z.atk = Math.max(0, z.atk - dt);
      if (z.stun > 0) { z.stun -= dt; z.state = ZST.STUN; z.winding = false; continue; }

      let best = null, bd = Infinity;
      for (const p of alive) {
        const d = dist(z.x, z.z, p.x, p.z);
        if (d < bd) { bd = d; best = p; }
      }
      z.chasing = !!best && bd < (z.chasing ? c.zombieLose : c.zombieAggro);

      if (z.chasing) {
        const dx = (best.x - z.x) / (bd || 1), dz = (best.z - z.z) / (bd || 1);
        z.ry = Math.atan2(dx, dz);
        if (bd > c.zombieReach) {
          z.winding = false;
          z.state = ZST.CHASE;
          this.move(z, dx, dz, c.zombieChase, dt);
        } else {
          z.state = ZST.ATTACK;
          if (!z.winding) { z.winding = true; z.atk = Math.max(z.atk, c.zombieWindup); } // raise the arms first
          else if (z.atk <= 0) { z.atk = c.zombieAttackCooldown; onBite(best, c.zombieDamage); }
        }
      } else {
        z.winding = false;
        z.wanderT -= dt;
        if (z.wanderT <= 0) {
          z.wanderT = 2 + Math.random() * 4;
          if (Math.random() < 0.4) { z.wdx = 0; z.wdz = 0; }
          else { const a = Math.random() * Math.PI * 2; z.wdx = Math.sin(a); z.wdz = Math.cos(a); }
        }
        if (z.wdx || z.wdz) {
          z.state = ZST.WALK;
          z.ry = Math.atan2(z.wdx, z.wdz);
          this.move(z, z.wdx, z.wdz, c.zombieWalk, dt);
        } else z.state = ZST.IDLE;
      }
    }
  }

  // Melee swing from (px,pz) facing (fx,fz). Returns [{ z, died }] for up to cfg.attackMax zombies.
  melee(px, pz, fx, fz) {
    const c = this.cfg;
    const cand = [];
    for (const z of this.list) {
      const d = dist(px, pz, z.x, z.z);
      if (d > c.attackRange) continue;
      const dot = d < 0.5 ? 1 : ((z.x - px) * fx + (z.z - pz) * fz) / d;
      if (dot >= c.attackCone) cand.push({ z, d });
    }
    cand.sort((a, b) => a.d - b.d);
    const out = [];
    for (const { z, d } of cand.slice(0, c.attackMax)) {
      z.hp -= c.attackDamage;
      z.stun = 0.3;
      z.winding = false;
      const ox = d > 1e-3 ? (z.x - px) / d : fx, oz = d > 1e-3 ? (z.z - pz) / d : fz;
      z.x += ox * 0.7; z.z += oz * 0.7; // knock-back
      this.clamp(z);
      const died = z.hp <= 0;
      if (died) {
        this.list.splice(this.list.indexOf(z), 1);
        this.queue.push(c.zombieRespawn);
      }
      out.push({ z, died });
    }
    return out;
  }

  // compact rows for the network snapshot: [id, x, y, z, yaw, state, hp]
  rows() {
    const w = this.world;
    return this.list.map((z) => [z.id, r2(z.x), r2(w.heightAt(z.x, z.z)), r2(z.z), r2(z.ry), z.state, Math.max(0, Math.round(z.hp))]);
  }
}
