// Engine HUD: builds its own DOM, so a game only calls methods (setObjective, setMap, toast, modal...).
const h = (tag, attrs = {}, html = '') => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (html) n.innerHTML = html;
  return n;
};

export const DEFAULT_CONTROLS = [
  ['W A S D', 'move / drive'],
  ['Mouse', 'look'],
  ['Shift', 'sprint / boost'],
  ['Space', 'jump / fly up / brake'],
  ['F', 'toggle flight'],
  ['C', 'fly down'],
  ['M', 'map'],
  ['G', 'graphics quality'],
];

export class HUD {
  constructor() {
    this.root = h('div', { id: 'hud', class: 'hidden' });
    this.root.innerHTML = `
      <div id="objective" class="hidden"><div class="label"></div><div class="value"></div><div class="sub"></div></div>
      <div id="mapwrap"><canvas id="minimap" width="220" height="220" class="hidden"></canvas><div id="clock"></div></div>
      <div id="crosshair"></div>
      <div id="prompt"></div>
      <div id="toast"></div>
      <div id="speedo"><span id="speed-val">0</span><span class="unit">km/h</span></div>
      <div id="flight"><span class="tag-f">Flight</span><span id="alt-val">0</span><span class="unit">m alt</span></div>
      <div id="fps"></div>
      <div id="hint"></div>`;
    this.bigmap = h('div', { id: 'bigmap', class: 'hidden' }, '<canvas id="bigmap-canvas"></canvas><div class="caption">Press M to close</div>');
    this.menuEl = h('div', { id: 'menu' }, '<div class="panel"></div>');
    this.modalEl = h('div', { id: 'modal', class: 'hidden' }, '<div class="panel"></div>');
    document.body.append(this.root, this.bigmap, this.menuEl, this.modalEl);

    const $ = (id) => document.getElementById(id);
    this.el = {
      objective: $('objective'), clock: $('clock'), prompt: $('prompt'), toast: $('toast'),
      speedo: $('speedo'), speed: $('speed-val'), flight: $('flight'), alt: $('alt-val'),
      fps: $('fps'), cross: $('crosshair'), hint: $('hint'),
    };
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.bigCanvas = $('bigmap-canvas');
    this.map = null;
    this.toastT = 0;
    this.frames = 0;
    this.fpsT = 0;
    this.hint('F fly · M map · T fast-forward time · N day/night · Tab build mode · Esc pause');
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  hint(text) {
    this.el.hint.textContent = text;
  }

  // Top-left objective panel, e.g. { label: 'Data cores', value: 3, total: 40, sub: '1:12' }
  setObjective(o) {
    const e = this.el.objective;
    if (!o) return e.classList.add('hidden');
    e.classList.remove('hidden');
    e.querySelector('.label').textContent = o.label ?? '';
    e.querySelector('.value').innerHTML = `${o.value ?? ''}${o.total != null ? `<span class="dim">/${o.total}</span>` : ''}`;
    e.querySelector('.sub').textContent = o.sub ?? '';
  }

  // Minimap + big map. image: square canvas covering [-half, half] in world x/z.
  // markers(): [{ x, z, color, size, rim }] — rim markers stick to the edge when out of range.
  setMap({ image, half, markers = () => [], range = 340 }) {
    this.map = { image, half, markers, range };
    this.mini.classList.remove('hidden');
  }

  toast(msg) {
    this.el.toast.innerHTML = msg;
    this.el.toast.classList.add('show');
    this.toastT = 2.2;
  }

  // Start / pause menu. controls: [[key, label], ...]
  menu({ kicker = 'World Studio', title = '', tag = '', button = 'Play', controls = DEFAULT_CONTROLS, disabled = false, onPlay } = {}) {
    const [first, ...rest] = String(title).split(' ');
    const p = this.menuEl.querySelector('.panel');
    p.innerHTML = `
      <div class="kicker">${kicker}</div>
      <h1>${first || ''}${rest.length ? `<span>${rest.join(' ')}</span>` : ''}</h1>
      ${tag ? `<p class="tag">${tag}</p>` : ''}
      <button id="play" ${disabled ? 'disabled' : ''}>${button}</button>
      <div class="controls">${controls.map(([k, l]) => `<div><kbd>${k}</kbd> ${l}</div>`).join('')}</div>
      ${import.meta.env.VITE_WS_GAME ? '' : '<a class="back" href="/">← All projects</a>'}`;
    if (onPlay) p.querySelector('#play').addEventListener('click', onPlay);
    this.menuEl.classList.remove('hidden');
  }

  hideMenu() {
    this.menuEl.classList.add('hidden');
  }

  setMenuButton(text, disabled = false) {
    const b = this.menuEl.querySelector('#play');
    if (b) {
      b.textContent = text;
      b.disabled = disabled;
    }
  }

  modal({ kicker = '', title = '', html = '', button = 'Continue', onClose } = {}) {
    const p = this.modalEl.querySelector('.panel');
    p.innerHTML = `<div class="kicker">${kicker}</div><h2>${title}</h2><p class="tag">${html}</p><button>${button}</button>`;
    p.querySelector('button').addEventListener('click', () => {
      this.modalEl.classList.add('hidden');
      onClose?.();
    });
    this.modalEl.classList.remove('hidden');
  }

  fatal(title, detail) {
    this.menu({ title, tag: detail, button: 'Back to projects', controls: [], onPlay: () => ((window.top || window).location.href = '/') });
  }

  update(dt, { player, env, prompt, camYaw, build }) {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      this.el.fps.textContent = `${Math.round(this.frames / this.fpsT)} FPS`;
      this.frames = 0;
      this.fpsT = 0;
    }
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) this.el.toast.classList.remove('show');
    this.el.clock.textContent = env.clock;
    this.el.prompt.innerHTML = prompt || '';
    this.el.prompt.classList.toggle('show', !!prompt);
    this.el.speedo.classList.toggle('show', !build && player.driving);
    this.el.flight.classList.toggle('show', !build && player.flying);
    this.el.cross.classList.toggle('hide', build || player.driving);
    if (player.driving) this.el.speed.textContent = Math.round(Math.abs(player.car.speed) * 3.6);
    if (player.flying) this.el.alt.textContent = Math.max(0, Math.round(player.altitude));
    if (this.map) this.drawMini(build ? build.focus : player.focus, camYaw);
  }

  drawMini(p, yaw) {
    const { image, half, markers, range } = this.map;
    const c = this.mctx, w = this.mini.width, hh = this.mini.height;
    const zoom = w / range;
    c.save();
    c.clearRect(0, 0, w, hh);
    c.beginPath();
    c.arc(w / 2, hh / 2, w / 2 - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#0d2533';
    c.fillRect(0, 0, w, hh);
    c.translate(w / 2, hh / 2);
    c.rotate(yaw);
    c.scale(zoom, zoom);
    c.translate(-p.x, -p.z);
    c.drawImage(image, -half, -half, 2 * half, 2 * half);
    c.restore();

    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const rad = w / 2 - 9;
    const dots = markers().map((m) => {
      const dx = m.x - p.x, dz = m.z - p.z;
      const sx = (dx * cos - dz * sin) * zoom, sy = (dx * sin + dz * cos) * zoom;
      return { ...m, sx, sy, d: Math.hypot(sx, sy) };
    });
    dots.sort((a, b) => a.d - b.d);
    let rim = 0;
    for (const o of dots) {
      let { sx, sy } = o;
      const edge = o.d > rad;
      if (edge) {
        if (o.rim === false || rim++ >= 5) continue;
        sx *= rad / o.d;
        sy *= rad / o.d;
      }
      c.globalAlpha = edge ? 0.7 : 1;
      c.fillStyle = o.color || '#3cf2ff';
      c.beginPath();
      c.arc(w / 2 + sx, hh / 2 + sy, edge ? 3.2 : o.size || 4.5, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
    c.save();
    c.translate(w / 2, hh / 2);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#0a0f18';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    c.fillStyle = '#ff5a5a';
    c.font = 'bold 13px "Chakra Petch", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', w / 2 + sin * rad, hh / 2 - cos * rad);
  }

  openBigMap(p, yaw) {
    if (!this.map) return false;
    const { image, half, markers } = this.map;
    const cv = this.bigCanvas;
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.86;
    cv.width = cv.height = size * devicePixelRatio;
    cv.style.width = cv.style.height = `${size}px`;
    const c = cv.getContext('2d');
    const k = cv.width / (2 * half);
    c.drawImage(image, 0, 0, cv.width, cv.height);
    const tx = (v) => (v + half) * k;
    for (const m of markers()) {
      c.fillStyle = m.color || '#3cf2ff';
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 10;
      c.beginPath();
      c.arc(tx(m.x), tx(m.z), (m.size || 5) * devicePixelRatio, 0, Math.PI * 2);
      c.fill();
    }
    c.shadowBlur = 0;
    c.save();
    c.translate(tx(p.x), tx(p.z));
    c.rotate(-yaw);
    const s = devicePixelRatio * 1.4;
    c.scale(s, s);
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(7, 8);
    c.lineTo(0, 4);
    c.lineTo(-7, 8);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    this.bigmap.classList.remove('hidden');
    return true;
  }

  closeBigMap() {
    this.bigmap.classList.add('hidden');
  }
}
