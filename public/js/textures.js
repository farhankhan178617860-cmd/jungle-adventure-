// public/js/textures.js
// All textures are drawn procedurally on <canvas>, so the prototype needs no image files.
// To get closer to photo-realism later: replace these with real PBR texture sets (see README).
import * as THREE from 'three';

const hasDOM = typeof document !== 'undefined';
const R = Math.random;
const TAU = Math.PI * 2;
let aniso = 8;
export function setAnisotropy(n) { aniso = n; } // lower on phones: cheaper texture sampling

function make(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  if (!hasDOM) return null; // lets the scene builder run in Node tests
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// draw a shape at (x,y) and its wrapped copies so the texture tiles without seams
function wrapped(size, x, y, r, fn) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy;
      if (px < -r || px > size + r || py < -r || py > size + r) continue;
      fn(px, py);
    }
  }
}

export function groundTexture() {
  return make(512, (ctx, s) => {
    ctx.fillStyle = '#4c5d2b';
    ctx.fillRect(0, 0, s, s);
    const cols = ['#3b4f25', '#59702f', '#6a5b3a', '#2e4220', '#7c6e47', '#44602a'];
    for (let i = 0; i < 5000; i++) {
      const x = R() * s, y = R() * s, r = 1 + R() * 7;
      ctx.globalAlpha = 0.12 + R() * 0.25;
      ctx.fillStyle = cols[(R() * cols.length) | 0];
      wrapped(s, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); });
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 2500; i++) {
      const x = R() * s, y = R() * s;
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = R() < 0.5 ? '#7fa23d' : '#2c4a1c';
      wrapped(s, x, y, 10, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (R() - 0.5) * 4, py - 4 - R() * 6); ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
  }, { repeat: [44, 44] });
}

export function stoneTexture() {
  return make(512, (ctx, s) => {
    ctx.fillStyle = '#8b8878';
    ctx.fillRect(0, 0, s, s);
    const greys = ['#77746a', '#9a978a', '#6c6a60', '#a5a291'];
    for (let i = 0; i < 3500; i++) {
      const x = R() * s, y = R() * s, r = 1 + R() * 9;
      ctx.globalAlpha = 0.1 + R() * 0.25;
      ctx.fillStyle = greys[(R() * greys.length) | 0];
      wrapped(s, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); });
    }
    // moss patches
    for (let i = 0; i < 90; i++) {
      const x = R() * s, y = R() * s, r = 10 + R() * 34;
      ctx.globalAlpha = 0.1 + R() * 0.22;
      ctx.fillStyle = R() < 0.5 ? '#4f6b2f' : '#3c5a26';
      wrapped(s, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); });
    }
    // block seams and cracks
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#3d3b34';
    ctx.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const y = row * (s / 4);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
      const off = (row % 2) * (s / 4);
      for (let k = 0; k < 2; k++) {
        const x = off + k * (s / 2);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s / 4); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      let x = R() * s, y = R() * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 30; y += (R() - 0.3) * 24; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

export function barkTexture() {
  return make(256, (ctx, s) => {
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 420; i++) {
      const x = R() * s, y = R() * s, l = 30 + R() * 110;
      ctx.globalAlpha = 0.18 + R() * 0.3;
      ctx.strokeStyle = R() < 0.5 ? '#2f2418' : '#8a6e4e';
      ctx.lineWidth = 1 + R() * 2.5;
      wrapped(s, x, y, l, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (R() - 0.5) * 6, py + l); ctx.stroke(); });
    }
    for (let i = 0; i < 40; i++) { // moss
      const x = R() * s, y = R() * s, r = 6 + R() * 16;
      ctx.globalAlpha = 0.2; ctx.fillStyle = '#4a6a2a';
      wrapped(s, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); });
    }
    ctx.globalAlpha = 1;
  }, { repeat: [1, 3] });
}

// transparent texture full of leaves; used with alphaTest on canopy blobs
export function leafTexture(repeat = [2, 2]) {
  return make(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const cols = ['#2f6b2a', '#3f8a34', '#245a22', '#4d9a3a', '#1f4d1c', '#5fa844'];
    for (let i = 0; i < 430; i++) {
      const x = R() * s, y = R() * s, a = R() * TAU, l = 13 + R() * 14, w = 5 + R() * 5;
      ctx.fillStyle = cols[(R() * cols.length) | 0];
      wrapped(s, x, y, l, (px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(0, 0, l, w, 0, 0, TAU); ctx.fill();
        ctx.restore();
      });
    }
  }, { repeat });
}

// one fern frond on a transparent background
export function fernTexture() {
  return make(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3d6b2a';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(128, 255); ctx.quadraticCurveTo(122, 130, 128, 12); ctx.stroke();
    for (let i = 0; i < 34; i++) {
      const t = i / 33, y = 250 - t * 232;
      const x = 128 - 5 * Math.sin(t * Math.PI);
      const len = (8 + 52 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08))) * (1 - t * 0.55);
      ctx.lineWidth = 5 * (1 - t * 0.6) + 1.5;
      ctx.strokeStyle = i % 2 ? '#4f8a30' : '#3f7a28';
      for (const sg of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sg * len, y - len * 0.55); ctx.stroke();
      }
    }
  });
}

// soft round dot: fireflies and relic glow
export function glowTexture() {
  return make(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}
