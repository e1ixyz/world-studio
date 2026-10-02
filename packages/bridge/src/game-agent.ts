// Runs inside the game page when the studio frames it (/play/<slug>?embed=1). Loaded before the
// game, so it keeps working if the game crashes. It keeps the interface the engine already uses,
// window.devchat (open, close, focusComposer, attach, reportError, isOpen), and window.__harness
// (selection, screenshot), and forwards everything to the studio over the bridge. It also owns
// what has to stay in this document: the quick prompt bar (so Enter keeps pointer lock), key
// shortcuts while the game has focus, and error capture.
import '../../../engine/ui/tokens.css';
import './game.css';
import { type GameMessageBody, listen, send, StudioMessage } from './protocol.ts';

const params = new URLSearchParams(location.search);
const embedded = window.parent !== window && params.has('embed');
const ORIGIN = location.origin; // same origin today; a sandboxed game origin would name the studio's here
const slug = location.pathname.match(/^\/play\/([\w-]+)/)?.[1] || params.get('game') || '';

type Game = {
  state?: string;
  app?: { capture(o: { width?: number; quality?: number }): Promise<string>; renderer: { info: { render: Record<string, number>; memory: Record<string, number> } } };
  game?: { snapshot?(ctx: unknown): unknown };
  ctx?: unknown;
  select?: { selected?: unknown; describe(): string; select?(e: unknown): void };
  player?: { focus: { x: number; z: number }; driving?: unknown; flying?: boolean; altitude: number };
  camera: { getWorldDirection(v: unknown): { x: number; z: number }; position: { constructor: new () => unknown } };
  build: { pos: { x: number; y: number; z: number }; pitch: number; yaw?: number } & BuildApi;
  tweaks?: TweaksApi;
  env: { clock: string };
};
type BuildApi = {
  state(): unknown;
  setTime(h: number): void;
  frameSelection(): void;
  actions: { exit(): void; playFromHere(): void; toggleFreeze(): void };
};
type TweaksApi = { set(key: string, v: unknown): void; reset(key: string): void; discard(): void; markSaved(): void };
type Harness = { getSelection?: () => string; screenshot?: () => void };
const w = window as unknown as { __game?: Game; __harness?: Harness; devchat?: unknown };

const post = (msg: GameMessageBody) => send(window.parent, msg, ORIGIN);

if (embedded) {
  let panelOpen = false;

  // Errors since this page loaded, for the agent's game_state.
  const errors: string[] = [];
  const noteError = (text: string) => {
    errors.push(text.slice(0, 2000));
    if (errors.length > 20) errors.shift();
  };
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    noteError(args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' '));
    consoleError(...args);
  };
  // Frames per second over the last second.
  let fps = 0;
  {
    let frames = 0;
    let since = performance.now();
    const count = (t: number) => {
      frames++;
      if (t - since >= 1000) {
        fps = Math.round((frames * 1000) / (t - since));
        frames = 0;
        since = t;
      }
      requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
  }

  w.devchat = {
    open: (focus = true) => post({ t: 'open', focus }),
    close: () => post({ t: 'close' }),
    focusComposer: () => post({ t: 'focusComposer' }),
    isOpen: () => panelOpen,
    attach: (a: { kind: string; path: string; thumb: string }) => a.kind === 'shot' && post({ t: 'shot', path: a.path, thumb: a.thumb }),
    reportError: (text: string) => post({ t: 'error', text }),
  };

  // ---------- messages from the studio ----------
  listen(() => window.parent, ORIGIN, StudioMessage, (m) => {
    switch (m.t) {
      case 'panel':
        panelOpen = m.open;
        document.body?.classList.toggle('devchat-open', m.open);
        break;
      case 'typing':
        window.dispatchEvent(new CustomEvent(m.on ? 'devchat:focus' : 'devchat:blur'));
        break;
      case 'requestContext':
        post({ t: 'context', id: m.id, text: gameContext() });
        break;
      case 'screenshot':
        w.__harness?.screenshot?.();
        break;
      case 'exitPointerLock':
        document.exitPointerLock?.();
        break;
      case 'buildAction': {
        const g = w.__game;
        if (!g) break;
        const b = g.build;
        if (m.a === 'play') b.actions.exit();
        else if (m.a === 'toggleFreeze') b.actions.toggleFreeze();
        else if (m.a === 'setTime') b.setTime(Number(m.value));
        else if (m.a === 'playFromHere') b.actions.playFromHere();
        else if (m.a === 'frame') b.frameSelection();
        else if (m.a === 'deselect') g.select?.select?.(null);
        else if (m.a === 'tweakSet' && m.key) g.tweaks?.set(m.key, m.value);
        else if (m.a === 'tweakReset' && m.key) g.tweaks?.reset(m.key);
        else if (m.a === 'tweakDiscard') g.tweaks?.discard();
        else if (m.a === 'tweakSaved') g.tweaks?.markSaved();
        lastBuild = ''; // answer with fresh state right away
        sendBuild();
        break;
      }
      case 'probe':
        answerProbe(m.id, m.what).then(
          (data) => post({ t: 'probeResult', id: m.id, ok: true, data }),
          (err) => post({ t: 'probeResult', id: m.id, ok: false, error: String(err?.message || err) }),
        );
        break;
    }
  });

  async function answerProbe(id: string, what: 'screenshot' | 'state') {
    const g = w.__game;
    if (what === 'screenshot') {
      if (!g?.app) throw new Error(errors.length ? `The game is not running. Last error:\n${errors.at(-1)}` : 'The game has not started yet');
      const data = await g.app.capture({ width: 1024, quality: 0.8 });
      const canvas = document.querySelector('canvas');
      const ratio = canvas ? canvas.height / canvas.width : 9 / 16;
      return { data, width: 1024, height: Math.round(1024 * ratio) };
    }
    const info = g?.app?.renderer.info;
    let snapshot: unknown;
    try {
      snapshot = g?.game?.snapshot?.(g.ctx);
    } catch (err) {
      snapshot = `snapshot() threw: ${(err as Error).message}`;
    }
    const json = JSON.stringify(snapshot ?? null);
    return {
      id,
      running: !!g?.app,
      mode: g?.state ?? null,
      context: gameContext(),
      selection: w.__harness?.getSelection?.() || null,
      fps,
      renderer: info ? { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures } : null,
      errors,
      snapshot: json.length > 4000 ? `${json.slice(0, 4000)}… (truncated)` : snapshot,
    };
  }

  // ---------- build mode state, for the studio's panels ----------
  let lastBuild = '';
  function sendBuild() {
    const g = w.__game;
    if (!g?.build?.state) return;
    const state = g.build.state() as { time: number };
    // the clock only needs minute steps to look live
    const sig = JSON.stringify({ ...state, time: Math.round(state.time * 60) });
    if (sig === lastBuild) return;
    lastBuild = sig;
    post({ t: 'build', state: state as never });
  }
  setInterval(() => w.__game?.state === 'build' && sendBuild(), 120);

  // ---------- state the studio shows (mode, selection) ----------
  let last = '';
  setInterval(() => {
    const s = { mode: w.__game?.state ?? null, selection: w.__harness?.getSelection?.() || '', canShoot: !!w.__harness?.screenshot };
    const sig = JSON.stringify(s);
    if (sig === last) return;
    last = sig;
    post({ t: 'state', ...s });
  }, 250);

  // ---------- keys while the game has focus ----------
  const isTyping = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('input, textarea, select, [contenteditable]');
  window.addEventListener(
    'keydown',
    (e) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Backquote') {
        e.preventDefault();
        e.stopImmediatePropagation();
        post({ t: 'toggle' });
      } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && ['play', 'build'].includes(w.__game?.state || '')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (panelOpen) post({ t: 'focusComposer' });
        else showQuick();
      }
    },
    true,
  );

  // ---------- quick prompt bar ----------
  const quick = document.createElement('form');
  quick.className = 'dc-quick';
  quick.autocomplete = 'off';
  quick.innerHTML = '<span class="dc-quick-label">Ask</span><input type="text" placeholder="Describe a change. Enter sends, Esc cancels." maxlength="4000" aria-label="Quick prompt">';
  const quickInput = quick.querySelector('input') as HTMLInputElement;
  const typing = (on: boolean) => window.dispatchEvent(new CustomEvent(on ? 'devchat:focus' : 'devchat:blur'));
  quickInput.addEventListener('focus', () => typing(true));
  quickInput.addEventListener('blur', () => {
    typing(false);
    hideQuick();
  });
  for (const type of ['keydown', 'keyup', 'keypress']) quick.addEventListener(type, (e) => e.stopPropagation());
  quick.addEventListener('mousedown', (e) => e.stopPropagation());
  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideQuick();
    }
  });
  quick.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = quickInput.value.trim();
    quickInput.value = '';
    hideQuick();
    if (text) post({ t: 'quickPrompt', text });
  });
  function showQuick() {
    quick.classList.add('open');
    quickInput.focus();
  }
  function hideQuick() {
    quick.classList.remove('open');
    quickInput.blur();
  }
  const mount = () => {
    // links in the game ("Projects", "All projects") navigate the studio, not the frame
    const base = document.createElement('base');
    base.target = '_top';
    document.head.prepend(base);
    document.body.appendChild(quick);
    post({ t: 'ready', slug, title: document.title });
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  // ---------- errors ----------
  window.addEventListener(
    'error',
    (e) => {
      const target = e.target as HTMLScriptElement | null;
      if (target && (target as unknown) !== window && target.tagName === 'SCRIPT') {
        const text = `Failed to load ${target.src}. A module probably has a syntax error; run npx vite build to see it.`;
        noteError(text);
        post({ t: 'error', text });
      } else if (e.error || e.message) {
        const text = `${e.error?.stack || e.message}${e.filename ? `\n  at ${e.filename}:${e.lineno}:${e.colno}` : ''}`;
        noteError(text);
        post({ t: 'error', text });
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e) => {
    const text = e.reason?.stack || String(e.reason);
    noteError(text);
    post({ t: 'error', text });
  });
  import.meta.hot?.on('vite:error', ({ err }: { err: { message: string; id?: string; frame?: string } }) => {
    const text = `${err.message}${err.id ? `\n  in ${err.id}` : ''}${err.frame ? `\n${err.frame}` : ''}`;
    noteError(text);
    post({ t: 'error', text });
  });
}

// "[Game context: …]": where the player (or the build camera) is and where it faces.
function gameContext() {
  const g = w.__game;
  if (!g?.player) return '';
  const d = g.camera.getWorldDirection(new g.camera.position.constructor());
  const heading = Math.round(((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360);
  if (g.state === 'build') {
    const p = g.build.pos;
    return `[Game context: build mode, free camera at x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, z=${p.z.toFixed(1)}, looking ${heading}° (0 = -z/north, 90 = +x/east), pitch ${Math.round((g.build.pitch * 180) / Math.PI)}°, time ${g.env.clock}]`;
  }
  const p = g.player.focus;
  const mode = g.player.driving ? 'driving a car' : g.player.flying ? `flying ${Math.round(g.player.altitude)} m up` : 'on foot';
  return `[Game context: player at x=${p.x.toFixed(1)}, z=${p.z.toFixed(1)}, ${mode}, facing ${heading}° (0 = -z/north, 90 = +x/east), time ${g.env.clock}]`;
}
