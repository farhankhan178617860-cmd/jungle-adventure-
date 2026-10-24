// public/js/effects.js
import * as THREE from 'three';

// Fireflies / floating pollen that follow the player: cheap atmosphere.
export class Fireflies {
  constructor(scene, glowTexture, count = 260) {
    this.count = count;
    this.range = 26;
    this.base = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.base[i * 3] = (Math.random() * 2 - 1) * 1000;
      this.base[i * 3 + 1] = Math.random() * 4.2;
      this.base[i * 3 + 2] = (Math.random() * 2 - 1) * 1000;
    }
    this.positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTexture, size: 0.35, color: 0xffe9a0, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(t, center, heightAt) {
    const size = this.range * 2;
    const wrap = (v) => ((((v + this.range) % size) + size) % size) - this.range;
    for (let i = 0; i < this.count; i++) {
      const bx = this.base[i * 3], bz = this.base[i * 3 + 2];
      const x = center.x + wrap(bx - center.x + Math.sin(t * 0.3 + i) * 0.8);
      const z = center.z + wrap(bz - center.z + Math.cos(t * 0.27 + i * 1.7) * 0.8);
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = heightAt(x, z) + 0.6 + this.base[i * 3 + 1] + Math.sin(t * 0.9 + i * 2.1) * 0.3;
      this.positions[i * 3 + 2] = z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
