// Scoped, batched reloads. A changed file in games/<slug>/ reloads only tabs playing that game;
// a changed file in engine/ reloads every tab. While any agent job runs, in any project, changes
// wait and flush once when the last job ends.
import path from 'node:path';
import type { ReloadScope } from './events.ts';

export const CODE_FILE = /\.(m?js|json|html|glsl|frag|vert)$/;
// Data files that never reload a game (game.json only refreshes the landing page).
export const GAME_DATA = new Set(['tweaks.json', 'thumb.jpg', 'game.json']);

export const DEBOUNCE_MS = 180; // a change with no job running
export const JOB_END_MS = 400; // after a job ends, let the watcher report its last edits
export const LATE_EVENT_MS = 2500; // events this soon after a job ends are credited to that job's chat
export const SEND_DELAY_MS = 150;

// Port over Vite's module graph, so the coordinator can be tested (and run without Vite).
export interface ModuleInvalidator {
  invalidateFiles(files: string[]): void;
  invalidateAll(): void;
}

export interface ReloadHost {
  anyJobRunning(): boolean;
  // The chat whose job ended within LATE_EVENT_MS, if any (gets the "Reloading…" line).
  recentJobChat(): string | null;
  logReload(slug: string, files: string[], all: boolean): void;
  sendReload(scope: ReloadScope): void;
  projectsChanged(): void;
}

export type FileVerdict = 'reload' | 'ignore' | 'pass';

export class ReloadCoordinator {
  private pending = new Map<string, string>(); // file -> slug or '*'
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suppressUntil = 0;
  // Files the harness itself just wrote by copying (new project, duplicate), with their mtime.
  // The watcher can report those a second or two later, once per Vite environment; they must
  // not reload the new tab.
  private fresh = new Map<string, number>();

  private root: string;
  private host: ReloadHost;
  private invalidator: ModuleInvalidator;
  private mtime: (file: string) => number | undefined;
  constructor(root: string, host: ReloadHost, invalidator: ModuleInvalidator, mtime: (file: string) => number | undefined) {
    this.root = root;
    this.host = host;
    this.invalidator = invalidator;
    this.mtime = mtime;
  }

  suppress(ms: number) {
    this.suppressUntil = Date.now() + ms;
  }

  markFresh(files: Iterable<string>) {
    for (const f of files) {
      const t = this.mtime(f);
      if (t !== undefined) this.fresh.set(f, t);
    }
  }

  // Called for every watcher event. 'pass' leaves the file to Vite's own HMR (css, assets, files
  // outside games/ and engine/); 'reload' and 'ignore' mean the harness handled it.
  fileChanged(file: string): FileVerdict {
    const r = path.relative(this.root, file);
    if (r.startsWith('..')) return 'pass';
    const [top, slug, name] = r.split(path.sep);
    if (top === '.harness' || top === 'templates') return 'ignore';
    if (top !== 'games' && top !== 'engine') return 'pass';
    if (!CODE_FILE.test(file)) return 'pass';
    if (Date.now() < this.suppressUntil) return 'ignore';
    if (this.fresh.has(file)) {
      if (this.mtime(file) === this.fresh.get(file)) return 'ignore';
      this.fresh.delete(file);
    }
    if (top === 'games') {
      if (!slug || !name || GAME_DATA.has(name)) {
        if (name === 'game.json') this.host.projectsChanged();
        return 'ignore';
      }
      this.queue(file, slug);
    } else this.queue(file, '*');
    return 'reload';
  }

  private queue(file: string, scope: string) {
    this.pending.set(file, scope);
    if (this.host.anyJobRunning()) return; // flushed when the job finishes
    const recent = this.host.recentJobChat();
    this.schedule(DEBOUNCE_MS, recent);
  }

  // A job just ended: flush once the watcher has caught up, unless another job is still running.
  jobEnded(slug: string) {
    this.schedule(JOB_END_MS, slug, true);
  }

  private schedule(ms: number, slug: string | null, onlyIfIdle = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (onlyIfIdle && this.host.anyJobRunning()) return;
      this.flush(slug);
    }, ms);
  }

  // Flush now, even while a job runs (the agent asked to test its change).
  flushNow(slug: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flush(slug);
  }

  flush(slug: string | null) {
    if (!this.pending.size) return;
    const files = [...this.pending.keys()];
    const scopes = new Set(this.pending.values());
    this.pending.clear();
    this.invalidator.invalidateFiles(files);
    const all = scopes.has('*');
    if (slug) this.host.logReload(slug, files, all);
    setTimeout(() => this.host.sendReload(all ? { all: true } : { slugs: [...scopes] }), SEND_DELAY_MS);
    this.host.projectsChanged();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
  }
}
