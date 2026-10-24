// test/fake-dom.js
// A just-enough browser for running public/js/main.js in Node (see test/client-stub.js).
// getElementById only knows the ids that really exist in public/index.html, so a typo in an id
// (which would be `null` in a real browser) fails the test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghost } from './three-stub.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function installDom({ port, search = '' }) {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'index.html'), 'utf8');
  const knownIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  // elements that start hidden in the real page (<div id="hud" hidden>)
  const startHidden = new Set([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].filter((m) => /\shidden(\s|>|=)/.test(m[0])).map((m) => m[1]));

  function makeEl(id) {
    const listeners = new Map();
    const classes = new Set();
    let text = '';
    const el = {
      id, style: {}, children: [], value: '', hidden: false, disabled: false, className: '', width: 0, height: 0, offsetWidth: 0,
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; if (on) classes.add(c); else classes.delete(c); return on; },
        contains: (c) => classes.has(c),
      },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      removeEventListener() {},
      dispatch(type, e = {}) {
        for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, stopPropagation() {}, target: el, ...e });
      },
      append(...n) { el.children.push(...n); },
      appendChild(n) { el.children.push(n); return n; },
      remove() {}, setPointerCapture() {}, releasePointerCapture() {}, requestPointerLock() {},
      getContext: () => ghost('2d'),
    };
    Object.defineProperty(el, 'textContent', {
      get: () => text,
      set: (v) => { text = String(v); if (text === '') el.children.length = 0; },
    });
    return el;
  }

  const els = new Map();
  const getEl = (id) => {
    if (!knownIds.has(id)) return null;
    if (!els.has(id)) { const e = makeEl(id); e.hidden = startHidden.has(id); els.set(id, e); }
    return els.get(id);
  };

  const docListeners = new Map();
  const winListeners = new Map();
  const add = (map) => (type, fn) => { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); };
  const fire = (map) => (type, e = {}) => { for (const fn of map.get(type) || []) fn({ preventDefault() {}, stopPropagation() {}, target: { tagName: 'BODY' }, ...e }); };

  const body = makeEl('body');
  globalThis.document = {
    getElementById: getEl,
    createElement: () => makeEl('created'),
    body, documentElement: { requestFullscreen() {} },
    fullscreenEnabled: false, fullscreenElement: null, exitFullscreen() {},
    pointerLockElement: null, exitPointerLock() {}, visibilityState: 'visible',
    addEventListener: add(docListeners),
  };
  globalThis.window = globalThis;
  globalThis.addEventListener = add(winListeners);
  globalThis.innerWidth = 844;
  globalThis.innerHeight = 390;
  globalThis.devicePixelRatio = 3;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.prompt = () => null;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  globalThis.location = {
    search, href: `http://127.0.0.1:${port}/${search}`, origin: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`, protocol: 'http:', assign() {},
  };
  globalThis.history = { replaceState() {} };

  // requestAnimationFrame: the test decides when frames happen
  const queue = [];
  globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
  let clock = performance.now();
  function pump(frames = 1, ms = 16.7) {
    for (let i = 0; i < frames; i++) {
      clock = Math.max(clock + ms, performance.now()); // never run backwards: the game computes dt from this
      const now = queue.splice(0);
      for (const fn of now) fn(clock);
    }
  }

  return { el: getEl, knownIds, pump, winFire: fire(winListeners), docFire: fire(docListeners) };
}
