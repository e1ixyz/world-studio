import * as THREE from 'three';
import { defineGame, CollisionGrid } from '../../engine/index.js';

// A flat plane to build on. Nothing else: sky, light and the player come from the engine.
// See engine/API.md for adding colliders (world.grid), clickable objects (ctx.select) and live tweaks (ctx.tweaks).
const SIZE = 2000; // ground is SIZE x SIZE meters, centered on 0,0

export default defineGame({
  title: 'Blank world',

  async setup(ctx) {
    const { scene, textures, tweaks, select, slug } = ctx;

    textures.grid.repeat.set(SIZE / 8, SIZE / 8);
    const groundMat = new THREE.MeshStandardMaterial({ map: textures.grid, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    select.add({ kind: 'ground', box: [-SIZE / 2, -0.1, -SIZE / 2, SIZE / 2, 0, SIZE / 2], props: { size: SIZE }, source: `games/${slug}/game.js → setup()` });
    tweaks.add('Ground / Tint', { value: '#ffffff', onChange: (v) => groundMat.color.set(v) });

    return {
      world: {
        grid: new CollisionGrid(32),
        groundY: () => 0,
        spawn: { x: 0, z: 0, yaw: 0, pitch: 0 },
        limit: SIZE / 2 - 2,
      },
    };
  },
});
