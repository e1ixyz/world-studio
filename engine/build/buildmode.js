import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { icons } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '')) : esc(v));
const titleCase = (s) => String(s).replace(/^\w/, (c) => c.toUpperCase());
const clock = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const TIPS_KEY = 'worldstudio:build-tips-seen';

// Build mode: a free-fly camera separate from the player, hover + click selection with a floating
// label, the top bar (mode switch, world time, pause, attach view, test from here), and the
// Properties panel (selection card + tweaks).
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
    tweaks.onChange(() => this.active && this.renderTweaks());
    select.onChange((e) => {
      this.renderSelection(e);
      this.el.tag.classList.toggle('show', !!e && this.active);
      if (e) this.el.tagName.textContent = `${titleCase(e.kind)}${e.id != null ? ` ${e.id}` : ''}`;
    });
  }

  get focus() {
    return { x: this.pos.x, z: this.pos.z };
  }

  // ---------- DOM ----------
  buildDom() {
    const root = document.createElement('div');
    root.className = 'ws-root bm hidden';
    root.innerHTML = `
      <header class="ws-top" role="toolbar" aria-label="Build mode">
        <a class="ws-btn quiet ws-back" href="/">${icons.back}<span>Projects</span></a>
        <span class="ws-proj" title="${esc(this.meta?.name)}">${esc(this.meta?.name || this.slug)}</span>
        <div class="ws-seg" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked="false" data-mode="play">${icons.play}<span>Play</span></button>
          <button type="button" role="radio" aria-checked="true" data-mode="build">${icons.build}<span>Build</span></button>
          <span class="ws-kbd" title="Switch with Tab">Tab</span>
        </div>
        <div class="ws-world">
          <label class="ws-time" title="Time of day">
            <span class="ws-time-icon">${icons.sun}</span>
            <output>12:00</output>
            <input type="range" min="0" max="24" step="0.05" aria-label="Time of day">
          </label>
          <button type="button" class="ws-btn ws-pause" aria-pressed="true"></button>
          <button type="button" class="ws-btn ws-shot" title="Attach a screenshot of this view to your next prompt">${icons.camera}<span>Attach view</span><span class="ws-kbd">K</span></button>
          <button type="button" class="ws-btn ws-test" title="Drop the player at the camera and play">${icons.pin}<span>Test from here</span><span class="ws-kbd">P</span></button>
          <button type="button" class="ws-icon ws-helpbtn" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">${icons.help}</button>
        </div>
      </header>

      <aside class="ws-props" aria-label="Properties">
        <div class="ws-props-head">
          <h2>Properties</h2>
          <button type="button" class="ws-icon ws-collapse" title="Hide panel" aria-label="Hide properties panel">${icons.back}</button>
        </div>
        <div class="ws-props-body ws-scroll">
          <section class="ws-sel"></section>
          <section class="ws-tw">
            <div class="ws-tw-head">
              <h3>Tweaks</h3>
              <label class="ws-search">${icons.search}<input type="search" placeholder="Filter" aria-label="Filter tweaks"></label>
            </div>
            <div class="ws-tw-list"></div>
          </section>
        </div>
        <footer class="ws-tw-foot hidden">
          <span class="ws-unsaved"></span>
          <button type="button" class="ws-btn sm quiet ws-discard">Discard</button>
          <button type="button" class="ws-btn sm primary ws-save">Save</button>
        </footer>
      </aside>
      <button type="button" class="ws-rail" title="Show properties" aria-label="Show properties panel">${icons.sliders}</button>

      <div class="ws-tag" aria-live="polite"><span class="ws-tag-name"></span><button type="button" class="ws-btn sm select ws-tag-ask">Ask</button></div>

      <div class="ws-hint">
        <span><b>WASD</b> fly</span><span><b>Right-drag</b> look</span><span><b>Q / E</b> down / up</span><span><b>Shift</b> faster</span><span><b>Scroll</b> speed</span>
        <button type="button" class="ws-btn sm quiet ws-helpbtn">Shortcuts</button>
      </div>

      <div class="ws-sheet hidden" role="dialog" aria-label="Keyboard shortcuts">
        <div class="ws-sheet-head"><h3>Shortcuts</h3><button type="button" class="ws-icon ws-sheet-close" aria-label="Close">${icons.close}</button></div>
        <div class="ws-sheet-cols">
          <div class="ws-sheet-col">
            <p class="ws-sheet-title">Build mode</p>
            <div><span class="k"><span class="ws-kbd">W A S D</span></span><span class="v">Fly</span></div>
            <div><span class="k"><span class="ws-kbd">Q</span> <span class="ws-kbd">E</span></span><span class="v">Down / up</span></div>
            <div><span class="k"><span class="ws-kbd">Shift</span></span><span class="v">Fly faster</span></div>
            <div><span class="k">Right-drag</span><span class="v">Look around</span></div>
            <div><span class="k">Scroll</span><span class="v">Camera speed</span></div>
            <div><span class="k">Click</span><span class="v">Select an object</span></div>
            <div><span class="k"><span class="ws-kbd">F</span></span><span class="v">Frame the selection</span></div>
            <div><span class="k"><span class="ws-kbd">Esc</span></span><span class="v">Deselect</span></div>
            <div><span class="k"><span class="ws-kbd">K</span></span><span class="v">Attach view to prompt</span></div>
            <div><span class="k"><span class="ws-kbd">P</span></span><span class="v">Test from here</span></div>
            <div><span class="k"><span class="ws-kbd">Enter</span></span><span class="v">Write a prompt</span></div>
          </div>
          <div class="ws-sheet-col">
            <p class="ws-sheet-title">Anywhere</p>
            <div><span class="k"><span class="ws-kbd">Tab</span></span><span class="v">Switch Play / Build</span></div>
            <div><span class="k"><span class="ws-kbd">\`</span></span><span class="v">Show / hide Ask</span></div>
            <div><span class="k"><span class="ws-kbd">N</span></span><span class="v">Jump day / night</span></div>
            <div><span class="k"><span class="ws-kbd">G</span></span><span class="v">Graphics quality</span></div>
            <p class="ws-sheet-title">Play mode</p>
            <div><span class="k"><span class="ws-kbd">F</span></span><span class="v">Toggle flight</span></div>
            <div><span class="k"><span class="ws-kbd">M</span></span><span class="v">Map</span></div>
            <div><span class="k"><span class="ws-kbd">Esc</span></span><span class="v">Pause</span></div>
          </div>
        </div>
      </div>

      <div class="ws-tips hidden" role="note">
        <h3>Build by describing what you want</h3>
        <ol>
          <li><b>Fly around</b> with WASD and right-drag to look.</li>
          <li><b>Click anything</b> in the world to select it. Tweaks on the left change it live.</li>
          <li><b>Ask for a change</b> on the right. The game reloads where you are.</li>
        </ol>
        <button type="button" class="ws-btn sm primary ws-tips-ok">Got it</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.el = {
      pause: $('.ws-pause'), timeInput: $('.ws-time input'), timeOut: $('.ws-time output'), timeIcon: $('.ws-time-icon'),
      sel: $('.ws-sel'), list: $('.ws-tw-list'), search: $('.ws-search input'), foot: $('.ws-tw-foot'), unsaved: $('.ws-unsaved'),
      save: $('.ws-save'), discard: $('.ws-discard'), tag: $('.ws-tag'), tagName: $('.ws-tag-name'), hint: $('.ws-hint'),
      sheet: $('.ws-sheet'), tips: $('.ws-tips'),
    };
    root.querySelectorAll('.ws-seg button').forEach((b) => b.addEventListener('click', () => b.dataset.mode === 'play' && this.actions.exit()));
    this.el.pause.addEventListener('click', () => {
      this.actions.toggleFreeze();
      this.syncPause();
    });
    this.el.timeInput.addEventListener('input', () => {
      this.env.time = Number(this.el.timeInput.value);
      this.env.envTimer = 1e9;
      this.syncTime(true);
    });
    $('.ws-shot').addEventListener('click', () => this.actions.screenshot());
    $('.ws-test').addEventListener('click', () => this.actions.playFromHere());
    root.querySelectorAll('.ws-helpbtn').forEach((b) => b.addEventListener('click', () => this.toggleSheet()));
    $('.ws-sheet-close').addEventListener('click', () => this.toggleSheet(false));
    $('.ws-collapse').addEventListener('click', () => this.setCollapsed(true));
    $('.ws-rail').addEventListener('click', () => this.setCollapsed(false));
    $('.ws-tag-ask').addEventListener('click', () => window.devchat?.focusComposer?.());
    $('.ws-tips-ok').addEventListener('click', () => {
      this.el.tips.classList.add('hidden');
      try { localStorage.setItem(TIPS_KEY, '1'); } catch { /* ignore */ }
    });
    this.el.search.addEventListener('input', () => this.filterTweaks());
    this.el.save.addEventListener('click', () => this.saveTweaks());
    this.el.discard.addEventListener('click', () => this.tweaks.discard());
    if (!this.dev) this.el.save.title = 'Saving needs the dev server';
    // typing in the panels never reaches the game
    for (const t of ['keydown', 'keyup']) root.addEventListener(t, (e) => e.target.closest('input, select, textarea') && e.stopPropagation());
    root.addEventListener('keydown', (e) => e.key === 'Escape' && this.toggleSheet(false));
    try { this.setCollapsed(localStorage.getItem('worldstudio:props-collapsed') === '1'); } catch { /* ignore */ }
  }

  setCollapsed(on) {
    this.root.classList.toggle('props-collapsed', on);
    document.body.classList.toggle('ws-props-collapsed', on);
    try { localStorage.setItem('worldstudio:props-collapsed', on ? '1' : '0'); } catch { /* ignore */ }
  }

  toggleSheet(show = this.el.sheet.classList.contains('hidden')) {
    this.el.sheet.classList.toggle('hidden', !show);
  }

  syncPause() {
    const frozen = this.actions.isFrozen();
    this.el.pause.setAttribute('aria-pressed', String(frozen));
    this.el.pause.classList.toggle('on', frozen);
    // the label names the action; the filled style shows the world is paused
    this.el.pause.innerHTML = frozen ? `${icons.play}<span>Resume world</span>` : `${icons.pause}<span>Pause world</span>`;
    this.el.pause.title = frozen ? 'Traffic, people and the clock are paused. Click to run them.' : 'Pause traffic, people and the clock';
  }

  syncTime(fromInput = false) {
    const t = this.env.time;
    if (!fromInput && document.activeElement !== this.el.timeInput) this.el.timeInput.value = t;
    this.el.timeOut.textContent = clock(t);
    const night = this.env.night > 0.5;
    if (this.el.timeIcon.dataset.night !== String(night)) {
      this.el.timeIcon.dataset.night = String(night);
      this.el.timeIcon.innerHTML = night ? icons.moon : icons.sun;
    }
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
    if (this.moved) return;
    this.moved = true;
    this.el.hint.classList.add('quiet');
  }

  enter() {
    this.active = true;
    this.pos.copy(this.cam.position);
    const d = this.cam.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.root.classList.remove('hidden');
    document.body.classList.add('build-mode');
    this.syncPause();
    this.syncTime();
    this.renderTweaks();
    this.renderSelection(this.select.selected);
    this.el.tag.classList.toggle('show', !!this.select.selected);
    let seen = false;
    try { seen = localStorage.getItem(TIPS_KEY) === '1'; } catch { /* ignore */ }
    this.el.tips.classList.toggle('hidden', seen);
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
    this.syncTime();
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

  // ---------- selection card ----------
  renderSelection(e) {
    const box = this.el.sel;
    if (!e) {
      box.className = 'ws-sel empty';
      box.innerHTML = `${icons.target}<p>Click anything in the world to select it, then ask for a change.</p>`;
      return;
    }
    const c = e.box.getCenter(new THREE.Vector3());
    const s = e.box.getSize(new THREE.Vector3());
    const props = Object.entries(e.props || {});
    const main = props.slice(0, 3);
    const rest = props.slice(3);
    const row = ([k, v]) => `<div><dt>${esc(k)}</dt><dd>${fmt(v)}</dd></div>`;
    box.className = 'ws-sel';
    box.innerHTML = `
      <div class="ws-sel-title"><span class="ws-sel-dot"></span><h3>${esc(titleCase(e.kind))}</h3>${e.id != null ? `<span class="ws-sel-id">${esc(e.id)}</span>` : ''}</div>
      <dl class="ws-props-list">${main.map(row).join('')}<div><dt>size</dt><dd>${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} m</dd></div></dl>
      <details class="ws-more"><summary>${icons.chevron}More details</summary>
        <dl class="ws-props-list">${rest.map(row).join('')}<div><dt>position</dt><dd>${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}</dd></div>${e.source ? `<div><dt>code</dt><dd class="ws-src">${esc(e.source)}</dd></div>` : ''}</dl>
      </details>
      <button type="button" class="ws-btn select ws-ask">Ask about this</button>
      <div class="ws-sel-row">
        <button type="button" class="ws-btn sm ws-frame">${icons.frame}<span>Frame</span><span class="ws-kbd">F</span></button>
        <button type="button" class="ws-btn sm quiet ws-clear"><span>Deselect</span><span class="ws-kbd">Esc</span></button>
      </div>`;
    box.querySelector('.ws-ask').addEventListener('click', () => window.devchat?.focusComposer?.());
    box.querySelector('.ws-frame').addEventListener('click', () => this.frameSelection());
    box.querySelector('.ws-clear').addEventListener('click', () => this.select.select(null));
  }

  // ---------- tweaks ----------
  renderTweaks() {
    const own = this.tweaks.groups({ engine: false });
    const engine = this.tweaks.groups({ engine: true });
    const all = [...own.values(), ...engine.values()].flat();
    const sig = all.map((d) => d.key).join('|');
    const list = this.el.list;
    if (this.tweakSig !== sig) {
      this.tweakSig = sig;
      list.innerHTML = '';
      if (!own.size) list.insertAdjacentHTML('beforeend', '<p class="ws-empty">This game has no tweaks of its own yet. Ask to “add tweaks for …” and they show up here.</p>');
      for (const [group, defs] of own) list.appendChild(this.tweakGroup(group, defs, true));
      if (engine.size) {
        const eng = document.createElement('details');
        eng.className = 'ws-group ws-engine';
        eng.innerHTML = `<summary>${icons.chevron}Engine settings<span class="ws-group-note">shared by every game</span></summary>`;
        for (const [group, defs] of engine) eng.appendChild(this.tweakGroup(group, defs, true, true));
        list.appendChild(eng);
      }
      this.filterTweaks();
    }
    for (const d of all) {
      const row = list.querySelector(`[data-key="${CSS.escape(d.key)}"]`);
      if (!row) continue;
      const inp = row.querySelector('input, select');
      if (document.activeElement !== inp) {
        if (d.type === 'bool') inp.checked = !!d.value;
        else inp.value = d.value;
      }
      const out = row.querySelector('output');
      if (out) out.textContent = fmt(d.value);
      row.classList.toggle('changed', d.value !== d.initial);
    }
    const n = this.tweaks.unsaved().length;
    this.el.foot.classList.toggle('hidden', n === 0);
    this.el.unsaved.textContent = `${n} unsaved change${n === 1 ? '' : 's'}`;
    this.el.save.disabled = !this.dev;
  }

  tweakGroup(name, defs, open, nested = false) {
    const g = document.createElement('details');
    g.className = `ws-group${nested ? ' nested' : ''}`;
    g.open = open;
    g.innerHTML = `<summary>${icons.chevron}${esc(name)}</summary>`;
    for (const d of defs) g.appendChild(this.tweakRow(d));
    return g;
  }

  tweakRow(d) {
    const row = document.createElement('div');
    row.className = `ws-tweak t-${d.type}`;
    row.dataset.key = d.key;
    row.dataset.search = `${d.key} ${d.name}`.toLowerCase();
    const id = `tw-${Math.random().toString(36).slice(2, 8)}`;
    let control;
    if (d.type === 'range') control = `<output></output><input id="${id}" type="range" min="${d.min}" max="${d.max}" step="${d.step}">`;
    else if (d.type === 'color') control = `<input id="${id}" type="color">`;
    else if (d.type === 'bool') control = `<input id="${id}" type="checkbox" role="switch">`;
    else control = `<select id="${id}">${(d.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
    row.innerHTML = `<label for="${id}" class="ws-tweak-name">${esc(d.name)}</label>${control}<button type="button" class="ws-reset" title="Reset to default" aria-label="Reset ${esc(d.name)}">${icons.reset}</button>`;
    const inp = row.querySelector('input, select');
    inp.addEventListener('input', () => {
      const v = d.type === 'range' ? Number(inp.value) : d.type === 'bool' ? inp.checked : inp.value;
      this.tweaks.set(d.key, v);
    });
    row.querySelector('.ws-reset').addEventListener('click', () => this.tweaks.reset(d.key));
    return row;
  }

  filterTweaks() {
    const q = this.el.search.value.trim().toLowerCase();
    for (const row of this.el.list.querySelectorAll('.ws-tweak')) row.hidden = !!q && !row.dataset.search.includes(q);
    for (const g of this.el.list.querySelectorAll('details.ws-group')) {
      const any = [...g.querySelectorAll('.ws-tweak')].some((r) => !r.hidden);
      g.hidden = !any;
      if (q && any) g.open = true;
    }
  }

  async saveTweaks() {
    const b = this.el.save;
    b.disabled = true;
    b.textContent = 'Saving…';
    try {
      const res = await fetch('/__harness/tweaks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Devchat': '1' },
        body: JSON.stringify({ slug: this.slug, values: this.tweaks.values() }),
      });
      if (!res.ok) throw new Error(res.statusText);
      this.tweaks.markSaved();
    } catch (err) {
      console.error(err);
      this.el.unsaved.textContent = 'Save failed. Is the dev server running?';
    } finally {
      b.textContent = 'Save';
      b.disabled = !this.dev;
    }
  }
}
