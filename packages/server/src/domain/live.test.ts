import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioEvents } from './events.ts';
import { LiveGames, NoGameWindow } from './live.ts';

describe('LiveGames', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks the project windows and takes the first answer', async () => {
    const events = new StudioEvents();
    const live = new LiveGames(events);
    const asked: { slug: string; id: string; what: string }[] = [];
    events.on('probe', (p) => asked.push(p));
    const answer = live.ask('g', 'state');
    expect(asked).toEqual([{ slug: 'g', id: 'p1', what: 'state' }]);
    expect(live.answer('other', 'p1', { ok: true, data: 1 })).toBe(false); // wrong project
    expect(live.answer('g', 'p1', { ok: true, data: { mode: 'play' } })).toBe(true);
    expect(live.answer('g', 'p1', { ok: true, data: 2 })).toBe(false); // second window
    await expect(answer).resolves.toEqual({ mode: 'play' });
  });

  it('fails clearly when no window answers, or the game reports an error', async () => {
    const live = new LiveGames(new StudioEvents());
    const none = live.ask('g', 'screenshot', 1000);
    vi.advanceTimersByTime(1001);
    await expect(none).rejects.toBeInstanceOf(NoGameWindow);
    const bad = live.ask('g', 'state');
    live.answer('g', 'p2', { ok: false, error: 'The game has not started yet' });
    await expect(bad).rejects.toThrow('The game has not started yet');
  });
});
