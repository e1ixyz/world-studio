// Public engine API for games (types). See engine/API.md and engine/types.d.ts.
import type { GameDefinition } from './types.d.ts';
// three-mesh-bvh adds computeBoundsTree() and friends to THREE.BufferGeometry (see enableBVH)
import type {} from 'three-mesh-bvh';

export * from './types.d.ts';
export { GeoBuilder } from './core/geo.js';
export { CollisionGrid, resolveCircle } from './core/collision.js';
export { createRng, mulberry32, hashString } from './core/rng.js';
export { clamp, lerp, mod, smoothstep } from './core/math.js';
export { hazeFog, buildMountains } from './world/scenery.js';
export * as textures from './world/textures.js';

/** Crisp world-space text (troika-three-text). Returns a Mesh; set .text and call .sync() to change it. */
export declare function text(
  str: string,
  opts?: { size?: number; color?: string; font?: string; anchorX?: string | number; anchorY?: string | number; maxWidth?: number; align?: 'left' | 'right' | 'center' | 'justify'; outlineWidth?: number | string; outlineColor?: string; depthTest?: boolean },
): import('three').Mesh & { text: string; sync(cb?: () => void): void; fontSize: number; color: unknown };
/** Turns on three-mesh-bvh: then geometry.computeBoundsTree() makes raycasts against that mesh fast. */
export declare function enableBVH(): void;

/** A game module default-exports defineGame({ title, controls?, setup(ctx) }). */
export declare function defineGame<T extends GameDefinition>(def: T): T;
