# World Studio engine API

Every game in `games/<slug>/` runs on this engine. The engine owns the renderer, the sky and day/night cycle, the player (walk, fly, drive), input, the HUD, audio, build mode, and hot reload. A game supplies the world and its rules.

Games import engine code with relative paths, for example `import { defineGame, CollisionGrid } from '../../engine/index.js'`. Three.js is imported directly: `import * as THREE from 'three'`.

## The game contract

`games/<slug>/game.js` default-exports `defineGame({ title, controls?, setup })`.

```js
import * as THREE from 'three';
import { defineGame, CollisionGrid } from '../../engine/index.js';

export default defineGame({
  title: 'My game',
  controls: [['E', 'interact']], // extra rows for the start menu

  async setup(ctx) {
    const grid = new CollisionGrid(32);
    // ... build meshes into ctx.scene, register colliders, tweaks and selectables ...
    return {
      world: { grid, groundY: (x, z) => 0, spawn: { x: 0, z: 0, yaw: 0, pitch: 0 }, limit: 500 },
      update(dt, t, ctx) {},
    };
  },
});
```

`game.json` next to it holds `{ name, template, description, created, updated }`. The harness manages it; you may edit `name` and `description`.

### What `setup(ctx)` receives

| field | what it is |
|---|---|
| `scene`, `camera`, `renderer` | Three.js objects. Add meshes to `scene`. Don't move `camera` yourself; the player and build mode own it. |
| `env` | Sky, sun and moon, fog, day/night (`engine/world/environment.js`). `env.time` is hours 0–24, `env.dayLength` is seconds per day, `env.night` is 0–1, and `env.light` is the shadow-casting sun. |
| `textures` | Base canvas textures: `pool` (soft radial glow), `beam` (vertical fade), `waterNormal`, `grid` (ground grid). Helpers for making your own are in `engine/world/textures.js` (`mk`, `toTex`, `grain`, `blotches`, `radial`). |
| `hud` | `toast(html)`, `setObjective({ label, value, total, sub })`, `setMap({ image, half, markers })`, `modal({ kicker, title, html, button, onClose })`, `hint(text)`. |
| `audio` | `pickup()`, `win()`, `horn()`, `crash(v)`, `step()`, `door()`, `tone(freq, start, dur, vol, type)`, `noise(dur, freq, type, vol)`. |
| `tweaks` | Live tweak panel in build mode (see below). |
| `select` | Point-and-prompt registry (see below). |
| `rng` | Seeded `{ rand, rr(a, b), ri(a, b), pick(arr) }`, unique per game. Use it (or your own `createRng(seed)`) instead of `Math.random()` for world generation, so the world is the same on every reload. |
| `input` | `has(code)`, `any(...codes)`, `onPress(fn(code))`. Codes are `KeyboardEvent.code` values. |
| `player` | Set **after** `setup` returns. Read it inside `update` via `ctx.player`. |
| `slug`, `meta` | The project folder name and its `game.json`. |
| `mode`, `started` | `'menu' | 'play' | 'build' | 'paused' | 'map'`, updated every frame. |

### What `setup` returns

| field | required | purpose |
|---|---|---|
| `world.grid` | yes | A `CollisionGrid` of axis-aligned boxes `{ x0, x1, z0, z1, h }`. The player collides with any box taller than its feet. Add `tiers: [{ x0, x1, z0, z1, h }, ...]` for stepped shapes you can land on. |
| `world.groundY(x, z)` | yes | Ground height at a point. The player stands on max(groundY, any box top it lands on). |
| `world.spawn` | yes | `{ x, z, yaw?, pitch? }` |
| `world.limit` | no | The player is clamped to `|x|, |z| <= limit`. |
| `update(dt, t, ctx)` | no | Called every frame while the world runs. It isn't called while paused, on the map, or in build mode with Freeze world on. `t` is simulated seconds. |
| `onNight(n, t, ctx)` | no | Called every frame with night 0–1 (for lights, windows, emissives). |
| `snapshot(ctx)` / `restore(s, ctx)` | no | Game state to keep across hot reloads (score, collected items, timers). Return plain JSON. |
| `vehicles` | no | Enables E-to-drive: `{ nearest(x, z, r), pushCircle(p, r), collideCar(car, out) }`. See `games/meridian-city/vehicles.js`. |
| `attract(camera, t)` | no | Camera motion behind the start menu. |
| `prompt(ctx)` | no | Return HTML for the bottom prompt line (e.g. `'<kbd>E</kbd> open door'`). |
| `onKey(code, ctx)` | no | Key presses in play mode. |

## Build-mode hooks

### Tweaks: live values without reloading

```js
ctx.tweaks.add('Traffic / Car speed ×', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (vehicles.speedScale = v) });
ctx.tweaks.add('Sky / Cloud color', { value: '#ffffff', onChange: (v) => mat.color.set(v) });
ctx.tweaks.add('Debug / Show colliders', { value: false, onChange: (v) => (helpers.visible = v) });
```

- The key `"Group / Name"` places the tweak under Group.
- The type comes from `value`: a number gives a slider, `'#rrggbb'` gives a color, a boolean gives a checkbox, and a string with `options: [...]` gives a select.
- `onChange` is called right away with the starting value (the saved one if `tweaks.json` has it) and again on every change. So write it to apply the value, not to animate towards it.
- Anything a user might want to tune (speeds, sizes, colors, counts, intensities) should be a tweak.
- Values that need a rebuild can still be tweaks: rebuild inside `onChange`, or read the value in `setup` and tell the user to save and reload.
- `save: false` keeps a tweak out of `tweaks.json`.
- The panel shows the game's tweaks first. The engine's own World and Player tweaks sit under a collapsed "Engine settings" group; time of day is in the build-mode top bar, not the panel.
- The user saves tweaks with the panel's Save button, into `games/<slug>/tweaks.json`. Don't hand-edit that file unless asked.

### Select: point-and-prompt

```js
ctx.select.add({ kind: 'bridge', id: 'north', box: [x0, y0, z0, x1, y1, z1], props: { length: 40 }, source: `games/${ctx.slug}/bridges.js → buildBridge()` });
ctx.select.addProvider(() => enemies.map((e) => ({ kind: 'enemy', id: e.id, props: { hp: e.hp }, getBox: () => [e.x - 1, 0, e.z - 1, e.x + 1, 2, e.z + 1] })));
```

- Picking is a ray against these boxes, so it works for merged and instanced geometry.
- `source` tells Claude where the object comes from when the user prompts about it. Keep it accurate.
- Register every new kind of object you add.

## Engine helpers (`engine/index.js`)

- `GeoBuilder` (`engine/core/geo.js`): merges boxes and quads into one BufferGeometry (`box(x0, x1, y0, y1, z0, z1, { col, tw, th, uo, vo, top, topScale })`, `top(...)`, `build()`). Use it for large amounts of static geometry; one mesh per chunk keeps draw calls low.
- `CollisionGrid`, `resolveCircle` (`engine/core/collision.js`).
- `createRng(seed)`, `mulberry32`, `hashString` (`engine/core/rng.js`).
- `clamp`, `lerp`, `mod`, `smoothstep` (`engine/core/math.js`).
- `hazeFog(material, scale)`: thinner fog for distant scenery.
- `buildMountains(scene)`: a ring of mountains 2.1–5.6 km out (`engine/world/scenery.js`).
- `textures.*`: the canvas texture helpers.

For performance, prefer `InstancedMesh` for many copies of the same thing, merged geometry for static structures, and canvas textures over image files (games ship no asset files).

## Rules of the road

- A game only changes files in its own folder. `engine/` changes need Engine mode and affect every game, so keep them backwards compatible.
- Hot reload runs `setup` again from scratch. Put anything that must survive in `snapshot()`/`restore()`.
- Don't use `Math.random()` for world layout; use `ctx.rng`, so reloads rebuild the same world.
- Keep frame work light: `update` runs at 60 FPS, and the engine already spends time on shadows and bloom.
- `window.__game` (`app`, `ctx`, `game`, `player`, `env`, `camera`, `select`, `tweaks`, `build`, `input`, `start`, `setMode`, `state`) is there for debugging and automated tests.
