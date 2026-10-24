// shared/worldgen.js
// ---------------------------------------------------------------------------
// Deterministic world generator. SERVER and every CLIENT call createWorld(seed)
// and get the exact same jungle: terrain height, trees, rocks, ruins, relics.
// Only the seed travels over the network, never the map itself.
// This file must stay free of browser / Node specific APIs.
// ---------------------------------------------------------------------------

export const WORLD_SIZE = 240;   // metres, square map centred on (0,0)
export const MAX_PLAYERS = 4;
export const RUIN_COUNT = 5;     // one relic per ruin
const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
const dist = (ax, az, bx, bz) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 2147483629)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct = 4) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function createWorld(seedIn) {
  const seed = seedIn >>> 0;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const half = WORLD_SIZE / 2;

  // ---- spatial grid for collision circles --------------------------------
  const CELL = 6;
  const grid = new Map();
  const colliders = [];
  const gk = (cx, cz) => (cx + 100) * 1000 + (cz + 100);
  const EMPTY = [];
  function addCollider(x, z, r) {
    const c = { x, z, r };
    colliders.push(c);
    const x0 = Math.floor((x - r - 1) / CELL), x1 = Math.floor((x + r + 1) / CELL);
    const z0 = Math.floor((z - r - 1) / CELL), z1 = Math.floor((z + r + 1) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = gk(cx, cz);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(c);
      }
    }
  }
  const collidersNear = (x, z) => grid.get(gk(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY;

  // ---- terrain --------------------------------------------------------------
  const raw = (x, z) =>
    (fbm(x * 0.011 + 37.2, z * 0.011 + 91.7, seed, 4) - 0.5) * 28 +
    (fbm(x * 0.06, z * 0.06, seed + 7, 2) - 0.5) * 2.5;
  const spawnY = raw(0, 0);

  // ---- ruin sites -------------------------------------------------------------
  const ruins = [];
  for (let tries = 0; ruins.length < RUIN_COUNT && tries < 4000; tries++) {
    const minD = tries < 1500 ? 52 : 34;
    const x = (rng() * 2 - 1) * (half - 32);
    const z = (rng() * 2 - 1) * (half - 32);
    if (dist(x, z, 0, 0) < 38) continue;
    if (ruins.some((r) => dist(r.x, r.z, x, z) < minD)) continue;
    ruins.push({ id: ruins.length, x, z, rot: rng() * TAU, radius: 13, baseY: raw(x, z) });
  }
  while (ruins.length < RUIN_COUNT) { // practically unreachable safety net
    const a = (ruins.length / RUIN_COUNT) * TAU;
    const x = Math.cos(a) * 60, z = Math.sin(a) * 60;
    ruins.push({ id: ruins.length, x, z, rot: rng() * TAU, radius: 13, baseY: raw(x, z) });
  }

  function heightAt(x, z) {
    let h = raw(x, z);
    const ds = dist(x, z, 0, 0);
    if (ds < 16) h = lerp(h, spawnY, smoothstep(16, 8, ds));
    for (let i = 0; i < ruins.length; i++) {
      const r = ruins[i];
      const d = dist(x, z, r.x, r.z);
      if (d < r.radius + 10) h = lerp(h, r.baseY, smoothstep(r.radius + 10, r.radius - 2, d));
    }
    return h;
  }

  // ---- ruin contents (pillars, walls, arch, blocks, altar) ---------------
  // Local ruin coords (lx,lz) -> world, using three.js rotation.y convention.
  for (const r of ruins) {
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    const toW = (lx, lz) => ({ x: r.x + lx * c + lz * s, z: r.z - lx * s + lz * c });
    const ringR = 7.6, n = 8;
    r.pillars = []; r.walls = []; r.blocks = [];

    for (let k = 1; k < n; k++) { // k=0 is the entrance arch
      if (rng() < 0.15) continue;
      const ang = (k / n) * TAU + (rng() - 0.5) * 0.15;
      const p = toW(Math.cos(ang) * ringR, Math.sin(ang) * ringR);
      const broken = rng() < 0.4;
      const h = broken ? 1.6 + rng() * 1.8 : 4 + rng() * 2;
      r.pillars.push({ x: p.x, z: p.z, h, r: 0.55, broken });
      addCollider(p.x, p.z, 0.62);
    }
    for (let k = 0; k < n; k++) {
      if (rng() < 0.45) continue;
      const ang = ((k + 0.5) / n) * TAU;
      const p = toW(Math.cos(ang) * ringR, Math.sin(ang) * ringR);
      const len = 4.4, ry = r.rot - (ang + Math.PI / 2);
      const h = 1.6 + rng() * 1.8;
      r.walls.push({ x: p.x, z: p.z, len, h, ry });
      // circles along the wall (tangent direction in world space)
      const tx = Math.cos(ry), tz = -Math.sin(ry);
      for (let t = -len / 2 + 0.4; t <= len / 2 - 0.3; t += 0.9) addCollider(p.x + tx * t, p.z + tz * t, 0.55);
    }
    {
      const p = toW(ringR, 0), w = 3.4, ry = r.rot - Math.PI / 2;
      r.arch = { x: p.x, z: p.z, w, h: 4.4, ry };
      const tx = Math.cos(ry), tz = -Math.sin(ry);
      addCollider(p.x + (tx * w) / 2, p.z + (tz * w) / 2, 0.6);
      addCollider(p.x - (tx * w) / 2, p.z - (tz * w) / 2, 0.6);
    }
    for (let k = 0; k < 9; k++) {
      const lr = 2.8 + rng() * 7.4, la = rng() * TAU;
      const p = toW(Math.cos(la) * lr, Math.sin(la) * lr);
      const b = { x: p.x, z: p.z, sx: 0.6 + rng() * 1.1, sy: 0.4 + rng() * 0.9, sz: 0.6 + rng() * 1.1, ry: rng() * TAU };
      r.blocks.push(b);
      if (b.sy > 0.7) addCollider(b.x, b.z, Math.max(b.sx, b.sz) * 0.55);
    }
    addCollider(r.x, r.z, 1.5); // altar
  }

  // ---- trees ------------------------------------------------------------------
  const TREE_TARGET = 1150;
  const trees = [];
  const occ = new Set();
  const lim = half - 3;
  for (let i = 0; i < 9000 && trees.length < TREE_TARGET; i++) {
    const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
    if (dist(x, z, 0, 0) < 9.5) continue;
    if (ruins.some((r) => dist(x, z, r.x, r.z) < r.radius - 0.5)) continue;
    const n = fbm(x * 0.035 + 11, z * 0.035 + 5, seed + 99, 2);
    if (rng() > 0.55 + n * 0.9) continue;
    const key = Math.floor(x / 3) * 10000 + Math.floor(z / 3);
    if (occ.has(key)) continue;
    occ.add(key);
    const s = 0.85 + rng() * 1.25;
    const t = { x, z, y: heightAt(x, z), s, ry: rng() * TAU, kind: rng() < 0.3 ? 1 : 0 };
    trees.push(t);
    addCollider(x, z, 0.34 * s);
  }

  // ---- rocks ------------------------------------------------------------------
  const rocks = [];
  for (let i = 0; i < 400 && rocks.length < 140; i++) {
    const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
    if (dist(x, z, 0, 0) < 6) continue;
    if (ruins.some((r) => dist(x, z, r.x, r.z) < r.radius - 1)) continue;
    const s = 0.5 + rng() * rng() * 2.6;
    rocks.push({ x, z, y: heightAt(x, z), s, ry: rng() * TAU });
    if (s > 0.9) addCollider(x, z, s * 0.85);
  }

  // ---- ferns / undergrowth ----------------------------------------------------
  const ferns = [];
  for (let i = 0; i < 6000 && ferns.length < 2800; i++) {
    const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
    if (dist(x, z, 0, 0) < 3) continue;
    if (ruins.some((r) => dist(x, z, r.x, r.z) < 2.5)) continue;
    ferns.push({ x, z, y: heightAt(x, z), s: 0.7 + rng() * 0.9, ry: rng() * TAU });
  }

  // ---- hanging vines (attached to bigger trees) -------------------------------
  const vines = [];
  for (const t of trees) {
    if (vines.length >= 90) break;
    if (t.s < 1.15 || rng() > 0.3) continue;
    const a = rng() * TAU, rad = (1.2 + rng() * 1.2) * t.s;
    const top = t.y + (6.0 + rng() * 0.9) * t.s;
    const len = Math.min(top - t.y - 1.0, 3 + rng() * 5 * Math.min(1.5, t.s));
    vines.push({
      x: t.x + Math.cos(a) * rad, z: t.z + Math.sin(a) * rad,
      top, len, sx: (rng() - 0.5) * 0.7, sz: (rng() - 0.5) * 0.7,
    });
  }

  // ---- relics (one on each ruin's altar) and spawn points ---------------------
  const relics = ruins.map((r) => ({ id: r.id, x: r.x, z: r.z, y: r.baseY + 2.2, ruinId: r.id }));
  const spawns = [];
  for (let k = 0; k < MAX_PLAYERS; k++) {
    const a = (k / MAX_PLAYERS) * TAU + Math.PI / 4;
    const x = Math.cos(a) * 3, z = Math.sin(a) * 3;
    // yaw convention: forward = (sin yaw, cos yaw); face the clearing centre
    spawns.push({ x, z, y: heightAt(x, z), yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) });
  }

  return {
    seed, size: WORLD_SIZE, half,
    heightAt, collidersNear, colliders,
    ruins, trees, rocks, ferns, vines, relics, spawns,
  };
}
