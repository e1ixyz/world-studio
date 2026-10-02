import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReloadScope } from './events.ts';
import { DEBOUNCE_MS, JOB_END_MS, ReloadCoordinator, SEND_DELAY_MS } from './reloads.ts';

const ROOT = '/studio';
const f = (...p: string[]) => path.join(ROOT, ...p);

function setup() {
  const state = { running: false, recent: null as string | null };
  const sent: ReloadScope[] = [];
  const logged: [string, string[], boolean][] = [];
  const invalidated: string[][] = [];
  let projectsChanged = 0;
  const mtimes = new Map<string, number>();
  const rc = new ReloadCoordinator(
    ROOT,
    {
      anyJobRunning: () => state.running,
      recentJobChat: () => state.recent,
      logReload: (slug, files, all) => logged.push([slug, files, all]),
      sendReload: (s) => sent.push(s),
      projectsChanged: () => projectsChanged++,
    },
    { invalidateFiles: (x) => invalidated.push(x), invalidateAll() {} },
    (file) => mtimes.get(file),
  );
  return { rc, state, sent, logged, invalidated, mtimes, projects: () => projectsChanged };
}

describe('ReloadCoordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves css, assets and outside files to Vite', () => {
    const { rc } = setup();
    expect(rc.fileChanged(f('games/a/style.css'))).toBe('pass');
    expect(rc.fileChanged(f('harness/client/chat.js'))).toBe('pass');
    expect(rc.fileChanged('/elsewhere/x.js')).toBe('pass');
    expect(rc.fileChanged(f('templates/blank/game.js'))).toBe('ignore');
    expect(rc.fileChanged(f('.harness/x.json'))).toBe('ignore');
  });

  it('never reloads for game data files; game.json refreshes the landing page', () => {
    const { rc, sent, projects } = setup();
    for (const name of ['tweaks.json', 'thumb.jpg', 'game.json']) rc.fileChanged(f('games/a', name));
    vi.runAllTimers();
    expect(sent).toEqual([]);
    expect(projects()).toBe(1);
  });

  it('debounces a game edit with no job running and scopes it to the game', () => {
    const { rc, sent, invalidated, logged } = setup();
    rc.fileChanged(f('games/a/game.js'));
    rc.fileChanged(f('games/a/city.js'));
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(invalidated).toEqual([]);
    vi.advanceTimersByTime(1 + SEND_DELAY_MS);
    expect(invalidated).toEqual([[f('games/a/game.js'), f('games/a/city.js')]]);
    expect(sent).toEqual([{ slugs: ['a'] }]);
    expect(logged).toEqual([]); // no chat to credit
  });

  it('engine edits reload every tab', () => {
    const { rc, sent } = setup();
    rc.fileChanged(f('games/a/game.js'));
    rc.fileChanged(f('engine/core/app.js'));
    vi.runAllTimers();
    expect(sent).toEqual([{ all: true }]);
  });

  it('holds changes while any job runs and flushes once when it ends', () => {
    const { rc, state, sent, logged } = setup();
    state.running = true;
    rc.fileChanged(f('games/a/game.js'));
    rc.fileChanged(f('games/b/game.js'));
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual([]);
    state.running = false;
    rc.jobEnded('a');
    vi.advanceTimersByTime(JOB_END_MS + SEND_DELAY_MS);
    expect(sent).toEqual([{ slugs: ['a', 'b'] }]);
    expect(logged).toEqual([['a', [f('games/a/game.js'), f('games/b/game.js')], false]]);
  });

  it('does not flush when another job is still running at the end of one', () => {
    const { rc, state, sent } = setup();
    state.running = true;
    rc.fileChanged(f('games/a/game.js'));
    rc.jobEnded('b'); // b ended, a still running
    vi.advanceTimersByTime(JOB_END_MS * 3);
    expect(sent).toEqual([]);
  });

  it('credits late file events to the job that just ended', () => {
    const { rc, state, logged } = setup();
    state.recent = 'a';
    rc.fileChanged(f('games/a/game.js'));
    vi.runAllTimers();
    expect(logged.map((l) => l[0])).toEqual(['a']);
  });

  it('ignores everything while suppressed (restore)', () => {
    const { rc, sent } = setup();
    rc.suppress(2500);
    expect(rc.fileChanged(f('games/a/game.js'))).toBe('ignore');
    vi.advanceTimersByTime(2600);
    expect(rc.fileChanged(f('games/a/game.js'))).toBe('reload');
    vi.runAllTimers();
    expect(sent).toHaveLength(1);
  });

  it('skips the watcher echo of files the harness copied, but not later edits to them', () => {
    const { rc, sent, mtimes } = setup();
    const file = f('games/new/game.js');
    mtimes.set(file, 100);
    rc.markFresh([file]);
    expect(rc.fileChanged(file)).toBe('ignore');
    expect(rc.fileChanged(file)).toBe('ignore'); // second Vite environment
    vi.runAllTimers();
    expect(sent).toEqual([]);
    mtimes.set(file, 200);
    expect(rc.fileChanged(file)).toBe('reload');
  });
});
