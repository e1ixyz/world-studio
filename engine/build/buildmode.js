import * as THREE from 'three';
import { clamp } from '../core/math.js';

const titleCase = (s) => String(s).replace(/^\w/, (c) => c.toUpperCase());

// Build mode, the in-world half: a free-fly camera separate from the player, hover and click
// selection, and the floating label over the selection. Everything flat (the top bar, the
// Properties and tweaks panel, hints, shortcuts) is studio UI in apps/studio/src/build/, which
// reads state() and calls the methods below through the bridge (packages/bridge). Build mode
// exists only under the studio; a production build is play-only.
export class BuildMode {
  constructor({ app, input, select, tweaks, env, meta, slug, dev, actions }) {
    this.app = app;
    this.cam = app.camera;
    this.input = input;
    this.select = select;
    this.tweaks = tweaks;
    this.env = env;
    this.meta = meta;
    this.slug = slug;
    this.dev = dev;
    this.actions = actions; // { exit, playFromHere, screenshot, toggleFreeze, isFrozen }
    this.active = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.3;
    this.speed = 30;
    this.vel = new THREE.Vector3();
    this.looking = false;
    this.moved = false;
    this.raycaster = new THREE.Raycaster();
    this.hover = null;
    this.hoverHelper = new THREE.Box3Helper(new THREE.Box3(), 0x3cf2ff);
    Object.assign(this.hoverHelper.material, { depthTest: false, transparent: true, opacity: 0.55 });
    this.hoverHelper.renderOrder = 998;
    this.hoverHelper.visible = false;
    app.scene.add(this.hoverHelper);
    this.buildDom();
    this.bindMouse();
    select.onChange((e) => {
      this.el.tag.classList.toggle('show', !!e && this.active);
      if (e) this.el.tagName.textContent = `${titleCase(e.kind)}${e.id != null ? ` ${e.id}` : ''}`;
    });
  }

  get focus() {
    return { x: this.pos.x, z: this.pos.z };
  }

  // What the studio's panels show. Plain data, so it can cross the bridge.
  state() {
    const e = this.select.selected;
    let selection = null;
    if (e) {
      const c = e.box.getCenter(new THREE.Vector3());
      const s = e.box.getSize(new THREE.Vector3());
      selection = { kind: e.kind, id: e.id ?? null, props: e.props || {}, source: e.source || null, center: [c.x, c.y, c.z], size: [s.x, s.y, s.z] };
    }
    const tweak = (d, group) => ({
      key: d.key, name: d.name, group, engine: !!d.engine, type: d.type, value: d.value, initial: d.initial,
      min: d.min, max: d.max, step: d.step, options: d.options || null, save: d.save !== false,
    });
    const tweaks = [];
    for (const [group, defs] of this.tweaks.groups()) for (const d of defs) tweaks.push(tweak(d, group));
    return {
      active: this.active,
      frozen: this.actions.isFrozen(),
      time: this.env.time,
      night: this.env.night,
      moved: this.moved,
      selection,
      tweaks,
      unsaved: this.tweaks.unsaved().length,
      values: this.tweaks.values(),
    };
  }

  setTime(h) {
    this.env.time = ((Number(h) % 24) + 24) % 24;
    this.env.envTimer = 1e9;
  }

  // ---------- DOM: only the floating label ----------
  buildDom() {
    const root = document.createElement('div');
    root.className = 'ws-root bm hidden';
    root.innerHTML = '<div class="ws-tag" aria-live="polite"><span class="ws-tag-name"></span><button type="button" class="ws-btn sm select ws-tag-ask">Ask</button></div>';
    document.body.appendChild(root);
    this.root = root;
    this.el = { tag: root.querySelector('.ws-tag'), tagName: root.querySelector('.ws-tag-name') };
    root.querySelector('.ws-tag-ask').addEventListener('click', () => window.devchat?.focusComposer?.());
  }

  bindMouse() {
    const canvas = this.app.canvas;
    let downAt = null;
    let lastHover = 0;
    canvas.addEventListener('contextmenu', (e) => this.active && e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 2) this.looking = true;
      if (e.button === 0) downAt = [e.clientX, e.clientY];
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.looking = false;
      if (e.button === 0 && downAt && this.active) {
        if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) this.select.select(this.pickAt(e.clientX, e.clientY));
        downAt = null;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      if (this.looking) {
        this.yaw -= e.movementX * 0.003;
        this.pitch = clamp(this.pitch - e.movementY * 0.003, -1.55, 1.55);
        this.markMoved();
        return;
      }
      const now = performance.now();
      if (e.target !== canvas) return this.setHover(null);
      if (now - lastHover < 80) return;
      lastHover = now;
      this.setHover(this.pickAt(e.clientX, e.clientY));
    });
    canvas.addEventListener('mouseleave', () => this.setHover(null));
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.speed = clamp(this.speed * (e.deltaY > 0 ? 0.85 : 1.18), 3, 600);
    }, { passive: false });
  }

  pickAt(cx, cy) {
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.cam);
    return this.select.pick(this.raycaster);
  }

  setHover(e) {
    const same = e && this.select.selected && e.kind === this.select.selected.kind && e.id === this.select.selected.id;
    this.hover = same ? null : e;
    this.hoverHelper.visible = !!this.hover;
    if (this.hover) this.hoverHelper.box.copy(this.hover.box);
    this.app.canvas.style.cursor = e ? 'pointer' : '';
  }

  markMoved() {
    this.moved = true;
  }

  enter() {
    this.active = true;
    this.pos.copy(this.cam.position);
    const d = this.cam.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.root.classList.remove('hidden');
    document.body.classList.add('build-mode');
    this.el.tag.classList.toggle('show', !!this.select.selected);
  }

  exit() {
    this.active = false;
    this.looking = false;
    this.setHover(null);
    this.root.classList.add('hidden');
    this.el.tag.classList.remove('show');
    document.body.classList.remove('build-mode');
  }

  pose() {
    return { pos: this.pos.toArray(), yaw: this.yaw, pitch: this.pitch, speed: this.speed };
  }

  setPose(p) {
    if (!p) return;
    this.pos.fromArray(p.pos);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.speed = p.speed || this.speed;
  }

  // Move the camera to look at the selected object.
  frameSelection() {
    const e = this.select.selected;
    if (!e) return;
    const c = e.box.getCenter(new THREE.Vector3());
    const r = Math.max(6, e.box.getSize(new THREE.Vector3()).length() * 0.9);
    const back = new THREE.Vector3(Math.sin(this.yaw), 0.45, Math.cos(this.yaw)).normalize();
    this.pos.copy(c).addScaledVector(back, r);
    const d = c.clone().sub(this.pos).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(d.y);
  }

  update(dt) {
    const i = this.input;
    const f = (i.any('KeyW', 'ArrowUp') ? 1 : 0) - (i.any('KeyS', 'ArrowDown') ? 1 : 0);
    const s = (i.any('KeyD', 'ArrowRight') ? 1 : 0) - (i.any('KeyA', 'ArrowLeft') ? 1 : 0);
    const u = (i.any('KeyE', 'Space') ? 1 : 0) - (i.any('KeyQ', 'KeyC') ? 1 : 0);
    if (f || s || u) this.markMoved();
    const fast = i.any('ShiftLeft', 'ShiftRight') ? 4 : 1;
    const cp = Math.cos(this.pitch);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, s).addScaledVector(new THREE.Vector3(0, 1, 0), u);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(this.speed * fast);
    this.vel.lerp(want, 1 - Math.exp(-10 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.cam.position.copy(this.pos);
    this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.cam.fov !== 70) {
      this.cam.fov = 70;
      this.cam.updateProjectionMatrix();
    }
    this.select.update();
    this.placeTag();
  }

  // Floating label above the selection.
  placeTag() {
    const e = this.select.selected;
    const tag = this.el.tag;
    if (!e) return;
    const b = e.box;
    const p = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(this.cam);
    const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    tag.classList.toggle('offscreen', !visible);
    if (!visible) return;
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(y, 70))}px) translate(-50%, calc(-100% - 10px))`;
  }
}
