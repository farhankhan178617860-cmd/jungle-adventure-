// public/js/avatar.js
// Procedural explorer character (no model files). It faces +Z; group.rotation.y = yaw.
// Later: load a skinned GLTF here and drive AnimationMixer with the same animate(dt, speed, grounded).
import * as THREE from 'three';

const hasDOM = typeof document !== 'undefined';

function nameTag(name) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px "Noto Sans Devanagari", "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(8, 8, 240, 48, 14); ctx.fill(); }
  else ctx.fillRect(8, 8, 240, 48);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 128, 34, 224);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.renderOrder = 10; // names stay readable through foliage
  sp.scale.set(1.8, 0.45, 1);
  sp.position.y = 2.35;
  return sp;
}

const ATTACK_TIME = 0.3;

export class Avatar {
  constructor(color, name = '') {
    this.group = new THREE.Group();
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.phase = 0;
    this.atkT = 0;
    this.dead = false;

    const mat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const mesh = (geo, m, x, y, z) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z); o.castShadow = true;
      return o;
    };
    const skin = mat(0xe0b08a), shirt = mat(color), pants = mat(0x3a3f4a), pack = mat(0x5b4a32), hat = mat(0x6b4f2a);

    this.rig.add(mesh(new THREE.CapsuleGeometry(0.27, 0.5, 4, 10), shirt, 0, 1.12, 0));
    this.rig.add(mesh(new THREE.SphereGeometry(0.21, 14, 10), skin, 0, 1.7, 0));
    this.rig.add(mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 18), hat, 0, 1.82, 0));
    this.rig.add(mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.16, 14), hat, 0, 1.9, 0));
    this.rig.add(mesh(new THREE.BoxGeometry(0.38, 0.46, 0.2), pack, 0, 1.15, -0.3));

    const limb = (w, h, d, m, x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(mesh(new THREE.BoxGeometry(w, h, d), m, 0, -h / 2, 0));
      this.rig.add(pivot);
      return pivot;
    };
    this.legL = limb(0.17, 0.72, 0.2, pants, -0.12, 0.74);
    this.legR = limb(0.17, 0.72, 0.2, pants, 0.12, 0.74);
    this.armL = limb(0.13, 0.55, 0.13, shirt, -0.37, 1.45);
    this.armR = limb(0.13, 0.55, 0.13, shirt, 0.37, 1.45);

    // a machete in the right hand (hangs along the arm; it swings with the arm)
    const blade = mesh(new THREE.BoxGeometry(0.05, 0.62, 0.1), mat(0xbfc7cc, 0.35), 0, -0.82, 0.06);
    const grip = mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), mat(0x3a2a1a), 0, -0.5, 0.02);
    this.armR.add(blade, grip);

    this.tag = name ? nameTag(name) : null;
    if (this.tag) this.group.add(this.tag);
  }

  attack() { this.atkT = ATTACK_TIME; }

  // fallen players lie on the ground until they respawn
  setDead(d) {
    this.dead = d;
    this.rig.rotation.x = d ? -Math.PI / 2 : 0;
    this.rig.position.y = d ? 0.25 : 0;
  }

  // speed in m/s, grounded: boolean
  animate(dt, speed, grounded) {
    if (this.dead) return;
    const k = Math.min(1, speed / 5.5);
    this.phase += dt * (4 + speed * 1.2);
    const sw = Math.sin(this.phase) * 0.9 * k;
    const f = Math.min(1, dt * 18);
    const aim = (o, v) => { o.rotation.x += (v - o.rotation.x) * f; };
    if (grounded) {
      aim(this.legL, sw); aim(this.legR, -sw);
      aim(this.armL, -sw * 0.8); aim(this.armR, sw * 0.8);
      this.rig.position.y = Math.abs(Math.sin(this.phase)) * 0.06 * k;
    } else { // in the air: legs apart, arms up
      aim(this.legL, 0.5); aim(this.legR, -0.35);
      aim(this.armL, -2.5); aim(this.armR, -2.5);
      this.rig.position.y = 0;
    }
    if (this.atkT > 0) { // machete swing overrides the right arm: raised, then chopped forward
      this.atkT = Math.max(0, this.atkT - dt);
      const p = 1 - this.atkT / ATTACK_TIME;
      this.armR.rotation.x = -2.6 + p * 2.3;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}
