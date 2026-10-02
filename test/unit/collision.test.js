import { describe, expect, it } from 'vitest';
import { CollisionGrid, resolveCircle } from '../../engine/core/collision.js';

const rect = (x0, z0, x1, z1) => ({ x0, z0, x1, z1 });

describe('CollisionGrid', () => {
  it('returns each rect once, even when it spans many cells', () => {
    const g = new CollisionGrid(10);
    const big = rect(-25, -25, 25, 25);
    g.add(big);
    g.add(rect(100, 100, 110, 110));
    expect(g.query(0, 0, 30)).toEqual([big]);
    expect(g.query(500, 500, 1)).toEqual([]);
  });

  it('pointInside respects the margin', () => {
    const g = new CollisionGrid(32);
    g.add(rect(0, 0, 10, 10));
    expect(g.pointInside(5, 5)).toBe(true);
    expect(g.pointInside(10.5, 5)).toBe(false);
    expect(g.pointInside(10.5, 5, 1)).toBe(true);
  });
});

describe('resolveCircle', () => {
  it('pushes a circle out of a side', () => {
    const p = { x: 10.5, z: 5 };
    expect(resolveCircle(p, 1, [rect(0, 0, 10, 10)])).toBe(true);
    expect(p.x).toBeCloseTo(11);
    expect(p.z).toBe(5);
  });

  it('exits through the nearest side when the center is inside', () => {
    const p = { x: 1, z: 5 };
    resolveCircle(p, 0.5, [rect(0, 0, 10, 10)]);
    expect(p).toEqual({ x: -0.5, z: 5 });
  });

  it('leaves a circle alone when clear', () => {
    const p = { x: 20, z: 20 };
    expect(resolveCircle(p, 1, [rect(0, 0, 10, 10)])).toBe(false);
    expect(p).toEqual({ x: 20, z: 20 });
  });
});
