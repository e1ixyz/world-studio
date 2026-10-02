// Questions for the running game, asked on the agent's behalf: what the user sees, the game's
// state, errors. The daemon can't see the game, so it asks the studio pages showing the project
// (over their chat stream); the page asks the game over the bridge and posts the answer back. The
// first answer wins, so it works with any number of open windows.
import type { StudioEvents } from './events.ts';

export type ProbeKind = 'screenshot' | 'state';

export class NoGameWindow extends Error {}

export class LiveGames {
  private nextId = 0;
  private pending = new Map<string, { slug: string; resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private events: StudioEvents;
  constructor(events: StudioEvents) {
    this.events = events;
  }

  ask(slug: string, what: ProbeKind, timeoutMs = 5000): Promise<unknown> {
    const id = `p${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NoGameWindow('No game window answered. The user may not have this project open; ask them to open it in World Studio.'));
      }, timeoutMs);
      this.pending.set(id, { slug, resolve, reject, timer });
      this.events.emit('probe', { slug, id, what });
    });
  }

  answer(slug: string, id: string, r: { ok: boolean; data?: unknown; error?: string }) {
    const p = this.pending.get(id);
    if (!p || p.slug !== slug) return false; // unknown, or another window answered first
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (r.ok) p.resolve(r.data);
    else p.reject(new Error(r.error || 'The game could not answer'));
    return true;
  }
}
