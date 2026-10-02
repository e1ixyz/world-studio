// Public engine API for games. See engine/API.md.
export { GeoBuilder } from './core/geo.js';
export { CollisionGrid, resolveCircle } from './core/collision.js';
export { createRng, mulberry32, hashString } from './core/rng.js';
export { clamp, lerp, mod, smoothstep } from './core/math.js';
export { hazeFog, buildMountains } from './world/scenery.js';
export * as textures from './world/textures.js';
export { text } from './kit/text.js';
export { enableBVH } from './kit/bvh.js';
// Physics: `await ctx.physics()` (it loads Rapier on demand), not an import here.

// A game module default-exports defineGame({ title, controls?, setup(ctx) }).
export function defineGame(def) {
  if (typeof def?.setup !== 'function') throw new Error('defineGame needs a setup(ctx) function');
  return def;
}
