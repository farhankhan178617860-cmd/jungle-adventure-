// public/js/zombie.js
// Procedural zombie (no model files). Faces +Z like the player avatar. The server decides where
// zombies are and what they do; this class only draws and animates them from the state number:
// 0 idle, 1 shamble, 2 chase, 3 attack, 4 stunned.
import * as THREE from 'three';

let G = null, M = null;
function shared() { // geometries / materials shared by all zombies (cheap for phones)
  if (G) return;
  G = {
    torso: new THREE.CapsuleGeometry(0.27, 0.5, 3, 8),
    head: new THREE.SphereGeometry(0.22, 10, 8),
    eye: new THREE.BoxGeometry(0.07, 0.04, 0.03),
    arm: new THREE.BoxGeometry(0.13, 0.62, 0.13),
    leg: new THREE.BoxGeometry(0.17, 0.74, 0.2),
  };
  M = {
    shirt: new THREE.MeshStandardMaterial({ color: 0x3b4a40, roughness: 1 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x2a2e29, roughness: 1 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  };
}

export class ZombieView {
  constructor(id) {
    shared();
    this.id = id;
    this.group = new THREE.Group();
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.skin = new THREE.MeshStandardMaterial({ color: 0x7e9a6a, roughness: 0.9 });
    this.skin.color.multiplyScalar(0.85 + ((id * 37) % 25) / 100); // every zombie a bit different

    const mesh = (geo, mat, x, y, z) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z); o.castShadow = true;
      this.rig.add(o);
      return o;
    };
    mesh(G.torso, M.shirt, 0, 1.1, 0);
    this.head = mesh(G.head, this.skin, 0, 1.72, 0.06);
    mesh(G.eye, M.eye, -0.08, 1.76, 0.2);
    mesh(G.eye, M.eye, 0.08, 1.76, 0.2);

    const limb = (geo, mat, x, y, h) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = -h / 2; m.castShadow = true;
      pivot.add(m);
      this.rig.add(pivot);
      return pivot;
    };
    this.legL = limb(G.leg, M.pants, -0.12, 0.74, 0.74);
    this.legR = limb(G.leg, M.pants, 0.12, 0.74, 0.74);
    this.armL = limb(G.arm, this.skin, -0.36, 1.42, 0.62);
    this.armR = limb(G.arm, this.skin, 0.36, 1.42, 0.62);
    this.armL.rotation.x = this.armR.rotation.x = -1.45; // arms stretched forward

    this.phase = Math.random() * 6;
    this.flashT = 0;
    this.dying = -1; // seconds since death, -1 = alive
    this.done = false;
  }

  flash() { this.flashT = 0.18; }
  die() { if (this.dying < 0) this.dying = 0; }

  animate(dt, st) {
    if (this.dying >= 0) {
      this.dying += dt;
      const k = Math.min(1, this.dying / 0.7);
      this.rig.rotation.x = -k * 1.45; // falls over backwards
      this.legL.rotation.x = this.legR.rotation.x = 0;
      if (this.dying > 3) this.group.position.y -= dt * 0.35; // sinks into the ground
      if (this.dying > 5) this.done = true;
      return;
    }
    if (this.flashT > 0) { this.flashT -= dt; this.skin.emissive.setHex(0x9a1010); }
    else this.skin.emissive.setHex(0x000000);

    const fast = st === 2, walking = st === 1;
    const rate = fast ? 9 : walking ? 4.5 : 1.5;
    this.phase += dt * rate;
    const amp = fast ? 0.8 : walking ? 0.5 : 0.05;
    const s = Math.sin(this.phase) * amp;
    const f = Math.min(1, dt * 12);
    const aim = (o, v) => { o.rotation.x += (v - o.rotation.x) * f; };

    aim(this.legL, s); aim(this.legR, -s);
    if (st === 3) { // attack: arms chop up and down
      const chop = -1.9 + Math.sin(this.phase * 2.2) * 0.9;
      aim(this.armL, chop); aim(this.armR, chop);
    } else {
      aim(this.armL, -1.45 + Math.sin(this.phase * 0.7) * 0.12);
      aim(this.armR, -1.45 + Math.cos(this.phase * 0.7) * 0.12);
    }
    aim(this.rig, fast ? 0.28 : walking ? 0.14 : st === 4 ? -0.25 : 0.05);
    this.rig.position.y = Math.abs(Math.sin(this.phase)) * (fast ? 0.06 : 0.03);
  }

  dispose() { this.skin.dispose(); }
}
