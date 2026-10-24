// public/js/world.js
// Builds all jungle visuals from the deterministic world description (shared/worldgen.js).
// Everything is procedural: terrain, instanced trees/ferns/rocks, ruins, vines, relics.
// To use real art later: swap a builder (e.g. buildTrees) for a GLTF-based one; the rest stays.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../shared/worldgen.js';
import * as TX from './textures.js';
import { QUALITY } from './quality.js';

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

// non-indexed + vertex colours (darker towards the bottom) so geometries can be merged
function prep(geo, color, bottomDarken = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, n = pos.count;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, h = Math.max(1e-4, g.boundingBox.max.y - y0);
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 1 - bottomDarken * (1 - (pos.getY(i) - y0) / h);
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function place(g, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1, sx = s, sy = s, sz = s } = {}) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

const frac = (v) => v - Math.floor(v);

// Split a list of {x,z} items into square map chunks. Each chunk becomes its own InstancedMesh,
// so the GPU skips every chunk outside the camera view. That is the biggest win on phones.
function chunkify(items, size) {
  const cells = new Map();
  for (const it of items) {
    const key = Math.floor(it.x / size) + ',' + Math.floor(it.z / size);
    let arr = cells.get(key);
    if (!arr) { arr = []; cells.set(key, arr); }
    arr.push(it);
  }
  return [...cells.values()];
}
function finishInstanced(mesh, { cast = false, receive = true } = {}) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  if (mesh.computeBoundingSphere) mesh.computeBoundingSphere(); // needed for per-chunk frustum culling
  mesh.frustumCulled = true;
  return mesh;
}

// ---------------------------------------------------------------- terrain
function buildTerrain(world, tex, cfg) {
  const size = world.size + 24, seg = cfg.terrainSeg;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, n = pos.count;
  for (let i = 0; i < n; i++) pos.setY(i, world.heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const v = 0.5 + 0.5 * Math.sin(x * 0.13 + Math.sin(z * 0.09) * 2.0);
    const slope = THREE.MathUtils.smoothstep(1 - nor.getY(i), 0.1, 0.32);
    const gr = 0.78 + 0.22 * v, gg = 0.9 + 0.1 * v, gb = 0.68 + 0.15 * v; // grass tint
    col[i * 3] = gr + (0.98 - gr) * slope;
    col[i * 3 + 1] = gg + (0.8 - gg) * slope;
    col[i * 3 + 2] = gb + (0.64 - gb) * slope;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex.ground, vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ trees
// IMPORTANT: every tree is always drawn (each one has a collision circle, so hiding some would
// create invisible walls). Phones get cheaper trees instead: fewer leaf blobs, fewer polygons.
function treeGeometries(kind, cfg) {
  const trunkH = kind === 0 ? 6.2 : 9.0;
  const trunk = mergeGeometries([
    place(prep(new THREE.CylinderGeometry(0.26, 0.42, trunkH, cfg.radial, 1), 0x7a5c40), { y: trunkH / 2 }),
    place(prep(new THREE.CylinderGeometry(0.42, 0.85, 0.9, cfg.radial, 1), 0x6e5238), { y: 0.45 }),
  ]);
  const all = kind === 0
    ? [[0, 7.0, 0, 2.7], [1.7, 6.2, 0.7, 2.0], [-1.6, 6.4, -0.9, 2.1], [0.5, 8.5, 0.4, 1.9], [0.3, 5.9, -1.8, 1.8], [-0.4, 6.1, 1.9, 1.7]]
    : [[0, 10.0, 0, 2.0], [0.9, 9.0, 0.6, 1.5], [-0.9, 9.3, -0.5, 1.6], [0.2, 11.4, 0.2, 1.3]];
  const keep = kind === 0 ? cfg.blobs : Math.max(2, Math.floor(cfg.blobs * 0.67));
  const [sw, sh] = cfg.sphereSeg;
  const foliage = mergeGeometries(all.slice(0, keep).map(([x, y, z, r], i) =>
    place(prep(new THREE.SphereGeometry(1, sw, sh), i % 2 ? 0x4f9238 : 0x5da03f, 0.5), { x, y, z, sx: r, sy: r * 0.8, sz: r })));
  return { trunk, foliage };
}

function buildTrees(world, tex, cfg) {
  const group = new THREE.Group();
  const barkMat = new THREE.MeshStandardMaterial({ map: tex.bark, vertexColors: true, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({
    map: tex.leaf, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9,
  });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const kind of [0, 1]) {
    const ofKind = world.trees.filter((t) => t.kind === kind);
    if (!ofKind.length) continue;
    const g = treeGeometries(kind, cfg);
    for (const items of chunkify(ofKind, cfg.chunk)) {
      const trunk = new THREE.InstancedMesh(g.trunk, barkMat, items.length);
      const fol = new THREE.InstancedMesh(g.foliage, leafMat, items.length);
      items.forEach((t, i) => {
        const h = frac(t.ry * 7.31);
        dummy.position.set(t.x, t.y - 0.1, t.z);
        dummy.rotation.set(0, t.ry, 0);
        dummy.scale.set(t.s, t.s * (0.9 + 0.2 * h), t.s);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        fol.setMatrixAt(i, dummy.matrix);
        color.setRGB(0.8 + 0.3 * h, 0.85 + 0.2 * frac(h * 13.1), 0.7 + 0.2 * frac(h * 5.7));
        fol.setColorAt(i, color);
      });
      group.add(finishInstanced(trunk, { cast: cfg.shadows }), finishInstanced(fol, { cast: cfg.shadows }));
    }
  }
  return group;
}

// ------------------------------------------------------------ undergrowth
// ferns have no collision, so low-end devices simply get fewer of them
function buildFerns(world, tex, cfg) {
  // fronds fanned around the centre; place() tilts first (rx), then turns around the vertical axis (ry)
  const parts = [];
  for (let i = 0; i < cfg.fronds; i++) {
    parts.push(place(prep(new THREE.PlaneGeometry(0.95, 1.2), 0xffffff), { y: 0.6, ry: (i / cfg.fronds) * TAU, rx: 0.5 }));
  }
  const geo = mergeGeometries(parts);
  const mat = new THREE.MeshStandardMaterial({ map: tex.fern, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
  const all = world.ferns.slice(0, Math.floor(world.ferns.length * cfg.ferns));
  const group = new THREE.Group();
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  for (const items of chunkify(all, cfg.chunk)) {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((f, i) => {
      dummy.position.set(f.x, f.y - 0.05, f.z);
      dummy.rotation.set(0, f.ry, 0);
      dummy.scale.setScalar(f.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const h = frac(f.ry * 3.7);
      color.setRGB(0.65 + 0.35 * h, 0.8 + 0.2 * frac(h * 9.1), 0.55 + 0.25 * frac(h * 4.3));
      mesh.setColorAt(i, color);
    });
    group.add(finishInstanced(mesh, { cast: false }));
  }
  return group;
}

function buildRocks(world, tex, cfg) {
  const geo = new THREE.DodecahedronGeometry(1, cfg.rockDetail);
  const mat = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 1, flatShading: true, color: 0xb9b6a8 });
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  for (const items of chunkify(world.rocks, cfg.chunk)) {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((r, i) => {
      dummy.position.set(r.x, r.y + r.s * 0.25, r.z);
      dummy.rotation.set(0, r.ry, 0);
      dummy.scale.set(r.s, r.s * 0.7, r.s * (0.8 + 0.4 * frac(r.ry * 5.1)));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    group.add(finishInstanced(mesh, { cast: cfg.shadows }));
  }
  return group;
}

// ------------------------------------------------------------------ vines
function makeVine(pts, radius, rnd, vineGeos, leafGeos) {
  const curve = new THREE.CatmullRomCurve3(pts);
  vineGeos.push(prep(new THREE.TubeGeometry(curve, 10, radius, 5, false), 0x35541f));
  const n = 4 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const p = curve.getPoint(0.1 + 0.85 * rnd());
    leafGeos.push(place(prep(new THREE.PlaneGeometry(0.5, 0.5), 0x7cbd58), {
      x: p.x, y: p.y, z: p.z, ry: rnd() * TAU, rx: (rnd() - 0.5) * 1.2, rz: (rnd() - 0.5) * 1.0,
    }));
  }
}

function finishVines(vineGeos, leafGeos, tex) {
  const group = new THREE.Group();
  if (vineGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(vineGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    m.castShadow = true;
    group.add(m);
  }
  if (leafGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(leafGeos), new THREE.MeshStandardMaterial({
      map: tex.vineLeaf, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9,
    }));
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

// ------------------------------------------------------------------ ruins
function buildRuins(world, tex, rnd, vineGeos, leafGeos) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ map: tex.stone, vertexColors: true, roughness: 0.95 });
  const grey = new THREE.Color(0x8e8b7c), moss = new THREE.Color(0x56703a);

  for (const r of world.ruins) {
    const parts = [];
    const y0 = r.baseY + 0.1; // top of the platform slab
    const add = (geo, opts, dark = 0.35) => {
      const c = grey.clone().lerp(moss, rnd() * 0.55).multiplyScalar(0.75 + rnd() * 0.3);
      parts.push(place(prep(geo, c, dark), opts));
    };

    add(new THREE.CylinderGeometry(9.8, 10.3, 0.4, 30), { x: r.x, y: r.baseY - 0.1, z: r.z }, 0.2);

    // altar (relic hovers above it)
    add(new THREE.BoxGeometry(2.4, 0.5, 2.4), { x: r.x, y: r.baseY + 0.35, z: r.z, ry: r.rot });
    add(new THREE.BoxGeometry(1.8, 0.6, 1.8), { x: r.x, y: r.baseY + 0.9, z: r.z, ry: r.rot });
    add(new THREE.BoxGeometry(2.1, 0.2, 2.1), { x: r.x, y: r.baseY + 1.3, z: r.z, ry: r.rot });

    for (const p of r.pillars) {
      add(new THREE.CylinderGeometry(p.r * 0.85, p.r, p.h, 10, 2), { x: p.x, y: y0 + p.h / 2, z: p.z });
      add(new THREE.BoxGeometry(p.r * 2.4, 0.35, p.r * 2.4), { x: p.x, y: y0 + 0.17, z: p.z, ry: r.rot });
      if (!p.broken) {
        add(new THREE.BoxGeometry(p.r * 2.5, 0.35, p.r * 2.5), { x: p.x, y: y0 + p.h + 0.17, z: p.z, ry: r.rot });
      } else { // a fallen drum next to the stump
        add(new THREE.CylinderGeometry(p.r * 0.85, p.r * 0.85, 1.2 + rnd(), 10),
          { x: p.x + 1.1, y: y0 + p.r * 0.85, z: p.z + 0.6, rz: Math.PI / 2, ry: rnd() * TAU });
      }
      if (rnd() < 0.6) { // vine spiralling up the pillar
        const pts = [], turns = 1.5 + rnd() * 1.5, steps = 14, ph = rnd() * TAU;
        const top = y0 + p.h * (0.5 + rnd() * 0.5);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, a = ph + t * turns * TAU;
          pts.push(new THREE.Vector3(p.x + Math.cos(a) * (p.r + 0.05), y0 + t * (top - y0), p.z + Math.sin(a) * (p.r + 0.05)));
        }
        makeVine(pts, 0.045, rnd, vineGeos, leafGeos);
      }
    }

    for (const w of r.walls) {
      const n = Math.max(2, Math.round(w.len / 1.1)), bw = w.len / n;
      const c = Math.cos(w.ry), s = Math.sin(w.ry);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * bw, hh = w.h * (0.45 + rnd() * 0.55);
        add(new THREE.BoxGeometry(bw * 0.98, hh, 0.85), { x: w.x + off * c, y: y0 + hh / 2, z: w.z - off * s, ry: w.ry }, 0.4);
      }
    }

    { // entrance arch
      const a = r.arch, c = Math.cos(a.ry), s = Math.sin(a.ry);
      for (const sg of [-1, 1]) {
        const off = (sg * a.w) / 2;
        add(new THREE.BoxGeometry(0.95, a.h, 0.95), { x: a.x + off * c, y: y0 + a.h / 2, z: a.z - off * s, ry: a.ry });
      }
      add(new THREE.BoxGeometry(a.w + 1.6, 0.8, 1.1), { x: a.x, y: y0 + a.h + 0.4, z: a.z, ry: a.ry });
    }

    for (const b of r.blocks) {
      add(new THREE.BoxGeometry(b.sx, b.sy, b.sz),
        { x: b.x, y: y0 + b.sy / 2 - 0.1, z: b.z, ry: b.ry, rx: (rnd() - 0.5) * 0.15, rz: (rnd() - 0.5) * 0.15 }, 0.3);
    }

    const mesh = new THREE.Mesh(mergeGeometries(parts), stoneMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// ----------------------------------------------------------------- relics
function buildRelics(world, tex, cfg) {
  const group = new THREE.Group();
  const items = [];
  const gemGeo = new THREE.OctahedronGeometry(0.35, 0);
  for (const rel of world.relics) {
    const gem = new THREE.Mesh(gemGeo, new THREE.MeshStandardMaterial({
      color: 0x99ffee, emissive: 0x44ffd0, emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.3,
    }));
    gem.scale.set(1, 1.5, 1);
    gem.position.set(rel.x, rel.y, rel.z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex.glow, color: 0x66ffe0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    glow.position.copy(gem.position);
    glow.scale.setScalar(2.4);
    let light = null; // real lights make every pixel on screen more expensive: only on "high"
    if (cfg.relicLights) {
      light = new THREE.PointLight(0x66ffe0, 25, 14, 2);
      light.position.copy(gem.position);
      group.add(light);
    }
    group.add(gem, glow);
    items.push({ id: rel.id, gem, glow, light, baseY: rel.y, collected: false });
  }
  return { group, items };
}

// ----------------------------------------------------------------- public
export function buildWorld(world, { quality = 'high' } = {}) {
  const cfg = QUALITY[quality] || QUALITY.high;
  TX.setAnisotropy(cfg.anisotropy);
  const rnd = mulberry32(world.seed ^ 0x51ed270b); // decoration randomness is seeded too: same look for everybody
  const tex = {
    ground: TX.groundTexture(), stone: TX.stoneTexture(), bark: TX.barkTexture(),
    leaf: TX.leafTexture([2, 2]), vineLeaf: TX.leafTexture([1, 1]), fern: TX.fernTexture(), glow: TX.glowTexture(),
  };

  const group = new THREE.Group();
  group.add(buildTerrain(world, tex, cfg));
  group.add(buildTrees(world, tex, cfg));
  group.add(buildFerns(world, tex, cfg));
  group.add(buildRocks(world, tex, cfg));

  const vineGeos = [], leafGeos = [];
  group.add(buildRuins(world, tex, rnd, vineGeos, leafGeos));
  for (const v of world.vines) { // hanging jungle vines
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      pts.push(new THREE.Vector3(v.x + v.sx * Math.sin(t * 3.1) * 1.2, v.top - v.len * t, v.z + v.sz * Math.sin(t * 2.3) * 1.2));
    }
    makeVine(pts, 0.04, rnd, vineGeos, leafGeos);
  }
  group.add(finishVines(vineGeos, leafGeos, tex));

  const relics = buildRelics(world, tex, cfg);
  group.add(relics.group);

  return {
    group,
    glowTexture: tex.glow,
    update(dt, t) {
      for (const r of relics.items) {
        if (r.collected) continue;
        r.gem.rotation.y += dt * 1.2;
        const y = r.baseY + Math.sin(t * 2 + r.id) * 0.15;
        r.gem.position.y = y; r.glow.position.y = y;
        r.glow.scale.setScalar(2.2 + Math.sin(t * 3 + r.id) * 0.3);
      }
    },
    // ids = relic ids that are already collected
    setCollected(ids) {
      const set = new Set(ids);
      for (const r of relics.items) {
        const c = set.has(r.id);
        r.collected = c;
        r.gem.visible = !c; r.glow.visible = !c;
        if (r.light) r.light.intensity = c ? 0 : 25; // keep the light object so the shaders do not recompile
      }
    },
  };
}
