import { describe, expect, it } from 'vitest';
import { GeoBuilder } from '../../engine/core/geo.js';

describe('GeoBuilder', () => {
  it('builds a box as 5 quads (no bottom)', () => {
    const b = new GeoBuilder();
    expect(b.empty).toBe(true);
    b.box(0, 2, 0, 3, 0, 4);
    const g = b.build();
    expect(g.getAttribute('position').count).toBe(20);
    expect(g.getIndex().count).toBe(30);
    expect(g.getIndex().array).toBeInstanceOf(Uint16Array);
    expect(g.boundingBox.min.toArray()).toEqual([0, 0, 0]);
    expect(g.boundingBox.max.toArray()).toEqual([2, 3, 4]);
  });

  it('can skip sides or top, and sends tops to another builder', () => {
    const roofs = new GeoBuilder();
    const b = new GeoBuilder();
    b.box(0, 1, 0, 1, 0, 1, { topBuilder: roofs });
    expect(b.v).toBe(16);
    expect(roofs.v).toBe(4);
    const c = new GeoBuilder();
    c.box(0, 1, 0, 1, 0, 1, { sides: false, top: false });
    expect(c.empty).toBe(true);
  });

  it('switches to 32-bit indices past 65535 vertices', () => {
    const b = new GeoBuilder();
    for (let i = 0; i < 16400; i++) b.top(0, 1, 0, 1, 0);
    expect(b.build().getIndex().array).toBeInstanceOf(Uint32Array);
  });
});
