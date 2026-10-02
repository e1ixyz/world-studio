// Types for the game contract (engine/API.md). Games are plain JavaScript; these types are what
// the studio's check_game tool and editors use to catch mistakes (a misspelled ctx field, a
// missing world.spawn, a tweak with the wrong value type). The engine's own classes are typed
// from their JavaScript source.
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
