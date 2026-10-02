// The Ask panel: the project's chat with Claude, its checkpoints and the composer. It lives in the
// studio page, outside the game frame, so it keeps working when the game reloads or crashes.
import type { CheckpointMeta } from '@ws/shared';
import { useQuery } from '@tanstack/react-query';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SettingsDialog } from '../components/settings-dialog.tsx';
import { api, settingsQuery, useSaveSettings } from '../lib/api.ts';
import { Icon } from './icon.tsx';
import { md } from './markdown.tsx';
import { type Block, buildTimeline, type LogItem, secs, selectionKind, selectionName } from './timeline.ts';

const CAM_KEY = 'devchat:camera-context';

export interface GameView {
  mode: string | null;
  selection: string;
  canShoot: boolean;
}

export interface AskPanelHandle {
  focusComposer(): void;
  setDraft(text: string): void;
}

interface Props {
  slug: string;
  open: boolean;
  onOpen(focus?: boolean): void;
  onClose(): void;
  items: LogItem[];
  running: boolean;
  startedAt?: number;
  offline: boolean;
  game: GameView;
  shot: { path: string; thumb: string } | null;
  onClearShot(): void;
  onAttachView(): void;
  onTyping(on: boolean): void;
  // send a prompt with the current context blocks; resolves to an error message or null
  send(text: string, opts: { cameraContext: boolean; selection: string; engine: boolean }): Promise<string | null>;
  onReset(): void;
  onAfterSend(): void;
}

async function postJSON(res: Promise<Response>) {
  const r = await res;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || r.statusText);
  return data;
}

export const AskPanel = forwardRef<AskPanelHandle, Props>(function AskPanel(p, ref) {
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [engineArmed, setEngineArmed] = useState(false);
  const [dismissedSel, setDismissedSel] = useState('');
  const [cameraContext, setCameraContext] = useState(() => {
    try {
      return localStorage.getItem(CAM_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  const settings = useQuery(settingsQuery);
  const saveSettings = useSaveSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const alwaysEngine = !!settings.data?.alwaysEngine;
  const engineOn = engineArmed || alwaysEngine;
  const selection = p.game.selection && p.game.selection !== dismissedSel ? p.game.selection : '';

  useImperativeHandle(ref, () => ({
    focusComposer() {
      setTab('chat');
      setDismissedSel('');
      focusText();
    },
    setDraft,
  }));

  // Focus once the panel is rendered open (a hidden textarea can't take focus). "Typing" goes to
  // the game first, so losing pointer lock reads as typing, not as a pause.
  const [focusWanted, setFocusWanted] = useState(0);
  const focusText = () => setFocusWanted((n) => n + 1);
  useEffect(() => {
    if (!focusWanted || !p.open) return;
    p.onTyping(true);
    textarea.current?.focus();
  }, [focusWanted, p.open, p.onTyping]);
  useEffect(() => {
    if (p.open) requestAnimationFrame(() => log.current && (log.current.scrollTop = log.current.scrollHeight));
  }, [p.open]);

  // ---------- log ----------
  const blocks = useMemo(() => buildTimeline(p.items), [p.items]);
  const lastStep = useMemo(() => [...blocks].reverse().find((b): b is Extract<Block, { k: 'steps' }> => b.k === 'steps')?.steps.at(-1), [blocks]);
  const nearBottom = useRef(true);
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const last = p.items.at(-1);
    if (nearBottom.current || last?.kind === 'user') el.scrollTop = el.scrollHeight;
  }, [p.items]);

  // ---------- working timer ----------
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!p.running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [p.running]);

  // ---------- settings menu ----------
  useEffect(() => {
    if (!menuOpen) return;
    settings.refetch(); // another window may have changed it
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen, settings.refetch]);
  useEffect(() => {
    if (alwaysEngine) setEngineArmed(false);
  }, [alwaysEngine]);
  const [menuError, setMenuError] = useState('');
  function toggleAlways() {
    setMenuOpen(false);
    saveSettings.mutate({ alwaysEngine: !alwaysEngine }, { onError: (err) => setMenuError(err.message || 'Could not save the setting') });
  }
  async function newConversation() {
    setMenuOpen(false);
    if (p.running) return;
    try {
      await postJSON(api.chat[':slug'].reset.$post({ param: { slug: p.slug }, json: {} }));
      p.onReset();
    } catch {
      /* the stream shows the state */
    }
  }

  // ---------- sending ----------
  const [sendError, setSendError] = useState('');
  async function submit() {
    const text = draft.trim();
    if (!text || p.running) return;
    setDraft('');
    setTab('chat');
    const sel = selection;
    const err = await p.send(text, { cameraContext, selection: sel, engine: engineArmed });
    if (err) setSendError(err);
    else {
      setSendError('');
      setEngineArmed(false);
      if (sel) setDismissedSel(sel); // don't re-send the same selection by accident
      p.onAfterSend();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      if (p.game.mode === 'build' || p.game.mode === 'play') textarea.current?.blur();
      else p.onClose();
    }
    if (e.code === 'Backquote' && !draft) {
      e.preventDefault();
      p.onClose();
    }
  }

  const empty = !blocks.some((b) => b.k === 'user' || b.k === 'steps' || b.k === 'text' || b.k === 'error');
  const kind = selectionKind(selection);
  const ideas = [
    kind ? `Make this ${kind} twice as tall and give it a glowing roof` : 'Add a small park with trees and benches where I’m looking',
    'Make it night and add more neon signs',
    'Add a collectible and a counter for how many I’ve found',
  ];

  return (
    <aside className="dc-panel" aria-label="Ask" aria-hidden={!p.open}>
      <header className="dc-head">
        <div className="dc-head-top">
          <h2>Ask</h2>
          <span className="dc-offline">Dev server offline</span>
          <button
            type="button"
            className="ws-icon dc-menu-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            <Icon name="more" />
          </button>
          <button type="button" className="ws-icon dc-close" aria-label="Hide Ask" title="Hide (`)" onClick={p.onClose}>
            <Icon name="close" />
          </button>
          {menuOpen && (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keeps clicks inside the menu from closing it
            <div className="dc-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              {!alwaysEngine && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={engineArmed}
                  className="dc-menu-engine"
                  onClick={() => {
                    setEngineArmed((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  <Icon name="warn" />
                  <span>
                    <b>Allow engine edits</b>
                    <small>For the next prompt only. Engine changes affect every game.</small>
                  </span>
                </button>
              )}
              <button type="button" role="menuitemcheckbox" aria-checked={alwaysEngine} className="dc-menu-always" onClick={toggleAlways}>
                <Icon name="warn" />
                <span>
                  <b>Always allow engine edits</b>
                  <small>Every prompt, in every project, can change the game and the shared engine.</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dc-menu-theme"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Icon name="sliders" />
                <span>
                  <b>Theme and settings…</b>
                  <small>Six looks for the whole studio, shared with the desktop app.</small>
                </span>
              </button>
              <button type="button" role="menuitem" className="dc-menu-new" onClick={newConversation}>
                <Icon name="plus" />
                <span>
                  <b>New conversation</b>
                  <small>Starts fresh without this chat’s history. Checkpoints stay.</small>
                </span>
              </button>
            </div>
          )}
        </div>
        <div className="dc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
            Checkpoints
          </button>
        </div>
      </header>

      {tab === 'chat' ? (
        <div
          className="dc-log ws-scroll"
          role="log"
          ref={log}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {empty && (
            <div className="dc-intro">
              <p>Describe a change and this game’s code is edited for you. The game reloads where you are.</p>
              <p className="dc-intro-tip">Tip: in build mode, click something in the world first. The prompt then includes that object and where its code lives.</p>
              <div className="dc-ideas">
                {ideas.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="dc-idea"
                    onClick={() => {
                      setDraft(t);
                      focusText();
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {blocks.map((b) => (
            <BlockView key={b.key} block={b} slug={p.slug} />
          ))}
          {menuError && <ErrorCard text={menuError} />}
          {sendError && <ErrorCard text={sendError} />}
        </div>
      ) : (
        <Checkpoints slug={p.slug} running={p.running} />
      )}

      <div className="dc-working">
        <span className="dc-spin" />
        <div className="dc-working-text">
          <b>Working on your change</b>
          <span className="dc-working-step">{lastStep || 'Reading the game…'}</span>
        </div>
        <span className="dc-elapsed">{p.running && p.startedAt ? secs(now - p.startedAt) : ''}</span>
        <button type="button" className="ws-btn sm dc-stop" onClick={() => api.chat[':slug'].stop.$post({ param: { slug: p.slug }, json: {} })}>
          <Icon name="stop" />
          <span>Stop</span>
        </button>
      </div>

      <form
        className="dc-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="dc-chips">
          <button
            type="button"
            className={`dc-chip dc-chip-toggle${cameraContext ? ' on' : ''}`}
            aria-pressed={cameraContext}
            title={cameraContext ? 'Includes where you are and which way you face. Click to leave it out.' : 'Click to include where you are and which way you face'}
            onClick={() => {
              setCameraContext((v) => {
                try {
                  localStorage.setItem(CAM_KEY, v ? '0' : '1');
                } catch {
                  /* ignore */
                }
                return !v;
              });
            }}
          >
            <Icon name="pin" />
            <span>{p.game.mode === 'build' ? 'Camera view' : 'My position'}</span>
          </button>
          {selection && (
            <span className="dc-chip dc-chip-sel" title="Includes this object, its properties and where its code lives">
              <Icon name="target" />
              <span>
                <b>Selected</b> {selectionName(selection)}
              </span>
              <button type="button" aria-label="Leave out the selection" onClick={() => setDismissedSel(selection)}>
                <Icon name="close" />
              </button>
            </span>
          )}
          {p.shot && (
            <span className="dc-chip dc-chip-shot">
              <img src={p.shot.thumb} alt="" />
              <span>Screenshot</span>
              <button type="button" aria-label="Remove screenshot" onClick={p.onClearShot}>
                <Icon name="close" />
              </button>
            </span>
          )}
          {alwaysEngine ? (
            <span className="dc-chip dc-chip-engine" title="Every prompt may change the shared engine. Turn this off in the ⋯ menu.">
              <Icon name="warn" />
              <span>Engine edits: always on</span>
            </span>
          ) : (
            engineOn && (
              <span className="dc-chip dc-chip-engine" title="This prompt may change the shared engine">
                <Icon name="warn" />
                <span>Engine edits: all games</span>
                <button type="button" aria-label="Turn off engine edits" onClick={() => setEngineArmed(false)}>
                  <Icon name="close" />
                </button>
              </span>
            )
          )}
          {!p.shot && p.game.canShoot && (
            <button type="button" className="dc-chip dc-chip-add" title="Attach a screenshot of what you see (K in build mode)" onClick={p.onAttachView}>
              <Icon name="camera" />
              <span>Attach view</span>
            </button>
          )}
        </div>
        <textarea
          ref={textarea}
          rows={3}
          placeholder="Describe a change…"
          aria-label="Prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => p.onTyping(true)}
          onBlur={() => p.onTyping(false)}
        />
        <div className="dc-row">
          <span className="dc-keys">Enter to send · Shift+Enter for a new line</span>
          <button type="submit" className="ws-btn primary dc-send" disabled={p.running} title={p.running ? 'Wait for the current change to finish, or press Stop' : ''}>
            <Icon name="send" />
            <span>Send</span>
          </button>
        </div>
      </form>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </aside>
  );
});

function BlockView({ block: b, slug }: { block: Block; slug: string }) {
  switch (b.k) {
    case 'user':
      return (
        <div className="dc-msg dc-user">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: md() escapes the text before adding its few tags */}
          <span dangerouslySetInnerHTML={{ __html: md(b.text) }} />
          {b.extra && <span className="dc-with">{b.extra}</span>}
        </div>
      );
    case 'steps':
      return (
        <details className="dc-steps">
          <summary>
            <Icon name="chevron" />
            <span className="dc-steps-count">
              {b.steps.length} step{b.steps.length === 1 ? '' : 's'}
            </span>
            <span className="dc-steps-last">{b.steps.at(-1)}</span>
          </summary>
          <ol>
            {b.steps.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps only ever append
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      );
    case 'text':
      // biome-ignore lint/security/noDangerouslySetInnerHtml: md() escapes the text before adding its few tags
      return <div className={`dc-msg dc-bot${b.progress ? ' dc-progress' : ''}`} dangerouslySetInnerHTML={{ __html: md(b.text) }} />;
    case 'note':
      return <div className="dc-note">{b.text}</div>;
    case 'reload':
      return (
        <div className="dc-note dc-reload">
          <Icon name="reset" />
          <span>{b.text}</span>
        </div>
      );
    case 'error':
      return <ErrorCard text={b.text} slug={b.fixable ? slug : undefined} />;
    case 'permission':
      return <PermissionCard block={b} slug={slug} />;
  }
}

// The agent asked for something the harness doesn't allow on its own (an edit outside the game,
// a shell command). Deny is the default: nothing happens unless the user allows it.
function PermissionCard({ block: b, slug }: { block: Extract<Block, { k: 'permission' }>; slug: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const answer = async (allow: boolean) => {
    setBusy(true);
    try {
      await postJSON(api.chat[':slug'].permission[':id'].$post({ param: { slug, id: b.id }, json: { allow } }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const outcome = { allowed: 'Allowed', denied: 'Declined', expired: 'No answer in time, so it was declined', pending: '' }[b.state];
  return (
    <div className={`dc-perm dc-perm-${b.state}`} data-testid="permission-card">
      <div className="dc-perm-title">
        <Icon name="warn" />
        <span>Claude wants to</span>
      </div>
      <pre>{b.text}</pre>
      {b.state === 'pending' ? (
        <div className="dc-perm-actions">
          <button type="button" className="ws-btn sm" disabled={busy} onClick={() => answer(false)}>
            Decline
          </button>
          <button type="button" className="ws-btn sm primary" disabled={busy} onClick={() => answer(true)}>
            Allow once
          </button>
        </div>
      ) : (
        <p className="dc-perm-outcome">{outcome}</p>
      )}
      {err && <p className="dc-perm-outcome">{err}</p>}
    </div>
  );
}

function ErrorCard({ text, slug }: { text: string; slug?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="dc-error">
      <div className="dc-error-title">
        <Icon name="warn" />
        <span>Error</span>
      </div>
      <pre>{text}</pre>
      {slug && (
        <button
          type="button"
          className="ws-btn sm danger dc-fix"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await postJSON(
                api.chat[':slug'].prompt.$post({ param: { slug }, json: { text: `The game shows this error after the last change. Find the cause and fix it:\n\n${text}`, display: 'Fix the error above' } }),
              );
            } catch (e) {
              setBusy(false);
              setErr((e as Error).message);
            }
          }}
        >
          Fix it
        </button>
      )}
      {err && <pre>{err}</pre>}
    </div>
  );
}

// "· 2 files, +14 −3" for checkpoints whose run has finished
function changes(cp: CheckpointMeta) {
  if (cp.files == null) return '';
  if (!cp.files) return ' · no changes';
  return (
    <>
      {` · ${cp.files} file${cp.files === 1 ? '' : 's'}, `}
      <span className="dc-cp-delta">{`+${cp.additions} −${cp.deletions}`}</span>
    </>
  );
}

function Checkpoints({ slug, running }: { slug: string; running: boolean }) {
  const list = useQuery({
    queryKey: ['checkpoints', slug],
    queryFn: () => postJSON(api.chat[':slug'].checkpoints.$get({ param: { slug } })) as Promise<CheckpointMeta[]>,
  });
  const { refetch } = list;
  useEffect(() => {
    if (!running) refetch();
  }, [running, refetch]);
  const [busy, setBusy] = useState<string | null>(null);
  async function restore(cp: CheckpointMeta) {
    if (!confirm(`Restore the game to before:\n\n“${cp.prompt.split('\n')[0]}”?`)) return;
    setBusy(cp.id);
    try {
      await postJSON(api.chat[':slug'].restore.$post({ param: { slug }, json: { id: cp.id } }));
      refetch();
    } catch (err) {
      alert((err as Error).message || 'Restore failed');
    }
    setBusy(null);
  }
  if (list.isLoading)
    return (
      <div className="dc-history ws-scroll">
        <p className="dc-note">Loading…</p>
      </div>
    );
  const cps = list.data || [];
  if (!cps.length)
    return (
      <div className="dc-history ws-scroll">
        <p className="dc-hint">No checkpoints yet. One is saved before every prompt, so any change can be undone.</p>
      </div>
    );
  const last = cps[0];
  return (
    <div className="dc-history ws-scroll">
      <div className="dc-undo">
        <button type="button" className="ws-btn primary" disabled={!!busy} onClick={() => restore(last)}>
          <Icon name="undo" />
          <span>Undo last prompt</span>
        </button>
        <p>Puts the game back to how it was before “{last.prompt.split('\n')[0]}”. The current version is saved first, so you can redo it from this list.</p>
      </div>
      <h3 className="dc-hist-title">All checkpoints</h3>
      {cps.map((cp) => (
        <div className="dc-cp" key={cp.id}>
          <div className="dc-cp-text">Before: {cp.prompt.split('\n')[0]}</div>
          <div className="dc-cp-meta">
            {new Date(cp.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {cp.engine ? ' · includes engine' : ''}
            {changes(cp)}
          </div>
          <button type="button" className="ws-btn sm" disabled={busy === cp.id} onClick={() => restore(cp)}>
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}
