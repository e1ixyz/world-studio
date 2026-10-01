# World Studio - Handoff

Last updated 2026-09-30.

World Studio is a harness for building browser 3D games with Claude while they run. Every game lives in its own folder under `games/` and runs on one shared Three.js engine in `engine/`. A landing page lists the projects. Inside a game you can play it, or press Tab for build mode, click an object and tell Claude what to change. Claude edits only that game's folder, and the tab reloads in place with your position and progress kept.

Until today (2026-09-30) this repo was a single game, Meridian City. It was restructured into World Studio the same day, and Meridian now lives in `games/meridian-city/` as the first game on the engine contract. Three.js 0.186 and Vite 8, plain JS ES modules, no framework, no asset files. User-facing overview and controls are in [README.md](README.md). The engine contract for games is [engine/API.md](engine/API.md); this file links to it rather than repeating it.

The project is not a git repo. A backup of the pre-restructure project is at `.harness/backup-pre-harness.tar.gz`.

## Current state

Verified in the browser with Playwright on 2026-09-30:

- The landing page lists projects, and the New project dialog works.
- Creating a project from Blank opens it in build mode.
- Meridian plays as before: walking, the HUD objective, 60 FPS headless.
- Tab enters build mode. Clicking a building selects it, and the selection card and selection text are correct.
- Build mode UI redesign (same day): top bar, Properties panel, Claude panel with collapsed steps and a working card were checked in the browser at 1280x720 and 1440x900, including one real prompt and a checkpoint undo view. The pause-menu Resume fix could not be exercised end to end because headless Chromium has no pointer lock.
- Tweak changes apply live, and Save writes `tweaks.json`.
- Screenshot and thumbnail files get written. Test from here works.
- A real prompt on a test project edited only that game's folder, created a checkpoint and reloaded only that project's tab. A second tab open on Meridian did not reload.
- Restore brought the edited file back.
- Delete moved the project to `.harness/trash/`.
- `npx vite build` passes, and `dist/` contains no harness chat code.

Not verified yet:

- A permission denial through the chat UI. In the test the model declined the engine edit on its own, so the denial path never fired. A separate CLI spike did show that edits outside the allowed folder get denied.
- The production build running end to end in a browser.
- Mobile.

Known gaps:

- No automated tests and no lint.
- No mobile or touch controls.
- Meridian: pedestrians don't collide with anything, and cars drive through them.
- Meridian: AI cars can overlap at intersections, and driving has no damage.
- Meridian: the minimap doesn't show the mountains. The minimap is hidden in build mode (`engine/build/build.css:21`).

## Run and verify

```sh
npm install
npm run dev       # vite dev server: landing page, games, harness chat
npm run build     # production build to dist/ (no harness)
npm run preview   # serve dist/
```

- `vite.config.js:8` sets port 5173. If it's taken, Vite picks the next free port, so use the URL the terminal prints.
- `vite.config.js` also sets `appType: 'mpa'` with two inputs, `index.html` (landing) and `play.html` (game runtime), turns the HMR error overlay off so it doesn't cover the chat panel, and keeps `.harness/` out of the file watcher.
- In dev, games open at `/play/<slug>`. The plugin rewrites that URL to `play.html` (`harness/server/plugin.js:456`). In production the landing page links to `play.html?game=<slug>` instead.
- Before calling a change done: `npx vite build` must compile, and the game must load and play in a browser.
- `window.__game` (`engine/runtime.js:398`) exposes `app`, `ctx`, `game`, `player`, `env`, `camera`, `select`, `tweaks`, `build`, `input`, `start(mode)`, `setMode(mode)` and a `state` getter. Playwright uses it to drive and inspect games. `window.__harness` (`engine/runtime.js:399`) carries the slug, the game's metadata and the current selection text for the chat client.

## Layout

```
engine/      shared runtime every game runs on
games/       one folder per project (games/<slug>/)
templates/   starting points copied into games/<slug>/ on create
harness/     dev-only tooling: server plugin, in-game chat, landing page
.harness/    runtime data: chat logs, checkpoints, screenshots, trash (gitignored)
index.html   landing page shell, loads harness/landing/main.js
play.html    game page shell, loads engine/runtime.js
```

### `engine/`

- `runtime.js` - the `play.html` entry. Loads `games/<slug>/game.js`, builds the context, calls the game's `setup(ctx)`, adds the engine's own tweaks, runs Play and Build modes, the main loop, screenshots and thumbnails, and the hot-reload snapshot.
- `index.js` - public exports for games, including `defineGame` (`engine/index.js:10`).
- `API.md` - the game contract. Treat it as authoritative. Claude is told to read it before its first change in a conversation.
- `registry.prod.js` - production-only `import.meta.glob` of every game's `game.js`, `game.json` and `tweaks.json`. See Gotchas for why it's a separate file.
- `core/app.js` - `createApp`: renderer, scene, camera, bloom, the High/Low quality switch (`applyQuality`, `engine/core/app.js:33`) and frame capture for screenshots.
- `core/input.js` - keyboard state shared by play and build mode. It ignores keys typed into text fields.
- `core/rng.js` - `mulberry32`, `hashString`, and `createRng(seed)` (`engine/core/rng.js:21`).
- `core/hotstate.js` - per-slug sessionStorage snapshot for reloads. Snapshots older than 2 minutes are dropped (`engine/core/hotstate.js:2`).
- `core/collision.js` - `CollisionGrid` spatial hash of AABBs, plus `resolveCircle`.
- `core/geo.js` - `GeoBuilder` merges boxes and quads into large BufferGeometries.
- `core/math.js` - `clamp`, `lerp`, `mod`, `smoothstep`.
- `world/environment.js` - Sky shader, sun and moon, hemisphere light, FogExp2, stars, exposure, day/night.
- `world/scenery.js` - `hazeFog()` and `buildMountains()`.
- `world/textures.js` - base canvas textures plus the helpers games use to make their own.
- `player/controller.js` - walk, fly and drive physics, rooftop landing, chase camera. It takes a world `{ grid, groundY, spawn, limit }` from the game.
- `audio/audio.js` - `GameAudio`, Web Audio synthesis.
- `ui/hud.js` - a generic HUD that builds its own DOM: start menu, objective, minimap and big map through `setMap`, toast, modal. `ui/style.css` styles it.
- `build/buildmode.js` - build mode: free camera, hover + click selection with a floating label, top bar, Properties panel (selection card + tweaks), shortcuts sheet, first-run tips. `build/icons.js` holds the icons. `build/selection.js` is the point-and-prompt registry, `build/tweaks.js` the tweak store, `build/build.css` the styles.

### `games/<slug>/`

- `game.js` - default-exports `defineGame({ title, controls?, setup })`.
- `game.json` - `{ name, template, description, created, updated }`. The harness writes it on create, rename and duplicate, and bumps `updated` after every Claude run.
- `tweaks.json` - saved tweak values, written by the Save button in build mode.
- `thumb.jpg` - the landing-page card image, captured by the runtime.
- Any other game code. Games import the engine by relative path, for example `../../engine/index.js`.

`games/meridian-city/` is the original game migrated to the contract. More on it below.

### `templates/`

- `blank/` - an empty 2 km flat plane: one ground mesh, a selectable ground entry and a ground-tint tweak. No scenery or example objects; games add mountains themselves with `buildMountains(scene)` if they want them.
- `meridian-city/` - a copy of Meridian City. It matches `games/meridian-city/` except for `game.json` and the missing `thumb.jpg`.

Templates are copied, never linked. See Gotchas.

### `harness/`

- `server/plugin.js` - the Vite plugin. Dev only (`apply: 'serve'`, `harness/server/plugin.js:444`).
- `client/chat.js`, `client/chat.css` - the in-game chat panel.
- `landing/main.js`, `landing/landing.css` - the landing page. `landing/registry.prod.js` globs every `game.json` for the production landing page.

### `.harness/`

- `projects/<slug>/chat.json` - chat log and Claude session id for each project. Meridian's chat history from before the restructure was migrated here.
- `checkpoints/<slug>/<id>/` - one snapshot per prompt, with `meta.json`.
- `shots/<slug>/` - screenshots attached to prompts.
- `trash/` - deleted projects, named `<slug>-<timestamp>`.
- `backup-pre-harness.tar.gz` - the project as it was before the restructure.

## How a game plugs in

A game's `setup(ctx)` builds its world into `ctx.scene` and returns `{ world, update, ... }`. The engine owns the camera, player, sky, HUD, audio, build mode and reloads. Everything a game receives and can return, plus the tweak and select hooks, is in [engine/API.md](engine/API.md).

The runtime adds its own tweaks after the game's, so the game's show first in the panel (`engine/runtime.js:94`):

- World: time of day, day length, fog density, exposure, bloom.
- Player: walk, sprint, fly and fast fly speeds.

`ctx.rng` is seeded from the project slug (`engine/runtime.js:77`).

## Harness server: `harness/server/plugin.js`

### Projects API

All routes sit under `/__harness`.

- `GET /projects` lists projects, newest edit first, with a thumbnail URL and a `running` flag.
- `POST /projects` creates one from `{ name, template, description }`. It copies `templates/<template>/` into `games/<slug>/` and writes `game.json` (`harness/server/plugin.js:284`). If a description was given, Claude builds it as the project's first prompt.
- `POST /projects/<slug>/rename`, `/duplicate` and `/delete`. Delete moves the folder to `.harness/trash/` and refuses while Claude is working on that project (`harness/server/plugin.js:364`).
- `GET /templates` lists folders in `templates/` that have a `game.js`.
- `POST /shot`, `/thumb` and `/tweaks` take `{ slug, ... }`. They write a screenshot to `.harness/shots/<slug>/`, `thumb.jpg`, or `tweaks.json`.

The server sends two custom HMR events. `harness:projects` tells the landing page to re-render. `harness:reload` tells game tabs to reload (see Reloads).

### Per-project chat

- `GET /chat/<slug>/events` is an SSE stream. It replays the log after `Last-Event-ID` or `?since=`, then streams live.
- `POST /chat/<slug>/prompt` takes `{ text, display, engine }`, and `/stop`, `/reset` and `/restore` round it out. `GET /chat/<slug>/checkpoints` lists checkpoints.
- One Claude job per project at a time. A second prompt gets a 409.
- The log keeps the last 400 items and persists to `.harness/projects/<slug>/chat.json`.

### Claude runs

`run()` (`harness/server/plugin.js:170`) spawns the CLI headless in the project root:

```
claude -p <prompt> --output-format stream-json --verbose --permission-mode default
  --allowedTools Read Glob Grep "Bash(npx vite build:*)" "Edit(games/<slug>/**)" "Write(games/<slug>/**)"
  --append-system-prompt <systemPrompt()>
  [--resume <sessionId>]
```

- "Allow engine edits" adds `Edit(engine/**)` and `Write(engine/**)` for that one prompt (`harness/server/plugin.js:176`).
- `systemPrompt()` (`harness/server/plugin.js:33`) names the game folder, says whether engine edits are allowed, tells Claude to read `engine/API.md`, to expose tweaks and selectables, to keep `snapshot()`/`restore()` current, and not to start servers or tell the user to refresh.
- Each project keeps its own Claude session and resumes it. The chat's New button clears it.
- The child gets `WORLD_STUDIO_AGENT=1` (`harness/server/plugin.js:182`). The user's global `~/.claude/hooks/handoff-stop.mjs` exits early when it's set, so these short runs don't trigger the handoff Stop hook.
- `DEVCHAT_MODEL` adds `--model`, and `DEVCHAT_CLAUDE` sets the CLI path.
- Path-scoped permissions were checked with a CLI spike: edits outside the allowed folder are denied. Denied paths show up in the chat as a status line, "Blocked outside this game: ..." (`harness/server/plugin.js:208`).
- Stop sends SIGTERM. The chat then says "Stopped. Open Checkpoints to undo any partial edits."

### Checkpoints

- Before every prompt, `checkpoint()` (`harness/server/plugin.js:106`) copies `games/<slug>/` (minus `thumb.jpg`), plus `engine/` when engine edits are allowed, into `.harness/checkpoints/<slug>/<id>/` with a `meta.json` holding the prompt, the time and the engine flag.
- It keeps the newest 30 per project (`harness/server/plugin.js:17`).
- `restoreCheckpoint()` (`harness/server/plugin.js:124`) first saves a "Before restoring: ..." checkpoint, so a restore can be undone. It then replaces the game folder (and `engine/` if the checkpoint has it), keeps the current thumbnail and reloads the affected tabs.
- Restore refuses while a job is running.

### Reloads

- The `hotUpdate` hook (`harness/server/plugin.js:469`) takes over reloads for code files in `games/` and `engine/` (`.js`, `.mjs`, `.json`, `.html`, `.glsl`, `.frag`, `.vert`) and returns `[]`, so Vite does no reload of its own.
- A changed file in `games/<slug>/` queues a reload for that slug. A changed file in `engine/` queues one for every tab.
- While any Claude job runs, in any project, queued reloads wait. When the last job ends, `flush()` (`harness/server/plugin.js:152`) invalidates the changed modules, logs a reload line in the chat and sends one `harness:reload` with `{ slugs: [...] }` or `{ all: true }`. With no job running, a change flushes after a 180 ms debounce.
- The runtime checks the slug and reloads only matching tabs (`engine/runtime.js:390`).
- `game.json`, `tweaks.json` and `thumb.jpg` never reload a game. A `game.json` change only refreshes the landing page.

### Security

- Requests must come from a loopback address (`harness/server/plugin.js:327`).
- POSTs need the header `X-Devchat: 1` and an `Origin` whose host matches `Host` (`harness/server/plugin.js:332`). This blocks cross-site requests.
- The Vite config has no `host: true`, so the dev server isn't reachable from the LAN. Keep it that way: the chat can edit files.

### Cost

Each prompt is a real Claude Code run billed to the user's account. A tiny edit on the old single-game setup cost about $0.37. The chat shows the run time in its "Done" line. The cost is saved on the `done` item in `chat.json` but not shown.

## Chat client: `harness/client/chat.js`

- `transformIndexHtml` injects it only into play pages, with `head-prepend` (`harness/server/plugin.js:463`). It loads before the game and keeps working when the game crashes.
- Backtick toggles the Claude panel. The "Claude" tab on the right edge does too. The panel has Chat and Checkpoints tabs and a ⋯ menu.
- Enter in play or build mode opens a one-line quick prompt bar and keeps pointer lock.
- A status pill in the bottom-left shows progress while the panel is closed.
- The panel opens by itself when you enter build mode and closes when you leave (`engine/runtime.js:151`, `engine/runtime.js:163`).
- Chips above the text box show what goes with the prompt:
  - the "Camera view" / "My position" toggle (on by default), which prepends `[Game context: ...]`. In build mode it describes the free camera, otherwise the player;
  - the current build-mode selection (dismissable with ×);
  - a screenshot ("Attach view", or K in build mode);
  - "Engine edits: all games" when armed.
- "Allow engine edits" in the ⋯ menu allows engine edits for the next prompt only, and turns itself off after each send.
- Each turn's tool calls collapse into one "N steps" row. Earlier messages in a turn are dimmed as progress notes. While Claude works, a card above the composer shows the latest step, the elapsed time and Stop, and Send is disabled.
- The Checkpoints tab has "Undo last prompt", then every checkpoint newest first, each with Restore.
- An empty chat shows three example prompts; one adapts to the selected object's kind.
- Window errors, unhandled rejections, failed script loads and `vite:error` show as error cards with an "Ask Claude to fix" button, and the panel opens by itself (`harness/client/chat.js:415`).
- Game controls pause only while a chat text box has focus. The client dispatches `devchat:focus` / `devchat:blur`, and the runtime and `Input` drop held keys.

## Landing page: `harness/landing/main.js`

- Project cards with thumbnails, the template name and "edited ... ago". Clicking a card opens the game at its start menu.
- The New project dialog takes a name, a template, and an optional description. Claude builds the description as the first prompt, and the new project opens in build mode.
- Each card has Build (opens with `?build=1`), Duplicate, Rename and Delete.
- It re-renders on `harness:projects` and once a minute.
- In production there's no New project button and no card actions. The list comes from `harness/landing/registry.prod.js`.

## Build mode: `engine/build/buildmode.js`

- Tab toggles between play and build. The start menu has Play and Build mode buttons, and `?build=1` opens straight into build mode (`engine/runtime.js:409`).
- Free camera, separate from the player: right-drag looks, WASD moves, Q/E go down/up, Shift is fast, the wheel changes speed.
- Layout: a top bar, a Properties panel on the left (collapsible to a small button) and the Claude panel on the right. Shared colors, buttons and sizes are in `engine/ui/tokens.css`; icons are inline SVG in `engine/build/icons.js`. Cyan marks actions and active state, yellow marks the selection only, coral marks errors and engine edits.
- Top bar: "Projects" link, project name, a Play | Build switch, a time-of-day slider, "Pause world" / "Resume world", "Attach view" (K), "Test from here" (P) and a shortcuts button. Labels drop to icons on narrower windows.
- Pause is on by default in build mode. It pauses `game.update` and the clock.
- Hovering outlines what's clickable. Click selects. Picking is a ray against the boxes games register with `ctx.select`, so it works on merged and instanced geometry. The selection gets a yellow box and a floating label with an "Ask Claude" button.
- Properties: the selection card shows kind, id, 2-3 key props and size, with "More details" (position, remaining props, source file), "Ask Claude about this" (focuses the prompt with the selection attached), Frame (F) and Deselect (Esc).
- Tweaks sit below the selection card: a filter box, the game's groups open, and the engine's World/Player tweaks folded under "Engine settings". A footer shows "N unsaved changes" with Discard and Save (writes `games/<slug>/tweaks.json`). Changed rows show a reset button.
- A bottom hint lists the camera keys, and "Shortcuts" opens a key reference. A three-step tip card shows the first time you enter build mode (remembered in localStorage).
- Test from here (P) drops the player at the camera, flying if the camera is more than 4 m up.
- The runtime sends a thumbnail 4 s after start, when you leave build mode, and every 3 minutes while playing (`engine/runtime.js:280`).
- In a production build Save is disabled and Attach view downloads a JPEG instead.

## Hot reload

- On `harness:reload` (and on Vite's own `vite:beforeFullReload`), the runtime saves a snapshot to sessionStorage (`engine/runtime.js:349`): mode, Freeze, time of day, quality, player position/yaw/pitch/flying, the car if driving, the build camera pose and `game.snapshot()`.
- On boot it restores a snapshot younger than 2 minutes, puts you back in the car if you were driving, returns you to play or build mode and toasts "Changes applied" (`engine/runtime.js:384`).
- Audio waits for the next click or keypress, since browsers need a gesture.

## Meridian City: `games/meridian-city/`

A procedurally generated island city you walk, drive and fly through while collecting 40 data cores.

- City: 19x19 blocks, 64 m blocks, 16 m roads, about 1.5 km across (`games/meridian-city/config.js:2`). Block types are city, park and plaza. Downtown skyscrapers have tiered setbacks, parks have ponds, and the central plaza holds a 360 m landmark tower. Neon signs, rooftop clutter, street lamps and trees.
- Edges: a promenade and seawall, ocean around the island, and the engine's ring of mountains 2.1-5.6 km out (`engine/world/scenery.js:70`).
- Traffic: about 420 AI cars on a road-node graph with bezier turns, plus parked cars. AI cars stop for obstacles and the player, honk when blocked, and ghost through whatever is in the way after 7 s stuck (`games/meridian-city/vehicles.js:216`).
- Pedestrians: about 900, looping around sidewalks.
- Sky and light (engine): a day lasts 12 real minutes (`engine/world/environment.js:18`). The PMREM environment map regenerates every 5 game-seconds (`engine/world/environment.js:142`).
- Game: 40 cores with beams visible from afar, a timer, a win screen. Cars can be entered with E. Rotating minimap plus a full map.
- Textures are canvas-generated and audio is synthesized. There are no asset files.
- Files: `city.js` (`buildCity()`), `vehicles.js`, `peds.js`, `cores.js`, `map.js` (minimap image), `textures.js` (facade atlases and city textures), `config.js`, `rng.js`, and `game.js`, which wires it all to the contract.
- Tweaks (`games/meridian-city/game.js:77`): car speed, pedestrian speed, window glow at night, core beam opacity and beam color.
- Selectables: buildings, the landmark tower, city blocks, parks and the plaza, cars (traffic, parked, yours), pedestrians and uncollected cores.
- `snapshot()`/`restore()` keep elapsed time, the finished flag and collected cores.

## Controls

Play mode: WASD/arrows move or drive. Mouse looks (pointer lock, with drag-to-look as a fallback). Shift sprints, boosts or flies faster. Space jumps, flies up or pulls the handbrake. C flies down. E enters or exits a car (exit only below 7 m/s, `engine/player/controller.js:326`). F toggles flight, H honks, M opens the map, T held fast-forwards time, N jumps between day and night, G switches quality, Esc pauses, Tab opens build mode.

Build mode: right-drag looks, WASD moves, Q/E down/up, Shift fast, wheel changes speed, click selects, F frames the selection, Esc deselects (or closes the shortcuts sheet), K attaches the view to the next prompt, P tests from here, Enter focuses the prompt, Tab goes back to play. N and G work here too.

Dev server only: Enter opens the quick prompt bar, backtick toggles the chat panel.

## Gotchas

- Engine CSS edits go through Vite's normal CSS HMR. The harness doesn't intercept them (`harness/server/plugin.js:476`).
- Editing `harness/server/plugin.js` or `vite.config.js` restarts the Vite server. Open tabs reload through Vite's own reconnect, with no snapshot guarantee. The chat shows "dev server offline" for a moment.
- Editing `templates/` never reloads anything. Templates are copied only when a project is created, so changing a template doesn't change existing games.
- `games/<slug>/game.json`, `tweaks.json` and `thumb.jpg` changes never reload a game.
- One Claude job per project at a time. While any job runs, in any project, all pending reloads wait until it finishes.
- Production-only globs live in the `registry.prod.js` files and load through dynamic `import()`, so the dev server never watches them. A static glob made every project creation reload every tab.
- Per-game RNG: Meridian uses its own `games/meridian-city/rng.js`, seeded 20260930 (`games/meridian-city/rng.js:4`). Changing the order of `rand()` calls regenerates a different city. It also breaks reload restore of collected cores, which are matched by position within 1 m (`games/meridian-city/game.js:154`).
- `ctx.rng` is seeded from the slug, so a duplicated project using `ctx.rng` generates a different world from the original. Meridian's own RNG sidesteps this.
- Esc while pointer-locked always releases the lock. That's browser behavior; click the game to re-lock.
- Ctrl is deliberately unbound, because Ctrl+W closes the tab.
- In the quick prompt bar a typed backtick is sent as text (a lone "`" once went out as a prompt). The panel textarea closes on backtick only when empty.
- three 0.186 removed `PCFSoftShadowMap`, so the renderer uses `PCFShadowMap`. `THREE.Clock` is deprecated; the loop uses `performance.now()`.
- Building collider rects carry `tiers` for flight and rooftop landing (`games/meridian-city/city.js:119`). The player controller reads them; cars use only the base footprint.
- `package.json` still has `"name": "meridian-city"`.
- Moved folder: the project moved from `~/Desktop/3d-city-site` to `~/Developer/Personal Projects/3d-city-site`. The Desktop folder holds only a `.vite` cache and is safe to delete. Run the dev server from the new path.
