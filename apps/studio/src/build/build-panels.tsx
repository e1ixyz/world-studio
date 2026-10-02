// Build mode's panels: the top bar (projects, Play | Build, time of day, pause, attach view, test
// from here, shortcuts), Properties (selection card and tweaks), the hint bar, the shortcuts sheet
// and the first-run tips. They sit over the game frame and drive the game's build mode through the
// bridge; the in-world half (camera, picking, the label over the selection) stays in the engine.
import type { BuildState, SelectionView, StudioMessageBody, TweakView } from '@ws/bridge';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../chat/icon.tsx';
import { api } from '../lib/api.ts';
import './build.css';

const TIPS_KEY = 'worldstudio:build-tips-seen';
const COLLAPSED_KEY = 'worldstudio:props-collapsed';
const titleCase = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());
const fmt = (v: unknown) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '')) : String(v));
const clock = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const stored = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const store = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage blocked */
  }
};

interface Props {
  slug: string;
  name: string;
  state: BuildState;
  send(msg: StudioMessageBody): void;
  onAsk(): void;
  onAttachView(): void;
  // hand the keyboard back to the game after a click, so WASD keeps flying the camera
  refocusGame(): void;
}

export function BuildPanels({ slug, name, state, send, onAsk, onAttachView, refocusGame }: Props) {
  const [collapsed, setCollapsed] = useState(() => stored(COLLAPSED_KEY));
  const [sheet, setSheet] = useState(false);
  const [tips, setTips] = useState(() => !stored(TIPS_KEY));
  const act = (a: Extract<StudioMessageBody, { t: 'buildAction' }>['a'], extra: { key?: string; value?: unknown } = {}) => send({ t: 'buildAction', a, ...extra });

  useEffect(() => store(COLLAPSED_KEY, collapsed), [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const night = state.night > 0.5;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: returns keyboard focus to the game after clicks on buttons
    <div
      className={`ws-root bm${collapsed ? ' props-collapsed' : ''}`}
      data-testid="build-panels"
      onPointerUp={(e) => {
        if (!(e.target as Element).closest('input, select, textarea, [data-keep-focus]')) requestAnimationFrame(refocusGame);
      }}
    >
      <header className="ws-top" role="toolbar" aria-label="Build mode">
        <a className="ws-btn quiet ws-back" href="/">
          <Icon name="back" />
          <span>Projects</span>
        </a>
        <span className="ws-proj" title={name}>
          {name || slug}
        </span>
        <div className="ws-seg" role="radiogroup" aria-label="Mode">
          {/* biome-ignore lint/a11y/useSemanticElements: a segmented switch styled as buttons, with radio semantics */}
          <button type="button" role="radio" aria-checked="false" onClick={() => act('play')}>
            <Icon name="play" />
            <span>Play</span>
          </button>
          {/* biome-ignore lint/a11y/useSemanticElements: see above */}
          <button type="button" role="radio" aria-checked="true">
            <Icon name="build" />
            <span>Build</span>
          </button>
          <span className="ws-kbd" title="Switch with Tab">
            Tab
          </span>
        </div>
        <div className="ws-world">
          <TimeControl time={state.time} night={night} onChange={(v) => act('setTime', { value: v })} />
          <button
            type="button"
            className={`ws-btn ws-pause${state.frozen ? ' on' : ''}`}
            aria-pressed={state.frozen}
            title={state.frozen ? 'Traffic, people and the clock are paused. Click to run them.' : 'Pause traffic, people and the clock'}
            onClick={() => act('toggleFreeze')}
          >
            <Icon name={state.frozen ? 'play' : 'pause'} />
            <span>{state.frozen ? 'Resume world' : 'Pause world'}</span>
          </button>
          <button type="button" className="ws-btn ws-shot" title="Attach a screenshot of this view to your next prompt" onClick={onAttachView}>
            <Icon name="camera" />
            <span>Attach view</span>
            <span className="ws-kbd">K</span>
          </button>
          <button type="button" className="ws-btn ws-test" title="Drop the player at the camera and play" onClick={() => act('playFromHere')}>
            <Icon name="pin" />
            <span>Test from here</span>
            <span className="ws-kbd">P</span>
          </button>
          <button type="button" className="ws-icon ws-helpbtn" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" data-keep-focus onClick={() => setSheet((v) => !v)}>
            <Icon name="help" />
          </button>
        </div>
      </header>

      <aside className="ws-props" aria-label="Properties">
        <div className="ws-props-head">
          <h2>Properties</h2>
          <button type="button" className="ws-icon ws-collapse" title="Hide panel" aria-label="Hide properties panel" onClick={() => setCollapsed(true)}>
            <Icon name="back" />
          </button>
        </div>
        <div className="ws-props-body ws-scroll">
          <SelectionCard selection={state.selection} onAsk={onAsk} onFrame={() => act('frame')} onDeselect={() => act('deselect')} />
          <Tweaks tweaks={state.tweaks} onSet={(key, value) => act('tweakSet', { key, value })} onReset={(key) => act('tweakReset', { key })} />
        </div>
        <SaveBar slug={slug} state={state} onDiscard={() => act('tweakDiscard')} onSaved={() => act('tweakSaved')} />
      </aside>
      <button type="button" className="ws-rail" title="Show properties" aria-label="Show properties panel" onClick={() => setCollapsed(false)}>
        <Icon name="sliders" />
      </button>

      <div className={`ws-hint${state.moved ? ' quiet' : ''}`}>
        <span>
          <b>WASD</b> fly
        </span>
        <span>
          <b>Right-drag</b> look
        </span>
        <span>
          <b>Q / E</b> down / up
        </span>
        <span>
          <b>Shift</b> faster
        </span>
        <span>
          <b>Scroll</b> speed
        </span>
        {/* keeps focus here, so Esc closes the sheet */}
        <button type="button" className="ws-btn sm quiet ws-helpbtn" data-keep-focus onClick={() => setSheet((v) => !v)}>
          Shortcuts
        </button>
      </div>

      {sheet && <ShortcutsSheet onClose={() => setSheet(false)} />}

      {tips && (
        <div className="ws-tips" role="note">
          <h3>Build by describing what you want</h3>
          <ol>
            <li>
              <b>Fly around</b> with WASD and right-drag to look.
            </li>
            <li>
              <b>Click anything</b> in the world to select it. Tweaks on the left change it live.
            </li>
            <li>
              <b>Ask for a change</b> on the right. The game reloads where you are.
            </li>
          </ol>
          <button
            type="button"
            className="ws-btn sm primary ws-tips-ok"
            onClick={() => {
              setTips(false);
              store(TIPS_KEY, true);
            }}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}

// Time of day. Keeps its own value while dragging, so the readout follows the thumb and state
// echoing back from the game doesn't fight it.
function TimeControl({ time, night, onChange }: { time: number; night: boolean; onChange(v: number): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? time;
  return (
    <label className="ws-time" title="Time of day">
      <span className="ws-time-icon" data-night={String(night)}>
        <Icon name={night ? 'moon' : 'sun'} />
      </span>
      <output>{clock(shown)}</output>
      <input
        type="range"
        min={0}
        max={24}
        step={0.05}
        aria-label="Time of day"
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDrag(v);
          onChange(v);
        }}
        onPointerUp={() => setDrag(null)}
        onBlur={() => setDrag(null)}
      />
    </label>
  );
}

function SelectionCard({ selection: e, onAsk, onFrame, onDeselect }: { selection: SelectionView | null; onAsk(): void; onFrame(): void; onDeselect(): void }) {
  if (!e)
    return (
      <section className="ws-sel empty">
        <Icon name="target" />
        <p>Click anything in the world to select it, then ask for a change.</p>
      </section>
    );
  const props = Object.entries(e.props);
  const main = props.slice(0, 3);
  const rest = props.slice(3);
  const row = ([k, v]: [string, unknown]) => (
    <div key={k}>
      <dt>{k}</dt>
      <dd>{fmt(v)}</dd>
    </div>
  );
  const [cx, cy, cz] = e.center;
  const [sx, sy, sz] = e.size;
  return (
    <section className="ws-sel" data-testid="selection-card">
      <div className="ws-sel-title">
        <span className="ws-sel-dot" />
        <h3>{titleCase(e.kind)}</h3>
        {e.id != null && <span className="ws-sel-id">{e.id}</span>}
      </div>
      <dl className="ws-props-list">
        {main.map(row)}
        <div>
          <dt>size</dt>
          <dd>
            {sx.toFixed(1)} × {sy.toFixed(1)} × {sz.toFixed(1)} m
          </dd>
        </div>
      </dl>
      <details className="ws-more">
        <summary>
          <Icon name="chevron" />
          More details
        </summary>
        <dl className="ws-props-list">
          {rest.map(row)}
          <div>
            <dt>position</dt>
            <dd>
              {cx.toFixed(1)}, {cy.toFixed(1)}, {cz.toFixed(1)}
            </dd>
          </div>
          {e.source && (
            <div>
              <dt>code</dt>
              <dd className="ws-src">{e.source}</dd>
            </div>
          )}
        </dl>
      </details>
      <button type="button" className="ws-btn select ws-ask" onClick={onAsk}>
        Ask about this
      </button>
      <div className="ws-sel-row">
        <button type="button" className="ws-btn sm ws-frame" onClick={onFrame}>
          <Icon name="frame" />
          <span>Frame</span>
          <span className="ws-kbd">F</span>
        </button>
        <button type="button" className="ws-btn sm quiet ws-clear" onClick={onDeselect}>
          <span>Deselect</span>
          <span className="ws-kbd">Esc</span>
        </button>
      </div>
    </section>
  );
}

function Tweaks({ tweaks, onSet, onReset }: { tweaks: TweakView[]; onSet(key: string, v: unknown): void; onReset(key: string): void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const own = new Map<string, TweakView[]>();
    const engine = new Map<string, TweakView[]>();
    for (const t of tweaks) {
      if (query && !`${t.key} ${t.name}`.toLowerCase().includes(query)) continue;
      const m = t.engine ? engine : own;
      m.set(t.group, [...(m.get(t.group) || []), t]);
    }
    return { own, engine };
  }, [tweaks, query]);
  const hasOwn = tweaks.some((t) => !t.engine);
  return (
    <section className="ws-tw">
      <div className="ws-tw-head">
        <h3>Tweaks</h3>
        <label className="ws-search">
          <Icon name="search" />
          <input type="search" placeholder="Filter" aria-label="Filter tweaks" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="ws-tw-list">
        {!hasOwn && <p className="ws-empty">This game has no tweaks of its own yet. Ask to “add tweaks for …” and they show up here.</p>}
        {[...groups.own].map(([group, defs]) => (
          <TweakGroup key={group} name={group} defs={defs} open onSet={onSet} onReset={onReset} />
        ))}
        {groups.engine.size > 0 && (
          <details className="ws-group ws-engine" open={!!query || undefined}>
            <summary>
              <Icon name="chevron" />
              Engine settings<span className="ws-group-note">shared by every game</span>
            </summary>
            {[...groups.engine].map(([group, defs]) => (
              <TweakGroup key={group} name={group} defs={defs} open nested onSet={onSet} onReset={onReset} />
            ))}
          </details>
        )}
      </div>
    </section>
  );
}

function TweakGroup({ name, defs, open, nested, onSet, onReset }: { name: string; defs: TweakView[]; open: boolean; nested?: boolean; onSet(key: string, v: unknown): void; onReset(key: string): void }) {
  return (
    <details className={`ws-group${nested ? ' nested' : ''}`} open={open}>
      <summary>
        <Icon name="chevron" />
        {name}
      </summary>
      {defs.map((d) => (
        <TweakRow key={d.key} d={d} onSet={onSet} onReset={onReset} />
      ))}
    </details>
  );
}

function TweakRow({ d, onSet, onReset }: { d: TweakView; onSet(key: string, v: unknown): void; onReset(key: string): void }) {
  const id = `tw-${d.key.replace(/\W+/g, '-')}`;
  // the control keeps what the user is dragging until the game confirms it
  const [local, setLocal] = useState<unknown>(undefined);
  const value = local ?? d.value;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new value from the game ends the local edit
  useEffect(() => setLocal(undefined), [d.value]);
  const set = (v: unknown) => {
    setLocal(v);
    onSet(d.key, v);
  };
  let control: React.ReactNode;
  if (d.type === 'range')
    control = (
      <>
        <output>{fmt(value)}</output>
        <input id={id} type="range" min={d.min} max={d.max} step={d.step} value={Number(value)} onChange={(e) => set(Number(e.target.value))} />
      </>
    );
  else if (d.type === 'color') control = <input id={id} type="color" value={String(value)} onChange={(e) => set(e.target.value)} />;
  else if (d.type === 'bool') control = <input id={id} type="checkbox" role="switch" aria-checked={!!value} checked={!!value} onChange={(e) => set(e.target.checked)} />;
  else
    control = (
      <select id={id} value={String(value)} onChange={(e) => set(e.target.value)}>
        {(d.options || []).map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  return (
    <div className={`ws-tweak t-${d.type}${d.value !== d.initial ? ' changed' : ''}`} data-key={d.key}>
      <label htmlFor={id} className="ws-tweak-name">
        {d.name}
      </label>
      {control}
      <button type="button" className="ws-reset" title="Reset to default" aria-label={`Reset ${d.name}`} onClick={() => onReset(d.key)}>
        <Icon name="reset" />
      </button>
    </div>
  );
}

function SaveBar({ slug, state, onDiscard, onSaved }: { slug: string; state: BuildState; onDiscard(): void; onSaved(): void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const n = state.unsaved;
  if (!n && !error) return null;
  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await api.tweaks.$post({ json: { slug, values: state.values } });
      if (!res.ok) throw new Error(res.statusText);
      onSaved();
    } catch {
      setError('Save failed. Is the studio server running?');
    }
    setSaving(false);
  }
  return (
    <footer className="ws-tw-foot">
      <span className="ws-unsaved">{error || `${n} unsaved change${n === 1 ? '' : 's'}`}</span>
      <button type="button" className="ws-btn sm quiet ws-discard" onClick={onDiscard}>
        Discard
      </button>
      <button type="button" className="ws-btn sm primary ws-save" disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </footer>
  );
}

function ShortcutsSheet({ onClose }: { onClose(): void }) {
  const K = ({ children }: { children: string }) => <span className="ws-kbd">{children}</span>;
  const row = (k: React.ReactNode, v: string) => (
    <div key={v}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
  return (
    <div className="ws-sheet" role="dialog" aria-label="Keyboard shortcuts">
      <div className="ws-sheet-head">
        <h3>Shortcuts</h3>
        <button type="button" className="ws-icon ws-sheet-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="ws-sheet-cols">
        <div className="ws-sheet-col">
          <p className="ws-sheet-title">Build mode</p>
          {row(<K>W A S D</K>, 'Fly')}
          {row(
            <>
              <K>Q</K> <K>E</K>
            </>,
            'Down / up',
          )}
          {row(<K>Shift</K>, 'Fly faster')}
          {row('Right-drag', 'Look around')}
          {row('Scroll', 'Camera speed')}
          {row('Click', 'Select an object')}
          {row(<K>F</K>, 'Frame the selection')}
          {row(<K>Esc</K>, 'Deselect')}
          {row(<K>K</K>, 'Attach view to prompt')}
          {row(<K>P</K>, 'Test from here')}
          {row(<K>Enter</K>, 'Write a prompt')}
        </div>
        <div className="ws-sheet-col">
          <p className="ws-sheet-title">Anywhere</p>
          {row(<K>Tab</K>, 'Switch Play / Build')}
          {row(<K>`</K>, 'Show / hide Ask')}
          {row(<K>N</K>, 'Jump day / night')}
          {row(<K>G</K>, 'Graphics quality')}
          <p className="ws-sheet-title">Play mode</p>
          {row(<K>F</K>, 'Toggle flight')}
          {row(<K>M</K>, 'Map')}
          {row(<K>Esc</K>, 'Pause')}
        </div>
      </div>
    </div>
  );
}
