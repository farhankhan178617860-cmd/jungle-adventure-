// test/stub-loader.js  -- Node module-loader hooks (registered by test/client-stub.js).
// Redirects `import ... from 'three'` and the three/addons used by the game to test/three-stub.js.
// The list of three.js names to fake is read from the client sources, so it never goes stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stubUrl = pathToFileURL(path.join(here, 'three-stub.js')).href;
const clientDir = path.join(here, '..', 'public', 'js');

function usedNames() {
  const names = new Set();
  for (const f of fs.readdirSync(clientDir)) {
    if (!f.endsWith('.js')) continue;
    for (const m of fs.readFileSync(path.join(clientDir, f), 'utf8').matchAll(/THREE\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
  }
  return [...names];
}

const REAL_NAMES = ['Vector3', 'Euler', 'Object3D', 'Group', 'Scene', 'Mesh', 'Sprite', 'Points', 'InstancedMesh',
  'PerspectiveCamera', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'MathUtils'];

function threeSource() {
  const lines = [`import { REAL, ghostClass } from '${stubUrl}';`];
  for (const n of REAL_NAMES) lines.push(`export const ${n} = REAL.${n};`);
  for (const n of usedNames()) if (!REAL_NAMES.includes(n)) lines.push(`export const ${n} = ghostClass('${n}');`);
  return lines.join('\n');
}

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: 'stub:three', shortCircuit: true };
  if (specifier === 'three/addons/objects/Sky.js') return { url: 'stub:sky', shortCircuit: true };
  if (specifier === 'three/addons/utils/BufferGeometryUtils.js') return { url: 'stub:bgu', shortCircuit: true };
  if (specifier.startsWith('three/')) throw new Error(`client-stub: no stub for ${specifier}; add it to test/stub-loader.js`);
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === 'stub:three') return { format: 'module', shortCircuit: true, source: threeSource() };
  if (url === 'stub:sky') {
    return { format: 'module', shortCircuit: true, source: `import { ghostClass } from '${stubUrl}'; export const Sky = ghostClass('Sky');` };
  }
  if (url === 'stub:bgu') {
    return { format: 'module', shortCircuit: true, source: `import { ghost } from '${stubUrl}'; export const mergeGeometries = () => ghost('merged');` };
  }
  return next(url, context);
}
