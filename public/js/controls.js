// public/js/controls.js
// Keyboard + mouse AND touch input, plus the orbit-camera angles.
//   Desktop: WASD / arrows move · Shift run · Space jump · F or left click (mouse captured) attack
//            mouse look (click to capture, or drag) · wheel zoom · Q/E turn camera
//   Phone:   left thumb = floating joystick (push to the edge = run) · right thumb drag = look
//            buttons: ⚔ attack, ⤒ jump
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = (id) => document.getElementById(id);

export class Input {
  constructor(canvas, touch = false) {
    this.canvas = canvas;
    this.touch = touch;
    this.keys = new Set();
    this.yaw = 0;          // direction the camera looks at (radians)
    this.pitch = 0.35;     // positive = camera above the player
    this.dist = 5.5;
    this.enabled = false;
    this.jumpBuffer = 0;   // seconds left in which a jump press still counts
    this.attackBuffer = 0;
    this.dragging = false;
    this.touchMove = { x: 0, y: 0 }; // joystick: x right, y forward, each -1..1

    addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.jumpBuffer = 0.14; }
      if ((e.code === 'KeyF' || e.code === 'KeyJ') && !e.repeat) this.attackBuffer = 0.2;
      if (e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touchMove.x = this.touchMove.y = 0; });

    if (touch) { this.initTouch(); return; }

    canvas.addEventListener('click', () => {
      if (this.enabled && canvas.requestPointerLock && document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock(); } catch { /* ignore */ }
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      if (this.enabled && e.button === 0 && this.locked) this.attackBuffer = 0.2; // click = swing (once the mouse is captured)
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas || this.dragging) {
        this.yaw -= e.movementX * 0.0025;
        this.pitch = clamp(this.pitch + e.movementY * 0.0025, -0.25, 1.25);
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = clamp(this.dist + e.deltaY * 0.004, 2.5, 10);
    }, { passive: false });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  initTouch() {
    const zoneMove = $('zoneMove'), zoneLook = $('zoneLook'), joy = $('joy'), knob = $('joyKnob');
    const R = 52; // joystick radius in px

    // --- left thumb: floating joystick that appears where you touch
    let moveId = null, ox = 0, oy = 0;
    zoneMove.addEventListener('pointerdown', (e) => {
      if (moveId !== null) return;
      moveId = e.pointerId; ox = e.clientX; oy = e.clientY;
      try { zoneMove.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      joy.style.left = ox + 'px'; joy.style.top = oy + 'px';
      knob.style.transform = 'translate(-50%, -50%)';
      joy.classList.add('on');
      e.preventDefault();
    });
    zoneMove.addEventListener('pointermove', (e) => {
      if (e.pointerId !== moveId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
      dx *= k; dy *= k;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.touchMove.x = dx / R; this.touchMove.y = -dy / R;
      e.preventDefault();
    });
    const endMove = (e) => {
      if (e.pointerId !== moveId) return;
      moveId = null; this.touchMove.x = this.touchMove.y = 0;
      joy.classList.remove('on');
    };
    zoneMove.addEventListener('pointerup', endMove);
    zoneMove.addEventListener('pointercancel', endMove);

    // --- right thumb: drag to look around
    let lookId = null, lx = 0, ly = 0;
    zoneLook.addEventListener('pointerdown', (e) => {
      if (lookId !== null) return;
      lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
      try { zoneLook.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    zoneLook.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.yaw -= (e.clientX - lx) * 0.0065;
      this.pitch = clamp(this.pitch + (e.clientY - ly) * 0.005, -0.25, 1.25);
      lx = e.clientX; ly = e.clientY;
      e.preventDefault();
    });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    zoneLook.addEventListener('pointerup', endLook);
    zoneLook.addEventListener('pointercancel', endLook);

    // --- buttons
    const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    press($('btnJump'), () => { this.jumpBuffer = 0.14; });
    press($('btnAttack'), () => { this.attackBuffer = 0.2; });

    // stop the browser from scrolling, pull-to-refresh or pinch-zooming the page during play
    document.addEventListener('touchmove', (e) => { if (this.enabled) e.preventDefault(); }, { passive: false });
    for (const g of ['gesturestart', 'gesturechange']) document.addEventListener(g, (e) => e.preventDefault());
  }

  // call once per frame: returns the desired world-space move direction
  update(dt) {
    if (this.keys.has('KeyQ')) this.yaw += 1.8 * dt;
    if (this.keys.has('KeyE')) this.yaw -= 1.8 * dt;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.attackBuffer = Math.max(0, this.attackBuffer - dt);

    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.touchMove.y;
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touchMove.x;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let dx = f * sy + r * -cy;
    let dz = f * cy + r * sy;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    const stick = Math.hypot(this.touchMove.x, this.touchMove.y);
    return {
      dx, dz, len: Math.min(1, len),
      run: k.has('ShiftLeft') || k.has('ShiftRight') || stick > 0.85,
      jump: this.jumpBuffer > 0,
    };
  }

  consumeJump() { this.jumpBuffer = 0; }

  consumeAttack() {
    if (this.attackBuffer <= 0) return false;
    this.attackBuffer = 0;
    return true;
  }
}
