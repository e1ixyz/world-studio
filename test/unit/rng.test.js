import { describe, expect, it } from 'vitest';
import { createRng, hashString, mulberry32 } from '../../engine/core/rng.js';

// Games generate their worlds from these sequences. If any value here changes, every saved
// world (and Meridian's reload restore of collected cores) changes with it.
describe('rng', () => {
  it('mulberry32 is stable for Meridian’s seed', () => {
    const r = mulberry32(20260930);
    expect([r(), r(), r()]).toEqual([0.7129707557614893, 0.9029586620163172, 0.8964550015516579]);
  });

  it('hashString is FNV-1a', () => {
    expect(hashString('meridian-city')).toBe(2238236402);
  });

  it('createRng seeds from strings and numbers', () => {
    const r = createRng('meridian-city');
    expect([r.rand(), r.rand(), r.ri(1, 6), r.rr(2, 4)]).toEqual([0.6954729917924851, 0.5029808368999511, 2, 3.027804145589471]);
    expect(createRng(5).rand()).toBe(mulberry32(5)());
  });

  it('ri is inclusive and pick stays in range', () => {
    const r = createRng(1);
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(r.ri(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
    for (let i = 0; i < 100; i++) expect(['a', 'b']).toContain(r.pick(['a', 'b']));
  });
});
