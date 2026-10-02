import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Selection } from '../../engine/build/selection.js';

const ray = (o, d) => {
  const r = new THREE.Raycaster();
  r.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
  return r;
};

describe('Selection', () => {
  it('picks the nearest box hit by the ray, including providers', () => {
    const s = new Selection(new THREE.Scene());
    s.add({ kind: 'building', id: 'far', box: [-1, 0, -21, 1, 2, -19] });
    s.add({ kind: 'building', id: 'near', box: [-1, 0, -11, 1, 2, -9] });
    s.addProvider(() => [{ kind: 'car', id: 'side', getBox: () => [10, 0, -1, 12, 2, 1] }]);
    expect(s.pick(ray([0, 1, 0], [0, 0, -1])).id).toBe('near');
    expect(s.pick(ray([0, 1, 0], [1, 0, 0])).id).toBe('side');
    expect(s.pick(ray([0, 1, 0], [0, 1, 0]))).toBeNull();
  });

  // This string goes into prompts verbatim; the agent's system prompt documents its shape.
  it('describe() keeps its exact format', () => {
    const s = new Selection(new THREE.Scene());
    const e = s.add({ kind: 'building', id: 'b12', box: [0, 0, 0, 10, 40, 20], props: { floors: 12, height: 40.256 }, source: 'games/x/city.js' });
    s.select(e);
    expect(s.describe()).toBe('[Selected object: building "b12" centered at x=5.0, y=20.0, z=10.0, size 10.0 x 40.0 x 20.0 m. Properties: floors=12, height=40.26. Defined in: games/x/city.js]');
    expect(s.describe(s.add({ kind: 'ground', box: [0, 0, 0, 1, 1, 1] }))).toBe('[Selected object: ground centered at x=0.5, y=0.5, z=0.5, size 1.0 x 1.0 x 1.0 m]');
    s.select(null);
    expect(s.describe()).toBe('');
  });
});
