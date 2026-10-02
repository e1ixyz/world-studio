// Game runtime (play.html): loads games/<slug>/game.js, runs Play and Build modes, and keeps the
// session across hot reloads.
import * as THREE from 'three';
import { createApp } from './core/app.js';
import { Input } from './core/input.js';
import { createRng } from './core/rng.js';
import { saveSnapshot, takeSnapshot } from './core/hotstate.js';
import { Environment } from './world/environment.js';
import { makeBaseTextures } from './world/textures.js';
import { GameAudio } from './audio/audio.js';
import { Player } from './player/controller.js';
import { HUD, DEFAULT_CONTROLS } from './ui/hud.js';
import { Selection } from './build/selection.js';
import { Tweaks } from './build/tweaks.js';
import { BuildMode } from './build/buildmode.js';
import './ui/tokens.css';
import './ui/style.css';
import './build/build.css';

const DEV = import.meta.env.DEV;
// Build mode needs the studio around the game (its panels are studio UI); a production build or an
// exported game is play-only.
const BUILD = DEV;
const params = new URLSearchParams(location.search);
// an exported single game (bun run export <slug>) plays its own game when the URL names none
const slug = location.pathname.match(/^\/play\/([\w-]+)/)?.[1] || params.get('game') || import.meta.env.VITE_WS_GAME;
const NO_INPUT = { fwd: false, back: false, left: false, right: false, sprint: false, jump: false, down: false };

async function loadModule(s) {
  if (DEV) return import(/* @vite-ignore */ `/games/${s}/game.js`);
  const { games } = await import('./registry.prod.js');
  const load = games[`/games/${s}/game.js`];
  if (!load) throw new Error(`No game called "${s}"`);
  return load();
}
async function loadJSON(file, fallback) {
  if (!DEV) {
    const reg = await import('./registry.prod.js');
    return reg.json[`/games/${slug}/${file}`] ?? fallback;
  }
  try {
    const r = await fetch(`/games/${slug}/${file}`, { cache: 'no-store' });
    return r.ok ? await r.json() : fallback;
  } catch {
    return fallback;
  }
}
const post = (path, body) => fetch(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Devchat': '1' },
  body: JSON.stringify(body),
}).then((r) => r.json().catch(() => ({})));

async function main() {
  const hud = new HUD();
  if (!slug) return hud.fatal('No game selected', 'Open a project from the landing page.');
  hud.menu({ title: 'Loading', button: 'Loading…', disabled: true, controls: [] });

  let mod, meta, saved;
  try {
    [mod, meta, saved] = await Promise.all([loadModule(slug), loadJSON('game.json', { name: slug }), loadJSON('tweaks.json', {})]);
  } catch (err) {
    fail(hud, err, 'The game code failed to load');
    return;
  }
  const def = mod.default;
  document.title = `${meta.name || def.title} · World Studio`;
  hud.menu({ title: meta.name || def.title, tag: meta.description || '', button: 'Building world…', disabled: true, controls: [] });
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));

  const app = createApp(document.getElementById('app'));
  const { scene, camera, renderer } = app;
  const input = new Input();
  const audio = new GameAudio();
  const env = new Environment(scene, renderer);
  app.shadowLight = env.light;
  const tweaks = new Tweaks(saved);
  const select = new Selection(scene);
  const textures = makeBaseTextures(renderer.capabilities.getMaxAnisotropy());
  // Physics loads on demand: one Rapier world per game, created the first time setup asks.
  let physics = null;
  let physicsReady = null;
  const ctx = {
    THREE, scene, camera, renderer, app, env, audio, hud, tweaks, select, textures, input,
    rng: createRng(slug), slug, meta, player: null, mode: 'menu', started: false,
    physics: (opts = {}) =>
      (physicsReady ??= import('./physics/physics.js').then(async (m) => {
        physics = await m.createPhysics({ ...opts, scene, select, tweaks });
        return physics;
      })),
  };

  let game;
  try {
    game = (await def.setup(ctx)) || {};
    if (!game.world) throw new Error('setup(ctx) must return { world: { grid, groundY, spawn } }');
  } catch (err) {
    fail(hud, err, 'The game failed to start');
    return;
  }
  const player = new Player(camera, game.world, game.vehicles || null, audio);
  ctx.player = player;
  const sp = game.world.spawn || {};
  camera.position.set(sp.x || 0, 30, (sp.z || 0) + 60);
  camera.lookAt(sp.x || 0, 0, sp.z || 0);

  // engine tweaks come after the game's so the game's own show first in the panel
  // (time of day lives in the build-mode top bar, not the tweak list)
  const T = (k, d) => tweaks.add(k, { ...d, engine: true });
  T('World / Day length (min)', { value: env.dayLength / 60, min: 1, max: 60, step: 1, onChange: (v) => (env.dayLength = v * 60) });
  T('World / Fog density', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (env.fogScale = v) });
  T('World / Exposure', { value: 1, min: 0.4, max: 2, step: 0.05, onChange: (v) => (env.exposureScale = v) });
  let bloomScale = 1;
  T('World / Bloom', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (bloomScale = v) });
  T('Player / Walk speed', { value: player.walkSpeed, min: 1, max: 20, step: 0.1, onChange: (v) => (player.walkSpeed = v) });
  T('Player / Sprint speed', { value: player.sprintSpeed, min: 2, max: 40, step: 0.5, onChange: (v) => (player.sprintSpeed = v) });
  T('Player / Fly speed', { value: player.flySpeed, min: 5, max: 150, step: 1, onChange: (v) => (player.flySpeed = v) });
  T('Player / Fast fly speed', { value: player.flyFastSpeed, min: 20, max: 400, step: 5, onChange: (v) => (player.flyFastSpeed = v) });
  tweaks.dirty = false;

  // ---------- modes ----------
  let mode = 'menu'; // menu | play | build | paused | map
  let started = false;
  let freeze = true;
  let typing = false;
  let hadLock = false;
  const canvas = app.canvas;
  const lock = () => {
    try {
      canvas.requestPointerLock()?.catch?.(() => {});
    } catch { /* drag to look instead */ }
  };

  const build = new BuildMode({
    app, input, select, tweaks, env, meta, slug, dev: DEV,
    actions: {
      exit: () => setMode('play'),
      playFromHere: () => {
        const p = build.pos;
        player.teleport(p.x, Math.max(p.y - 1.7, game.world.groundY(p.x, p.z)), p.z, build.yaw, 0);
        player.flying = p.y - game.world.groundY(p.x, p.z) > 4;
        setMode('play');
      },
      screenshot: () => screenshot(),
      toggleFreeze: () => (freeze = !freeze),
      isFrozen: () => freeze,
    },
  });

  function start(m) {
    audio.init();
    started = true;
    hud.hideMenu();
    hud.show(true);
    setMode(m);
    setTimeout(sendThumb, 4000);
  }

  function setMode(m) {
    if (m === mode) return;
    const prev = mode;
    if (prev === 'build') {
      build.exit();
      window.devchat?.close();
      sendThumb();
    }
    if (prev === 'map') hud.closeBigMap();
    mode = m;
    if (m === 'build') {
      input.clear();
      audio.engine(false, 0, 0);
      document.exitPointerLock?.();
      build.enter();
      window.devchat?.open(false);
    }
    if (m === 'play' && prev !== 'map') lock();
  }

  function pause() {
    mode = 'paused';
    input.clear();
    audio.engine(false, 0, 0);
    showMenu('Resume');
  }

  function showMenu(label) {
    hud.menu({
      title: meta.name || def.title,
      tag: meta.description || '',
      button: label,
      controls: [...DEFAULT_CONTROLS, ...(def.controls || []), ...(BUILD ? [['Tab', 'build mode']] : [])],
      onPlay: () => {
        if (!started) return start('play');
        hud.hideMenu();
        setMode('play');
      },
    });
    if (BUILD) addBuildButton();
  }
  function addBuildButton() {
    const panel = hud.menuEl.querySelector('.panel');
    const b = document.createElement('button');
    b.className = 'secondary';
    b.textContent = 'Build mode';
    b.addEventListener('click', () => {
      if (!started) start('build');
      else {
        hud.hideMenu();
        setMode('build');
      }
    });
    panel.querySelector('#play').after(b);
  }

  canvas.addEventListener('click', () => {
    audio.init();
    if (mode === 'play' && !document.pointerLockElement) lock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) hadLock = true;
    else if (hadLock && mode === 'play' && !typing) pause();
  });
  window.addEventListener('devchat:focus', () => {
    typing = true;
    audio.engine(false, 0, 0);
  });
  window.addEventListener('devchat:blur', () => (typing = false));
  let dragging = false;
  canvas.addEventListener('mousedown', (e) => e.button === 0 && (dragging = true));
  window.addEventListener('mouseup', () => (dragging = false));
  document.addEventListener('mousemove', (e) => {
    if (mode !== 'play' || typing) return;
    if (document.pointerLockElement || dragging) player.look(e.movementX, e.movementY);
  });

  const dirV = new THREE.Vector3();
  const camYaw = () => {
    camera.getWorldDirection(dirV);
    return Math.atan2(-dirV.x, -dirV.z);
  };

  input.onPress((code) => {
    if (code === 'KeyG') {
      app.high = !app.high;
      app.applyQuality();
      hud.toast(`Graphics: ${app.high ? 'High' : 'Low'}`);
    }
    if (code === 'Tab' && BUILD && started && (mode === 'play' || mode === 'build')) return setMode(mode === 'build' ? 'play' : 'build');
    if (mode === 'map' && (code === 'KeyM' || code === 'Escape')) return setMode('play');
    if (code === 'KeyN' && (mode === 'play' || mode === 'build')) env.skip(((env.night > 0.5 ? 10 : 20.5) - env.time + 24) % 24);
    if (mode === 'build') {
      if (code === 'KeyK') screenshot();
      if (code === 'KeyP') build.actions.playFromHere();
      if (code === 'KeyF') build.frameSelection();
      if (code === 'Escape') select.select(null);
      return;
    }
    if (mode !== 'play') return;
    if (code === 'KeyE' && game.vehicles) {
      if (player.driving) {
        if (!player.exit()) hud.toast('Slow down to exit');
      } else {
        const v = player.altitude < 2 ? game.vehicles.nearest(player.pos.x, player.pos.z, 3.2) : null;
        if (v) player.enter(v);
      }
    }
    if (code === 'KeyH' && player.driving) audio.horn(1);
    if (code === 'KeyF') {
      if (player.driving) hud.toast('Exit the car to fly');
      else hud.toast(player.toggleFlight() ? 'Flight on' : 'Flight off');
    }
    if (code === 'KeyM' && hud.openBigMap(player.focus, camYaw())) {
      mode = 'map';
      input.clear();
    }
    game.onKey?.(code, ctx);
  });

  // ---------- screenshots and thumbnails ----------
  async function screenshot() {
    const data = await app.capture({ width: 1280, quality: 0.85 });
    if (!DEV) {
      const a = document.createElement('a');
      a.href = data;
      a.download = `${slug}.jpg`;
      a.click();
      return;
    }
    const r = await post('/__harness/shot', { slug, data });
    if (r.path) {
      window.devchat?.attach({ kind: 'shot', path: r.path, thumb: data });
      hud.toast('Screenshot attached to your next prompt');
    }
  }
  async function sendThumb() {
    if (!DEV || !started) return;
    const data = await app.capture({ width: 480, quality: 0.72 });
    post('/__harness/thumb', { slug, data }).catch(() => {});
  }
  setInterval(() => mode === 'play' && sendThumb(), 180000);

  // ---------- loop ----------
  let last = performance.now();
  let t = 0;
  let wall = 0;
  function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    wall += dt;
    const simulate = !started || mode === 'play' || (mode === 'build' && !freeze);
    if (mode === 'play') player.update(dt, typing ? NO_INPUT : input.movement());
    else if (mode === 'build') build.update(dt);
    else if (!started) {
      if (game.attract) game.attract(camera, wall);
      else {
        const a = wall * 0.05;
        camera.position.set((sp.x || 0) + Math.cos(a) * 160, 70, (sp.z || 0) + Math.sin(a) * 160);
        camera.lookAt(sp.x || 0, 5, sp.z || 0);
      }
    }
    ctx.mode = mode;
    ctx.started = started;
    if (physics) {
      // the player (or the car) shoves bodies; the world only advances while the game does
      if (started && mode === 'play') physics.movePlayer(player.pos, player.car);
      if (simulate) physics.step(dt);
    }
    if (simulate) {
      t += dt;
      try {
        game.update?.(dt, t, ctx);
      } catch (err) {
        reportOnce(err);
      }
    }
    const focus = mode === 'build' ? build.focus : started ? player.focus : { x: camera.position.x * 0.3, z: camera.position.z * 0.3 };
    const fast = mode === 'play' && !typing && input.has('KeyT') ? 40 : 1;
    const n = env.update(simulate ? dt : 0, focus, camera, fast);
    game.onNight?.(n, wall, ctx);
    app.bloom.strength = (0.12 + n * 0.6) * bloomScale;
    app.bloom.threshold = 1.0 - n * 0.18;
    audio.setAmbient(n);

    let prompt = '';
    if (mode === 'play' && game.vehicles) {
      if (player.driving) {
        if (Math.hypot(player.car.vx, player.car.vz) < 7) prompt = '<kbd>E</kbd> exit car';
      } else if (player.altitude < 2 && game.vehicles.nearest(player.pos.x, player.pos.z, 3.2)) prompt = '<kbd>E</kbd> drive';
    }
    if (game.prompt) prompt = game.prompt(ctx) ?? prompt;
    if (started) hud.update(dt, { player, env, prompt, camYaw: camYaw(), build: mode === 'build' ? build : null });
    if (mode === 'play' && camera.fov !== player.fov) {
      camera.fov = player.fov;
      camera.updateProjectionMatrix();
    }
    app.render();
    requestAnimationFrame(frame);
  }
  let reported = false;
  function reportOnce(err) {
    if (reported) return;
    reported = true;
    console.error(err);
    window.devchat?.reportError?.(err.stack || String(err));
  }

  // ---------- hot reload: keep the session across code changes ----------
  function snapshot() {
    const car = player.car;
    return {
      mode: mode === 'build' ? 'build' : 'play',
      freeze,
      time: env.time,
      high: app.high,
      player: { pos: player.pos.toArray(), yaw: player.yaw, pitch: player.pitch, flying: player.flying },
      car: car ? { x: car.x, z: car.z, heading: car.heading } : null,
      build: build.pose(),
      game: game.snapshot?.(ctx),
    };
  }
  function restore(s) {
    env.time = s.time;
    env.envTimer = 1e9;
    freeze = s.freeze ?? true;
    if (s.high === false) {
      app.high = false;
      app.applyQuality();
    }
    const p = s.player;
    player.teleport(p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch);
    player.flying = !!p.flying;
    if (s.car && game.vehicles) {
      const v = game.vehicles.nearest(s.car.x, s.car.z, 1e9);
      if (v) {
        Object.assign(v, { x: s.car.x, z: s.car.z, heading: s.car.heading, speed: 0 });
        player.enter(v);
        player.camPos.set(v.x - Math.cos(v.heading) * 7, 3, v.z + Math.sin(v.heading) * 7);
      }
    }
    if (s.game) game.restore?.(s.game, ctx);
    start(s.mode === 'build' ? 'build' : 'play');
    // after start: build.enter() re-seeds the free camera from the player camera
    build.setPose(s.build);
    hud.toast('Changes applied');
    const wake = () => audio.init();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
  }
  if (import.meta.hot) {
    import.meta.hot.on('harness:reload', (d) => {
      if (!d.all && !(d.slugs || []).includes(slug)) return;
      if (started) saveSnapshot(slug, snapshot());
      location.reload();
    });
    import.meta.hot.on('vite:beforeFullReload', () => started && saveSnapshot(slug, snapshot()));
  }

  window.__game = { app, ctx, game, player, env, camera, select, tweaks, build, input, start, setMode, get state() { return mode; }, get physics() { return physics; } };
  window.__harness = { slug, meta, getSelection: () => select.describe(), mode: () => mode, screenshot: () => screenshot() };

  showMenu('Play');
  const snap = takeSnapshot(slug);
  if (snap) {
    try {
      restore(snap);
    } catch (err) {
      console.warn('Could not restore the previous session', err);
    }
  } else if (BUILD && params.get('build') === '1') start('build');
  frame();
}

function fail(hud, err, title) {
  console.error(err);
  hud.fatal(title, `<code>${String(err.message || err).replace(/</g, '&lt;')}</code><br>Open the Ask panel with <kbd>\`</kbd> and ask for a fix.`);
  window.devchat?.reportError?.(err.stack || String(err));
}

main();
