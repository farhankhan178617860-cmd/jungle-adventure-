// public/js/physics.js
// Pure maths character controller (no THREE, no DOM): easy to test and to replace later
// (e.g. with a server-authoritative version or a real physics engine).

export const PHYS = {
  walk: 5.2, run: 9.0, accel: 14, airAccel: 4,
  gravity: 26, jump: 9.5, radius: 0.4,
};

export class PlayerBody {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.grounded = false;
  }

  spawn(p) {
    this.pos.x = p.x; this.pos.z = p.z;
    this.pos.y = this.world.heightAt(p.x, p.z);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.grounded = true;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  // input: { dx, dz (unit-or-smaller world direction), run, jump }
  step(dt, input) {
    const { pos, vel, world } = this;
    const target = input.run ? PHYS.run : PHYS.walk;
    const a = 1 - Math.exp(-(this.grounded ? PHYS.accel : PHYS.airAccel) * dt);
    vel.x += (input.dx * target - vel.x) * a;
    vel.z += (input.dz * target - vel.z) * a;

    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    // circle colliders (tree trunks, pillars, walls, rocks, blocks)
    const near = world.collidersNear(pos.x, pos.z);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = c.r + PHYS.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-4;
        const nx = dx / d, nz = dz / d;
        pos.x += nx * (min - d);
        pos.z += nz * (min - d);
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
      }
    }

    // invisible wall at the map edge
    const lim = world.half - 4;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));

    // vertical
    const wasGrounded = this.grounded;
    if (input.jump && wasGrounded) { vel.y = PHYS.jump; this.grounded = false; }
    vel.y -= PHYS.gravity * dt;
    pos.y += vel.y * dt;
    const gh = world.heightAt(pos.x, pos.z);
    if (pos.y <= gh) { pos.y = gh; vel.y = 0; this.grounded = true; }
    else if (wasGrounded && vel.y <= 0 && pos.y - gh < 0.35) { pos.y = gh; vel.y = 0; this.grounded = true; } // stick to slopes
    else this.grounded = false;
  }
}
