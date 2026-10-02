import { describe, expect, it } from 'vitest';
import { buildTimeline, feedFor, selectionKind, selectionName } from './timeline.ts';

let seq = 0;
const item = (kind: string, text = '', meta?: Record<string, unknown>) => ({ kind, text, meta, seq: ++seq, ts: 1000 * seq }) as never;

describe('buildTimeline', () => {
  it('groups tools into steps, splits on text, and dims progress notes when done', () => {
    const blocks = buildTimeline([
      item('user', 'make it rain\n[with selection, screenshot]'),
      item('tool', 'Read games/x/game.js'),
      item('tool', 'Edit games/x/game.js'),
      item('text', 'Reading the weather code'),
      item('tool', 'Edit games/x/fx.js'),
      item('text', 'Added rain.'),
      item('done', '', { ms: 65000, cost: 0.0956 }),
      item('reload', 'Reloading with 2 changed files'),
    ]);
    expect(blocks.map((b) => b.k)).toEqual(['user', 'steps', 'text', 'steps', 'text', 'note', 'reload']);
    expect(blocks[0]).toMatchObject({ text: 'make it rain', extra: 'with selection, screenshot' });
    expect(blocks[1]).toMatchObject({ steps: ['Read games/x/game.js', 'Edit games/x/game.js'] });
    expect(blocks[2]).toMatchObject({ progress: true });
    expect(blocks[4]).toMatchObject({ text: 'Added rain.', progress: false });
    expect(blocks[5]).toMatchObject({ text: 'Done in 1m 5s · $0.10' });
  });

  it('times a turn from its timestamps when the result has no duration', () => {
    const blocks = buildTimeline([item('user', 'x'), item('done')]);
    expect(blocks.at(-1)).toMatchObject({ text: 'Done in 1s' });
  });

  it('shows errors, local fixable ones included', () => {
    const blocks = buildTimeline([item('error', 'boom'), { kind: 'error', text: 'TypeError', fixable: true, localId: 1, ts: 0 }]);
    expect(blocks).toMatchObject([
      { k: 'error', fixable: false },
      { k: 'error', fixable: true, key: 'local-1' },
    ]);
  });
});

describe('permission cards', () => {
  it('shows one card per question and updates it with the answer', () => {
    const blocks = buildTimeline([
      item('user', 'x'),
      item('permission', 'Edit engine/core/app.js', { id: 'a1', tool: 'Edit', state: 'pending' }),
      item('permission', '', { id: 'a1', tool: 'Edit', state: 'denied' }),
    ]);
    expect(blocks.filter((b) => b.k === 'permission')).toEqual([expect.objectContaining({ id: 'a1', text: 'Edit engine/core/app.js', state: 'denied' })]);
  });
});

describe('helpers', () => {
  it('feedFor', () => {
    expect(feedFor(item('user', 'hello\nmore'))).toEqual({ text: 'Sent: hello' });
    expect(feedFor(item('error', 'x'))?.error).toBe(true);
    expect(feedFor(item('done'))).toBeNull();
  });
  it('reads the selection block', () => {
    const sel = '[Selected object: building "b12" centered at x=5.0, y=20.0, z=10.0, size 1 x 1 x 1 m]';
    expect(selectionName(sel)).toBe('building "b12"');
    expect(selectionKind(sel)).toBe('building');
  });
});
