// public/js/lighting.js
// Eerie late-afternoon light: procedural sky, low warm sun with soft shadows that follow the
// player (desktop only), misty green fog. The sky box follows the camera so the camera's far
// plane can stay short on phones.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function setupLighting(scene, { shadows = true, shadowMap = 2048, fog = 0.0125, far = 320 } = {}) {
  const sky = new Sky();
  sky.scale.setScalar(far * 0.6);
  sky.frustumCulled = false;
  scene.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.85;

  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(90 - 26), THREE.MathUtils.degToRad(150));
  u.sunPosition.value.copy(sunDir);

  scene.fog = new THREE.FogExp2(0x86a08a, fog);

  scene.add(new THREE.HemisphereLight(0xcfe0ee, 0x3b4a22, 1.0));

  const sun = new THREE.DirectionalLight(0xffe2b0, 3.0);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(shadowMap, shadowMap);
    const c = sun.shadow.camera;
    c.left = -48; c.right = 48; c.top = 48; c.bottom = -48; c.near = 1; c.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.06;
  }
  scene.add(sun, sun.target);

  return {
    update(center, cameraPos) {
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(sunDir, 130);
      sun.target.updateMatrixWorld();
      if (cameraPos) sky.position.copy(cameraPos);
    },
  };
}
