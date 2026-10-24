// public/js/quality.js
// Graphics presets. Phones default to "low"; desktops to "high".
// Players can pick another one in the lobby, or add ?quality=low|medium|high to the address.
// Cheaper trees (fewer leaf blobs), fewer ferns, no shadows, lower resolution and a shorter view distance are what make
// the game smooth on phones. (The game also lowers its resolution by itself if the frame rate drops.)
export const QUALITY = {
  high: {
    pixelRatio: 1.75, antialias: true, shadows: true, shadowMap: 2048,
    blobs: 6, ferns: 1, fireflies: 240, terrainSeg: 170, sphereSeg: [9, 7], radial: 8, fronds: 6, rockDetail: 1,
    anisotropy: 8, far: 320, fog: 0.0125, chunk: 48, relicLights: true,
  },
  medium: {
    pixelRatio: 1.5, antialias: false, shadows: false, shadowMap: 1024,
    blobs: 4, ferns: 0.7, fireflies: 120, terrainSeg: 140, sphereSeg: [7, 5], radial: 7, fronds: 5, rockDetail: 0,
    anisotropy: 4, far: 240, fog: 0.017, chunk: 44, relicLights: false,
  },
  low: {
    pixelRatio: 1.25, antialias: false, shadows: false, shadowMap: 1024,
    blobs: 3, ferns: 0.4, fireflies: 60, terrainSeg: 100, sphereSeg: [6, 4], radial: 6, fronds: 4, rockDetail: 0,
    anisotropy: 2, far: 170, fog: 0.023, chunk: 40, relicLights: false, // point lights are costly on phones: glow sprites only
  },
};

export function isTouchDevice(params) {
  if (params.get('touch') === '1') return true;   // handy to test the touch UI on a PC
  if (params.get('touch') === '0') return false;
  try { return matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

export function pickQuality(params, touch) {
  const q = params.get('quality');
  if (QUALITY[q]) return q;
  let saved = null;
  try { saved = localStorage.getItem('jr_quality'); } catch { /* ignore */ }
  if (QUALITY[saved]) return saved;
  return touch ? 'low' : 'high';
}
