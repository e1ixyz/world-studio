// Types for the game contract (engine/API.md). Games are plain JavaScript; these types are what
// the studio's check_game tool and editors use to catch mistakes (a misspelled ctx field, a
// missing world.spawn, a tweak with the wrong value type). The engine's own classes are typed
// from their JavaScript source.
import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { GameAudio } from './audio/audio.js';
import type { Selection } from './build/selection.js';
import type { Tweaks } from './build/tweaks.js';
import type { CollisionGrid } from './core/collision.js';
import type { Input } from './core/input.js';
import type { createRng } from './core/rng.js';
import type { Player } from './player/controller.js';
import type { HUD } from './ui/hud.js';
import type { Environment } from './world/environment.js';
import type { makeBaseTextures } from './world/textures.js';

export type Mode = 'menu' | 'play' | 'build' | 'paused' | 'map';

export interface GameMeta {
  name?: string;
  template?: string;
  description?: string;
  created?: number;
  updated?: number;
}

/** What setup(ctx) receives. `player` is set after setup returns. */
export interface GameContext {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  app: ReturnType<typeof import('./core/app.js').createApp>;
  env: Environment;
  audio: GameAudio;
  hud: HUD;
  tweaks: Tweaks;
  select: Selection;
  textures: ReturnType<typeof makeBaseTextures>;
  input: Input;
  rng: ReturnType<typeof createRng>;
  slug: string;
  meta: GameMeta;
  player: Player | null;
  mode: Mode;
  started: boolean;
  /** Rigid-body physics (Rapier), loaded on first call. One world per game; later calls return it. */
  physics(opts?: { gravity?: number }): Promise<Physics>;
}

type Vec3 = { x: number; y: number; z: number };
type BoxArray = [number, number, number, number, number, number];

export interface ColliderOptions {
  friction?: number;
  restitution?: number;
  density?: number;
  mass?: number;
  /** Detects contact (onContact) without pushing back. */
  sensor?: boolean;
}

export interface BodyOptions extends ColliderOptions {
  /** Collider shape from the mesh's geometry. Default 'box'. */
  shape?: 'box' | 'ball' | 'capsule' | 'hull';
  /** Moved by the game (setNextKinematicTranslation), pushes dynamic bodies, isn't pushed. */
  kinematic?: boolean;
  /** For an InstancedMesh: which instance this body drives. */
  index?: number;
  velocity?: Vec3;
  angularVelocity?: Vec3;
  /** Continuous collision detection, for fast small bodies (thrown balls). */
  ccd?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  /** Build mode: the selection's kind (default 'body'), id and source file. */
  kind?: string;
  id?: string | number;
  source?: string;
  /** false keeps it out of build mode's picking. */
  select?: boolean;
}

export interface RayHit {
  point: THREE.Vector3;
  distance: number;
  body: RAPIER.RigidBody | null;
  mesh: THREE.Object3D | null;
}

export interface Physics {
  /** The Rapier module and world, for joints, character and vehicle controllers, and anything else. */
  RAPIER: typeof RAPIER;
  world: RAPIER.World;
  /** A fixed collider: a mesh (shape 'trimesh' by default, or 'box' | 'hull') or a box [x0, y0, z0, x1, y1, z1]. */
  addStatic(target: THREE.Mesh | BoxArray, opts?: ColliderOptions & { shape?: 'trimesh' | 'box' | 'hull'; index?: number }): RAPIER.Collider;
  /** Terrain: (rows + 1) * (cols + 1) heights, row-major, scaled to `size` meters. */
  addHeightfield(rows: number, cols: number, heights: ArrayLike<number>, opts?: ColliderOptions & { size?: Vec3; center?: Vec3 }): RAPIER.Collider;
  /** A moving body; its mesh (a direct child of the scene) follows it after every step. */
  addBody(mesh: THREE.Mesh | THREE.InstancedMesh, opts?: BodyOptions): RAPIER.RigidBody;
  /** Called when the body starts (started = true) or stops touching another collider. */
  onContact(body: RAPIER.RigidBody, fn: (other: RAPIER.RigidBody | null, started: boolean) => void): void;
  raycast(origin: Vec3, dir: Vec3, maxDist?: number): RayHit | null;
  /** Height of the first surface below a point: use it for world.groundY so the player walks on colliders. */
  groundY(x: number, z: number, fallback?: number, top?: number): number;
  remove(body: RAPIER.RigidBody): void;
  showColliders(on: boolean): void;
  readonly bodies: RAPIER.RigidBody[];
  meshOf(body: RAPIER.RigidBody): THREE.Object3D | null;
}

/** A collider box. `h` is its height; `tiers` are stepped shapes the player can land on. */
export interface ColliderBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h?: number;
  tiers?: { x0: number; x1: number; z0: number; z1: number; h: number }[];
  [extra: string]: unknown;
}

export interface World {
  grid: CollisionGrid;
  groundY(x: number, z: number): number;
  spawn: { x: number; z: number; yaw?: number; pitch?: number };
  limit?: number;
}

export interface Vehicles {
  nearest(x: number, z: number, r: number): any;
  pushCircle(p: { x: number; z: number }, r: number): void;
  collideCar(car: any, out: any): any;
  [extra: string]: unknown;
}

/** What setup(ctx) returns. Only `world` is required. */
export interface SetupResult {
  world: World;
  update?(dt: number, t: number, ctx: GameContext): void;
  onNight?(night: number, t: number, ctx: GameContext): void;
  snapshot?(ctx: GameContext): unknown;
  restore?(state: any, ctx: GameContext): void;
  vehicles?: Vehicles | null;
  attract?(camera: THREE.PerspectiveCamera, t: number): void;
  prompt?(ctx: GameContext): string | null | undefined;
  onKey?(code: string, ctx: GameContext): void;
  [extra: string]: unknown;
}

export interface GameDefinition {
  title: string;
  /** Extra rows for the start menu: [key, label]. */
  controls?: [string, string][];
  setup(ctx: GameContext): SetupResult | Promise<SetupResult>;
}

type TweakBase<V> = { value: V; label?: string; save?: boolean; onChange?: (v: V) => void };
export type TweakDef =
  | (TweakBase<number> & { min?: number; max?: number; step?: number; type?: 'range' })
  | (TweakBase<string> & { type?: 'color' })
  | (TweakBase<string> & { options: string[]; type?: 'select' })
  | (TweakBase<boolean> & { type?: 'bool' });

type Box6 = [number, number, number, number, number, number] | number[] | THREE.Box3;
export interface SelectEntry {
  kind: string;
  id?: string | number;
  box?: Box6;
  getBox?: () => Box6;
  props?: Record<string, unknown>;
  source?: string;
}
