import * as THREE from 'three';
import { CollisionGrid, defineGame, text } from '../../engine/index.js';

// A physics sandbox: ramps, a seesaw, crate towers to knock down and balls to throw (R).
// It shows the engine's physics helper (engine/API.md, "Physics"): static colliders, bodies whose
// meshes follow them, a joint through the raw Rapier world, contacts, and groundY from physics so
// the player walks up the ramps and onto the crates.
const SIZE = 400;
const BALLS = 40; // the oldest ball goes when you throw more

export default defineGame({
  title: 'Physics Playground',
  controls: [['R', 'throw a ball'], ['Walk into things', 'push them']],

  async setup(ctx) {
    const { scene, textures, tweaks, select, slug, hud, audio, camera } = ctx;
    const physics = await ctx.physics({ gravity: -9.81 });
    const { RAPIER, world } = physics;
    const src = (fn) => `games/${slug}/game.js → ${fn}`;

    // ---------- ground ----------
    textures.grid.repeat.set(SIZE / 8, SIZE / 8);
    const groundMat = new THREE.MeshStandardMaterial({ map: textures.grid, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    physics.addStatic([-SIZE / 2, -1, -SIZE / 2, SIZE / 2, 0, SIZE / 2], { friction: 0.9 });
    select.add({ kind: 'ground', box: [-SIZE / 2, -0.1, -SIZE / 2, SIZE / 2, 0, SIZE / 2], source: src('setup()') });

    const solid = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const place = (mesh) => {
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };

    // ---------- ramps (static boxes, tilted) ----------
    for (const [x, z, rot, len] of [
      [-18, -10, 0.28, 16],
      [14, -22, -0.22, 20],
    ]) {
      const ramp = place(new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 6), solid('#7d8fa3')));
      ramp.position.set(x, Math.sin(Math.abs(rot)) * len * 0.5, z);
      ramp.rotation.z = rot;
      ramp.updateMatrixWorld();
      physics.addStatic(ramp, { shape: 'box', friction: 0.8 });
      select.add({ kind: 'ramp', box: new THREE.Box3().setFromObject(ramp), props: { length: len }, source: src('ramps') });
    }

    // ---------- seesaw: a fixed pivot and a plank on a revolute joint ----------
    const pivot = place(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 3), solid('#5b6675')));
    pivot.position.set(0, 0.6, -30);
    pivot.updateMatrixWorld();
    physics.addStatic(pivot, { shape: 'box' });
    const plank = place(new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 2.4), solid('#c98b4f')));
    plank.position.set(0, 1.35, -30);
    const plankBody = physics.addBody(plank, { mass: 8, kind: 'seesaw', source: src('seesaw') });
    const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.35, -30));
    world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), anchor, plankBody, true);

    // ---------- crate towers ----------
    const crateGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const crateMat = solid('#d9a441');
    const crates = [];
    const towers = [
      [-6, -14, 6],
      [-2, -14, 5],
      [2, -14, 7],
      [8, -8, 4],
    ];
    for (const [x, z, height] of towers) {
      for (let i = 0; i < height; i++) {
        const crate = place(new THREE.Mesh(crateGeo, crateMat));
        crate.position.set(x + (i % 2) * 0.05, 0.6 + i * 1.21, z);
        const body = physics.addBody(crate, { mass: 1.5, friction: 0.7, kind: 'crate', id: crates.length, source: src('crate towers') });
        crates.push({ body, start: crate.position.clone() });
      }
    }

    // a sign over the towers
    const sign = text('Knock them over', { size: 1.6, color: '#ffffff', outlineWidth: 0.04, outlineColor: '#1a2433' });
    sign.position.set(0, 10, -14);
    scene.add(sign);

    // ---------- throwing balls ----------
    const ballGeo = new THREE.SphereGeometry(0.35, 20, 14);
    const ballMat = solid('#3cb4ff');
    const balls = [];
    let throwSpeed = 24;
    let bounce = 0.5;
    function throwBall() {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const ball = place(new THREE.Mesh(ballGeo, ballMat));
      ball.position.copy(camera.position).addScaledVector(dir, 1.2);
      const body = physics.addBody(ball, { shape: 'ball', mass: 0.6, restitution: bounce, ccd: true, velocity: dir.multiplyScalar(throwSpeed), kind: 'ball', source: src('throwBall()') });
      physics.onContact(body, (other, started) => started && other && audio.step?.(0.4));
      balls.push({ body, mesh: ball });
      if (balls.length > BALLS) {
        const old = balls.shift();
        physics.remove(old.body);
        old.mesh.removeFromParent();
      }
    }

    // ---------- tweaks ----------
    tweaks.add('Physics / Gravity', { value: 9.81, min: 0, max: 30, step: 0.1, onChange: (v) => (world.gravity = { x: 0, y: -v, z: 0 }) });
    tweaks.add('Throwing / Ball speed', { value: throwSpeed, min: 5, max: 60, step: 1, onChange: (v) => (throwSpeed = v) });
    tweaks.add('Throwing / Bounciness', { value: bounce, min: 0, max: 1, step: 0.05, onChange: (v) => (bounce = v) });
    tweaks.add('Ground / Tint', { value: '#ffffff', onChange: (v) => groundMat.color.set(v) });

    // ---------- objective: crates knocked down ----------
    const knocked = () => crates.filter((c) => c.body.translation().y < c.start.y - 0.8).length;
    let best = 0;

    return {
      world: {
        grid: new CollisionGrid(32),
        // stand on whatever physics has under you: ground, ramps, crates
        groundY: (x, z) => physics.groundY(x, z, 0, 40),
        spawn: { x: 0, z: 8, yaw: 0, pitch: -0.1 },
        limit: SIZE / 2 - 2,
      },
      update() {
        const n = knocked();
        best = Math.max(best, n);
        hud.setObjective({ label: 'Crates down', value: n, total: crates.length, sub: 'R throws a ball · walk into things to push' });
      },
      onKey(code) {
        if (code === 'KeyR') throwBall();
      },
      snapshot: () => ({ best }),
      restore(s) {
        best = s?.best ?? 0;
      },
    };
  },
});
