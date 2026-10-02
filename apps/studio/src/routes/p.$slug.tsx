// A project: the game in a frame, with the Ask panel beside it. The frame loads the game runtime
// (/play/<slug>?embed=1); the two sides talk over the bridge (packages/bridge).
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import '../../../../engine/ui/tokens.css';
import type { BuildState } from '@ws/bridge';
import { BuildPanels } from '../build/build-panels.tsx';
import { AskPanel, type AskPanelHandle, type GameView } from '../chat/ask-panel.tsx';
import '../chat/chat.css';
import { feedFor, type LogItem } from '../chat/timeline.ts';
import { useChat } from '../chat/use-chat.ts';
import { useGameBridge } from '../chat/use-game-bridge.ts';
import { api, projectsQuery } from '../lib/api.ts';

export const Route = createFileRoute('/p/$slug')({
  component: ProjectShell,
});

const openKey = (slug: string) => `devchat:open:${slug}`;
const isTyping = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('input, textarea, select, [contenteditable]');

function ProjectShell() {
  const { slug } = Route.useParams();
  const frame = useRef<HTMLIFrameElement>(null);
  const panel = useRef<AskPanelHandle>(null);
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(openKey(slug)) === '1';
    } catch {
      return false;
    }
  });
  const [game, setGame] = useState<GameView>({ mode: null, selection: '', canShoot: false });
  const [shot, setShot] = useState<{ path: string; thumb: string } | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [feed, setFeed] = useState<{ text: string; error?: boolean; until: number } | null>(null);
  const seenErrors = useRef(new Set<string>());

  const project = useQuery(projectsQuery).data?.find((p) => p.slug === slug);
  useEffect(() => {
    document.title = `${project?.name || slug} · World Studio`;
  }, [project?.name, slug]);

  const flash = useCallback((f: { text: string; error?: boolean } | null) => {
    if (f) setFeed({ ...f, text: f.text.length > 90 ? `${f.text.slice(0, 88)}…` : f.text, until: Date.now() + (f.error ? 8000 : 5000) });
  }, []);
  const chat = useChat(
    slug,
    (item: LogItem) => {
      flash(feedFor(item));
      // the agent is waiting on the user: show the question
      if (item.kind === 'permission' && item.meta.state === 'pending') show(false);
    },
    async ({ id, what }) => {
      const r = await probe(id, what);
      api.chat[':slug'].probe[':id'].$post({ param: { slug, id }, json: r });
    },
  );

  const { post, requestContext, probe } = useGameBridge(frame, (m) => {
    switch (m.t) {
      case 'state':
        setGame({ mode: m.mode, selection: m.selection, canShoot: m.canShoot });
        break;
      case 'build':
        setBuild(m.state);
        break;
      case 'open':
        show(m.focus);
        break;
      case 'close':
        hide();
        break;
      case 'toggle':
        open ? hide() : show(true);
        break;
      case 'focusComposer':
        show(false);
        panel.current?.focusComposer();
        break;
      case 'shot':
        setShot({ path: m.path, thumb: m.thumb });
        break;
      case 'error': {
        const key = m.text.slice(0, 300);
        if (seenErrors.current.has(key)) break;
        seenErrors.current.add(key);
        chat.addError(m.text);
        if (!open) show(false);
        break;
      }
      case 'quickPrompt':
        sendPrompt(m.text, { cameraContext: readCameraContext(), selection: game.selection, engine: false });
        break;
      case 'ready':
        post({ t: 'panel', open });
        break;
    }
  });

  const show = useCallback(
    (focus = true) => {
      setOpen(true);
      if (focus) {
        panel.current?.focusComposer();
        post({ t: 'exitPointerLock' });
      }
    },
    [post],
  );
  const hide = useCallback(() => {
    setOpen(false);
    frame.current?.focus(); // hand the keyboard back to the game
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(openKey(slug), open ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    post({ t: 'panel', open });
    // build mode's panels make room for the Ask panel the same way they always have
    document.body.classList.toggle('devchat-open', open);
  }, [open, slug, post]);

  // keys while the studio page (not the game) has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Backquote') {
        e.preventDefault();
        open ? hide() : show(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, show, hide]);

  // the status pill fades on its own
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const onTyping = useCallback((on: boolean) => post({ t: 'typing', on }), [post]);

  async function sendPrompt(text: string, o: { cameraContext: boolean; selection: string; engine: boolean }): Promise<string | null> {
    const blocks: string[] = [];
    if (o.cameraContext) blocks.push(await requestContext());
    if (o.selection) blocks.push(o.selection);
    if (shot) blocks.push(`[Screenshot: ${shot.path} (the user's current view; read it with the Read tool)]`);
    const extras = [o.selection && 'selection', shot && 'screenshot', o.engine && 'engine edits'].filter(Boolean);
    const prefix = blocks.filter(Boolean).join('\n');
    try {
      const res = await api.chat[':slug'].prompt.$post({
        param: { slug },
        json: { text: prefix ? `${prefix}\n\n${text}` : text, display: extras.length ? `${text}\n[with ${extras.join(', ')}]` : text, engine: o.engine },
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || res.statusText);
      setShot(null);
      return null;
    } catch (err) {
      const msg = (err as Error).message || 'Request failed';
      flash({ text: msg, error: true });
      return msg;
    }
  }

  const running = chat.running;
  const showFeed = !open && feed && (running || Date.now() < feed.until);
  const query = typeof location !== 'undefined' ? location.search.replace(/^\?/, '&') : '';

  return (
    <>
      <iframe ref={frame} className="dc-frame" title={project?.name || slug} src={`/play/${slug}?embed=1${query}`} allow="autoplay; fullscreen" data-testid="game-frame" />
      {game.mode === 'build' && build && (
        <BuildPanels
          slug={slug}
          name={project?.name || slug}
          state={build}
          send={post}
          onAsk={() => {
            show(false);
            panel.current?.focusComposer();
          }}
          onAttachView={() => post({ t: 'screenshot' })}
          refocusGame={() => frame.current?.focus()}
        />
      )}
      <div className={`dc-root${open ? ' open' : ''}${running ? ' running' : ''}${chat.offline ? ' offline' : ''}`}>
        <button type="button" className="dc-tab" title="Show Ask (`)" onClick={() => (open ? hide() : show(true))}>
          <span className="dc-tab-dot" />
          Ask <span className="ws-kbd">`</span>
        </button>
        <button type="button" className={`dc-feed${showFeed ? ' show' : ''}${feed?.error ? ' err' : ''}`} title="Show Ask" onClick={() => show(true)}>
          <span className="dc-spin" />
          <span className="dc-feed-text">{feed?.text}</span>
        </button>
        <AskPanel
          ref={panel}
          slug={slug}
          open={open}
          onOpen={show}
          onClose={hide}
          items={chat.items}
          running={running}
          startedAt={chat.state?.startedAt}
          offline={chat.offline}
          game={game}
          shot={shot}
          onClearShot={() => setShot(null)}
          onAttachView={() => post({ t: 'screenshot' })}
          onTyping={onTyping}
          send={sendPrompt}
          onReset={chat.clear}
          onAfterSend={() => {
            // came here with Enter while playing: hand control straight back to the game
            if (game.mode === 'play') frame.current?.focus();
          }}
        />
      </div>
    </>
  );
}

function readCameraContext() {
  try {
    return localStorage.getItem('devchat:camera-context') !== '0';
  } catch {
    return true;
  }
}
