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
  player?: { focus: { x: number; z: number }; driving?: unknown; flying?: boolean; altitude: number };
  camera: { getWorldDirection(v: unknown): { x: number; z: number }; position: { constructor: new () => unknown } };
  build: { pos: { x: number; y: number; z: number }; pitch: number };
  env: { clock: string };
};
type Harness = { getSelection?: () => string; screenshot?: () => void };
const w = window as unknown as { __game?: Game; __harness?: Harness; devchat?: unknown };

const post = (msg: GameMessageBody) => send(window.parent, msg, ORIGIN);

if (embedded) {
  let panelOpen = false;

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
    }
  });

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
        post({ t: 'error', text: `Failed to load ${target.src}. A module probably has a syntax error; run npx vite build to see it.` });
      } else if (e.error || e.message) {
        post({ t: 'error', text: `${e.error?.stack || e.message}${e.filename ? `\n  at ${e.filename}:${e.lineno}:${e.colno}` : ''}` });
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e) => post({ t: 'error', text: e.reason?.stack || String(e.reason) }));
  import.meta.hot?.on('vite:error', ({ err }: { err: { message: string; id?: string; frame?: string } }) =>
    post({ t: 'error', text: `${err.message}${err.id ? `\n  in ${err.id}` : ''}${err.frame ? `\n${err.frame}` : ''}` }),
  );
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
