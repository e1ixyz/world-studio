// Public engine API for games (types). See engine/API.md and engine/types.d.ts.
import type { GameDefinition } from './types.d.ts';

export * from './types.d.ts';
export { GeoBuilder } from './core/geo.js';
export { CollisionGrid, resolveCircle } from './core/collision.js';
export { createRng, mulberry32, hashString } from './core/rng.js';
export { clamp, lerp, mod, smoothstep } from './core/math.js';
export { hazeFog, buildMountains } from './world/scenery.js';
export * as textures from './world/textures.js';

/** A game module default-exports defineGame({ title, controls?, setup(ctx) }). */
export declare function defineGame<T extends GameDefinition>(def: T): T;
