import { describe, expect, it, vi } from 'vitest';
import { Tweaks } from '../../engine/build/tweaks.js';

describe('Tweaks', () => {
  it('infers types, applies saved values and calls onChange at once', () => {
    const t = new Tweaks({ 'City / Speed': 3 });
    const onChange = vi.fn();
    expect(t.add('City / Speed', { value: 1, min: 0, max: 10, onChange })).toBe(3);
    expect(onChange).toHaveBeenCalledWith(3);
    t.add('Glow', { value: true });
    t.add('Tint', { value: '#ff0000' });
    t.add('Mode', { value: 'a', options: ['a', 'b'] });
    const d = t.defs;
    expect([d.get('City / Speed').type, d.get('Glow').type, d.get('Tint').type, d.get('Mode').type]).toEqual(['range', 'bool', 'color', 'select']);
    expect(d.get('City / Speed').step).toBe(0.05);
  });

  it('tracks unsaved changes, discard and markSaved', () => {
    const t = new Tweaks();
    t.add('A', { value: 1, max: 10 });
    t.add('B', { value: 1, max: 10, save: false });
    t.set('A', 5);
    t.set('B', 5);
    expect(t.unsaved().map((x) => x.key)).toEqual(['A']);
    t.discard();
    expect(t.get('A')).toBe(1);
    t.set('A', 7);
    t.markSaved();
    expect(t.unsaved()).toEqual([]);
    expect(t.values()).toEqual({ A: 7 });
    t.reset('A');
    expect(t.values()).toEqual({});
  });

  it('groups by "Group / Name" and filters engine tweaks', () => {
    const t = new Tweaks();
    t.add('World / Fog', { value: 1, engine: true });
    t.add('City / Cars', { value: 1 });
    t.add('Loose', { value: 1 });
    expect([...t.groups().keys()]).toEqual(['World', 'City', 'General']);
    expect([...t.groups({ engine: false }).keys()]).toEqual(['City', 'General']);
    expect(t.groups().get('City')[0].name).toBe('Cars');
  });

  it('survives a throwing onChange', () => {
    const t = new Tweaks();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => t.add('X', { value: 1, onChange: () => { throw new Error('boom'); } })).not.toThrow();
    err.mockRestore();
  });
});
