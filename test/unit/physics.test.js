import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Selection } from '../../engine/build/selection.js';
import { Tweaks } from '../../engine/build/tweaks.js';
import { createPhysics } from '../../engine/physics/physics.js';

const box = (w, h, d, y = 0, x = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.set(x, y, 0);
  return m;
};
const run = (p, seconds) => {
  for (let i = 0; i < seconds * 60; i++) p.step(1 / 60);
};

describe('physics', () => {
  it('drops a body onto a static floor, moves its mesh and lets it rest', async () => {
    const scene = new THREE.Scene();
    const p = await createPhysics({ scene });
    p.addStatic([-10, -1, -10, 10, 0, 10]);
    const crate = box(1, 1, 1, 5);
    scene.add(crate);
    p.addBody(crate, { mass: 2 });
    run(p, 3);
    expect(crate.position.y).toBeCloseTo(0.5, 1);
    expect(p.bodies[0].isSleeping()).toBe(true);
    expect(p.groundY(0, 0)).toBeCloseTo(1, 1); // on top of the crate
    expect(p.groundY(5, 5)).toBeCloseTo(0, 3);
  });

  it('is deterministic on its fixed clock, whatever the frame times', async () => {
    const sim = async (frames) => {
      const p = await createPhysics();
      p.addStatic([-10, -1, -10, 10, 0, 10]);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5));
      ball.position.set(0, 3, 0);
      p.addBody(ball, { shape: 'ball', restitution: 0.6, velocity: { x: 2, y: 0, z: 1 } });
      for (const dt of frames) p.step(dt);
      return ball.position.toArray().map((v) => v.toFixed(5));
    };
    const a = await sim(Array(120).fill(1 / 60));
    const b = await sim(Array(60).fill(1 / 30));
    expect(a).toEqual(b);
  });

  it('rolls a ball down a static ramp mesh', async () => {
    const p = await createPhysics();
    const ramp = box(10, 0.5, 4);
    ramp.rotation.z = -0.35;
    ramp.updateMatrixWorld();
    p.addStatic(ramp, { shape: 'box' });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.4));
    ball.position.set(-3, 3, 0);
    p.addBody(ball, { shape: 'ball' });
    run(p, 2);
    expect(ball.position.x).toBeGreaterThan(-1);
  });

  it('reports contacts, raycasts and removes bodies', async () => {
    const p = await createPhysics();
    p.addStatic([-10, -1, -10, 10, 0, 10]);
    const crate = box(1, 1, 1, 3);
    const body = p.addBody(crate);
    const seen = [];
    p.onContact(body, (other, started) => seen.push(started));
    run(p, 2);
    expect(seen[0]).toBe(true);
    const hit = p.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(hit.mesh).toBe(crate);
    p.remove(body);
    expect(p.bodies).toHaveLength(0);
    expect(p.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }).mesh).toBeNull();
  });

  it('lets the player shove bodies and makes them clickable', async () => {
    const scene = new THREE.Scene();
    const select = new Selection(scene);
    const tweaks = new Tweaks();
    const p = await createPhysics({ scene, select, tweaks });
    p.addStatic([-20, -1, -20, 20, 0, 20]);
    const crate = box(1, 1, 1, 0.5, 2);
    scene.add(crate);
    p.addBody(crate, { kind: 'crate', id: 'c1', mass: 1 });
    run(p, 1);
    // walk the player through the crate along +x
    for (let i = 0; i < 90; i++) {
      p.movePlayer({ x: -1 + i * 0.06, y: 0, z: 0 }, null);
      p.step(1 / 60);
    }
    expect(crate.position.x).toBeGreaterThan(2.5);
    const ray = new THREE.Raycaster(new THREE.Vector3(crate.position.x, 10, crate.position.z), new THREE.Vector3(0, -1, 0));
    expect(select.pick(ray)).toMatchObject({ kind: 'crate', id: 'c1' });
    expect(tweaks.defs.has('Physics / Show colliders')).toBe(true);
    p.showColliders(true);
    expect(scene.children.some((c) => c.isLineSegments)).toBe(true);
  });

  it('drives InstancedMesh instances', async () => {
    const p = await createPhysics();
    p.addStatic([-10, -1, -10, 10, 0, 10]);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
    const m = new THREE.Matrix4();
    inst.setMatrixAt(0, m.makeTranslation(-2, 4, 0));
    inst.setMatrixAt(1, m.makeTranslation(2, 6, 0));
    p.addBody(inst, { index: 0 });
    p.addBody(inst, { index: 1 });
    run(p, 3);
    const pos = new THREE.Vector3();
    inst.getMatrixAt(1, m);
    pos.setFromMatrixPosition(m);
    expect(pos.y).toBeCloseTo(0.5, 1);
    expect(pos.x).toBeCloseTo(2, 1);
  });
});
