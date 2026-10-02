# World Studio - Handoff

Last updated 2026-10-02.

World Studio is a harness for building browser 3D games with Claude while they run. Every game lives in its own folder under `games/` and runs on one shared Three.js engine in `engine/`. A landing page lists the projects. Inside a game you can play it, or press Tab for build mode, click an object and tell Claude what to change. Claude edits only that game's folder, and the tab reloads in place with your position and progress kept.

Until today (2026-09-30) this repo was a single game, Meridian City. It was restructured into World Studio the same day, and Meridian now lives in `games/meridian-city/` as the first game on the engine contract. Three.js 0.186 and Vite 8, no asset files. The engine and games are plain JS ES modules (typed through `engine/types.d.ts`); the studio is TypeScript: a bun workspace with one studio daemon (Hono, Vite in middleware mode, PGlite) shared by the browser and the desktop app, a React studio UI with the game in a frame, and the Claude Agent SDK. The re-architecture that got it there (P0-P8) finished on 2026-10-02; see Re-architecture below. User-facing overview and controls are in [README.md](README.md). The engine contract for games is [engine/API.md](engine/API.md); this file links to it rather than repeating it.

The repo is private on GitHub at `e1ixyz/world-studio`. `main` has everything: the re-architecture, the desktop app and the themes were fast-forwarded into it from the `architecture` branch on 2026-10-02. `electron-app` and `architecture` are older working branches. A backup of the pre-restructure project is at `.harness/backup-pre-harness.tar.gz`.

## Current state

Verified in the browser with Playwright on 2026-09-30:

- The landing page lists projects, and the New project dialog works.
- Creating a project from Blank opens it in build mode.
- Meridian plays as before: walking, the HUD objective, 60 FPS headless.
- Tab enters build mode. Clicking a building selects it, and the selection card and selection text are correct.
- Build mode UI redesign (same day): top bar, Properties panel, Ask panel with collapsed steps and a working card were checked in the browser at 1280x720 and 1440x900, including one real prompt and a checkpoint undo view. The pause-menu Resume fix could not be exercised end to end because headless Chromium has no pointer lock.
- Tweak changes apply live, and Save writes `tweaks.json`.
- Screenshot and thumbnail files get written. Test from here works.
- A real prompt on a test project edited only that game's folder, created a checkpoint and reloaded only that project's tab. A second tab open on Meridian did not reload.
- Restore brought the edited file back.
- Delete moved the project to `.harness/trash/`.
- `npx vite build` passes, and `dist/` contains no harness chat code.

Not verified yet:

- Pointer lock and audio inside the game frame, by a person, in both the browser and the app (headless Chromium has no pointer lock).
- A real prompt from the installed app (the SDK runner was verified from a terminal daemon).
- Mobile.

Verified on 2026-10-02 at the end of the re-architecture: `bun run test` (53 unit tests), `bun run typecheck`, `bun run lint` (no errors) and `npx vite build` pass, and `bun run test:e2e` passes on web and Electron (51 tests, 5 single-target skips). Two real Haiku runs went through the SDK runner (an edit with `check_game`, and `view_game`). The production build and an export played from a plain static server.

Verified earlier the same day, after P0-P2: `bun run test` (22 unit tests), `bun run typecheck`, `bun run lint` and `npx vite build` pass. `bun run test:e2e` passes on both targets (web 11, app 9 + 2 web-only skips). By hand: a terminal daemon plus the app from source share one harness (a browser prompt streams into the app's chat, a settings change in the app updates the browser's menu live), quitting the app leaves the terminal daemon up, and an app-started daemon stops on quit and removes its lock. The installed app was rebuilt, found `claude`, started its daemon and served Meridian.

Known gaps:

- Tests cover the harness with the fake agent; nothing exercises a real `claude` run automatically.
- No mobile or touch controls.
- Meridian: pedestrians don't collide with anything, and cars drive through them.
- Meridian: AI cars can overlap at intersections, and driving has no damage.
- Meridian: the minimap doesn't show the mountains. The minimap is hidden in build mode (`engine/build/build.css`).

## Run and verify

```sh
bun install
bun run dev          # the studio daemon: landing page, games, harness chat (or prints the running one's URL)
bun run build        # production build to dist/ (no harness)
bun run preview      # serve dist/
bun run app:install  # macOS app: build, install to ~/Applications, link on Desktop
bun run app          # run the desktop shell from source
bun run test         # Vitest unit tests (test/unit/)
bun run test:e2e     # vite build, then Playwright on web and Electron (e2e/)
bun run typecheck    # TypeScript 7 over packages/*/src
bun run lint         # Biome (games/ and templates/ are excluded)
bun run export <slug>  # one game as a static site in exports/<slug>/
```

- bun is only the package manager (`bunfig.toml` sets the hoisted linker). Everything runs on Node 24, which strips TypeScript types itself, so `packages/` runs from source with no build step. Electron 44's Node (24.21) does the same in a utilityProcess.
- The daemon listens on 5173 or the next free port and writes the real URL to `.harness/daemon.json`. Use that URL, or the one the terminal prints.
- `bun run dev:vite` still starts plain Vite with the harness plugin, without the daemon or its lock. Use it only for debugging.
- `vite.config.js` sets `appType: 'mpa'` with two inputs, `index.html` (landing) and `play.html` (game runtime), turns the HMR error overlay off so it doesn't cover the chat panel, and keeps `.harness/` out of the file watcher.
- In dev, projects open at `/p/<slug>`, the studio shell, with the game framed at `/play/<slug>?embed=1`; `studioPlugin` (`packages/server/src/vite/plugin.ts`) rewrites that to `play.html`, and a bare `/play/<slug>` redirects to the shell. In production the landing page links to `play.html?game=<slug>` instead.
- Before calling a change done: `npx vite build` must compile, and the game must load and play in a browser.
- `window.__game` (`engine/runtime.js:406`) exposes `app`, `ctx`, `game`, `player`, `env`, `camera`, `select`, `tweaks`, `build`, `input`, `start(mode)`, `setMode(mode)` and a `state` getter. Playwright uses it to drive and inspect games. It lives in the game frame: in the shell, use `document.querySelector('iframe').contentWindow.__game`, or in Playwright the frame from `gameFrame(page)` in `e2e/fixtures.js`. `window.__harness` (`engine/runtime.js:407`) carries the slug, the game's metadata and the current selection text for the chat client.

## Studio daemon: `packages/server/`

One Node process per checkout owns the harness: chats, agent jobs, checkpoints and reloads. It serves everything through Vite in middleware mode, using `vite.config.js` and the harness plugin unchanged. The browser and the desktop app are both clients of it, so they share one chat state and one job queue.

- `src/daemon.ts`: `startDaemon({ root, port, strictPort, lock })` makes a Node http server, tries 5173 and up, then mounts Vite with `server: { middlewareMode: true, ws: { server } }`.
  - Before Vite it rejects any `Host` other than localhost, 127.0.0.1 or [::1] (DNS rebinding).
  - It answers `/__harness/health` with `{ app, root, pid, version, startedAt }`.
  - `runDaemonProcess` adds signal handling and reports `ready`, `attached` or `error` to a parent process (an Electron `parentPort` or `process.send`).
- `src/lock.ts`: `.harness/daemon.json` holds `{ app, pid, port, url, root, version, startedAt }`.
  - `claimLock` creates it with an exclusive open.
  - `findDaemon` trusts it only if the pid is alive and the health check returns the same root; otherwise it deletes the lock.
  - The lock goes away on a clean shutdown.
- `src/cli.ts`: `bun run dev`. It starts a daemon, or prints the URL of the one already running and exits.
  - Flags: `--root`, `--port N`, `--strict-port`, and `--no-lock` (a private daemon that ignores the lock; tests use it).
- Shutdown: `vite.close()` runs the plugin's `closeBundle` hook, which stops agent jobs (`stopJobs`). Middleware mode has no `httpServer`, so the old `httpServer` 'close' hook no longer fires there.

## Desktop app: `apps/desktop/`

`bun run app:install` (`apps/desktop/package.mjs`) packages `World Studio.app` with `@electron/packager`, signs it ad hoc, copies it to `~/Applications` and symlinks it onto the Desktop. `bun run app` runs the shell from source. `bun run app:icon` redraws `icon.icns` and `icon.png` from `icon.svg`.

- The app is a thin shell. The bundle holds only `package.json` and `apps/desktop/main.js`.
  - At launch `attachOrSpawn()` reads `.harness/daemon.json` through the checkout's `packages/server/src/lock.ts`.
  - If a daemon is running, the window opens on its URL.
  - Otherwise the app forks `packages/server/src/cli.ts` in an Electron `utilityProcess` and waits for `ready`.
  - Changes to `engine/`, `games/`, `harness/` or `packages/` need no rebuild.
- Quitting stops the daemon only if the app started it: it sends `shutdown` and kills the process after 5 s. A terminal daemon keeps running, and the browser keeps working.
- `WORLD_STUDIO_ISOLATED=1` makes the app start a private daemon on a free port without the lock. The e2e suite uses it.
- The checkout path comes from, in order: `WORLD_STUDIO_ROOT`, `~/Library/Application Support/World Studio/config.json`, `apps/desktop/root.json` (written by the package script, gitignored), then the repo itself when unpackaged.
  - A valid checkout has `vite.config.js`, `packages/server/src/cli.ts` and `node_modules/vite`.
  - If none of these paths qualifies, a folder picker asks and saves the answer to `config.json`.
- Finder launches apps with a bare PATH and none of the shell's exports. `fixPath()` reads the login shell's environment (`$SHELL -ilc 'env -0'`), copies PATH and any `DEVCHAT_*` variables (`SHELL_VARS`), and adds `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`.
  - An app-started daemon inherits that environment, and the resolved `claude` path is written to the log.
  - Any other variable the server reads has to be added to `SHELL_VARS`.
- Logs: `~/Library/Logs/World Studio/main.log` (the main process and an app-started daemon's output).
- Links to other origins open in the default browser. Only one instance runs; opening it again focuses the window.
- The app's localStorage moved with its origin (it used to be port 5199), so build-mode tips and the props-collapsed flag reset once.

- Parity rule: every change has to work in both the browser and the app. `CLAUDE.md` tells Claude to run the project skill `.claude/skills/parity/SKILL.md` before finishing; it lists where the two differ and how to check each side. `bun run test:e2e` covers both. `.claude/skills/parity/scripts/cdp.mjs` drives an app window over DevTools (`npx electron . --remote-debugging-port=9333`). The in-app agent skips it.

## Database: `packages/db/`

Drizzle with a Postgres schema (`src/schema.ts`) and generated migrations (`drizzle/`; after a schema change run `bun run --cwd packages/db generate`). Locally it runs on PGlite, Postgres compiled to WASM, so there's no native module and it works in both system Node and Electron's. The same schema and migrations would serve a hosted Postgres.

- Tables:
  - `conversations`: one per "New conversation"; the active one has `archived_at` null.
  - `chat_items`: the log; `seq` grows per project and never resets.
  - `runs`: one per prompt, with runner, model, duration, `cost_usd`, outcome, denials and the checkpoint id.
  - Every row has `workspace_id` (`'local'`).
- `openDatabase()` migrates on open, in about 0.7 s. The locked daemon uses `.harness/db/` (about 40 MB). Private daemons (`--no-lock`, so tests and an isolated app) use an in-memory database, because only one process may open a PGlite folder.
- `DbChatRepository` (`packages/server/src/domain/db-store.ts`) reads the active conversations once at startup; after that `ChatService` works from memory and every append, session change, reset and run is written in order in the background. `studio.close()` flushes and closes the database (the daemon awaits it on shutdown).
- On first open it imported each `.harness/projects/<slug>/chat.json` (verified 2026-10-02: 127, 73 and 72 items). The files stay as a backup and are no longer written; a project is never imported twice.
- Deleting a project archives its conversation, so a new project with the same slug starts clean while the history stays.
- Not in the database: game code and `game.json` (files the agent edits), `tweaks.json`, settings (`.harness/settings.json`, hand-editable), checkpoints (git).
- Routes: `GET /chat/<slug>/log` is the recent log as JSON, and `GET /chat/<slug>/runs` the recent runs. The "Done" line now shows each run's cost.
- `JsonChatRepository` (the old files) is still there for `createStudio()` without a database (unit tests).

## Exporting a game: `bun run export <slug>`

`scripts/export-game.mjs` builds one game into `exports/<slug>/` (gitignored): `index.html` plus assets, with relative paths and only that game bundled (it narrows the globs in `engine/registry.prod.js`). It sets `VITE_WS_GAME`, so the runtime plays the game with no `?game=` and the start menu hides "All projects". Serve the folder with any static server; Meridian is 0.8 MB. Verified on 2026-10-02 from `python3 -m http.server`.

## Tests: `test/unit/`, `e2e/`

- `test/unit/` (Vitest): rng sequences (Meridian's seed is pinned), collision, GeoBuilder, Tweaks, Selection (including the exact `describe()` text), and the shared zod schemas against the real `.harness/` and `games/` data.
- `e2e/` (Playwright, `playwright.config.js`): one suite, two projects.
  - `web` runs a private daemon on port 5180. `electron` launches the app from source with `WORLD_STUDIO_ISOLATED=1`.
  - Both run the in-process fake agent (`DEVCHAT_RUNNER=fake`, `domain/agent/fake-runner.ts`). Markers in a prompt change what it does: `[slow]`, `[deny]`, `[fail]`, `[noedit]`, `[view]`, `[ask]`, `[reload]`.
  - Tests create throwaway projects from Blank and delete them (they land in `.harness/trash/`).
  - Thumbnail posts are stubbed, so the real games' `thumb.jpg` files stay as they are.
  - The fixtures call the harness API from Node, not from inside the page: a prompt can reload the page before an in-page fetch resolves.
  - They navigate with `waitUntil: 'domcontentloaded'`, because `load` waits on the Google Fonts stylesheet.

## Re-architecture

The plan was approved 2026-10-01 (local-first and cloud-ready, incremental). Every phase keeps the three games and both surfaces working.

- Done: P0 (tests and the fake agent), P1 (bun workspace, `@ws/engine`, `packages/shared` schemas), P2 (one studio daemon, `apps/desktop`), P3 (Hono API and domain modules, replacing `harness/server/plugin.js`), P4 (git checkpoints with diffs), P5 (Agent SDK runner, engine types, `check_game`, `env.setSky()`), P6a (React studio with the landing page), P6b (project shell: game frame, bridge, React Ask panel), P7 (live-game tools, permission cards, build-mode panels in React), P8 (PGlite + Drizzle database for chats and runs, single-game export).
- Not done, on purpose or for later:
  - WebGPU and TSL: the engine and games use EffectComposer bloom, the Sky shader and `onBeforeCompile` GLSL, and models write classic three.js far more reliably. It could come back as a per-game opt-in.
  - Engine internals in TypeScript: games are typed through `engine/types.d.ts` and JSDoc already. Converting the engine would need `.js` entry shims for the games' relative imports.
  - Serving games from a separate sandboxed origin: the bridge is ready for it (no same-window reach-ins, origin checks on both sides).
  - Auth and multi-user: the database carries `workspace_id` and the API's local-only middleware is the place for a `Principal`; nothing else needs a rewrite.
- Open follow-up: `games/meridian-city/game.js` still sets the Sky shader's uniforms directly for its Sky tweaks. That code is in uncommitted work on the game, so it was left alone; switch it to `ctx.env.setSky()`.
- `engine/` stays at the repo root on purpose: games import it by relative path, and the agent's edit rules and old checkpoints use that path.

## Layout

```
engine/      shared runtime every game runs on
games/       one folder per project (games/<slug>/)
templates/   starting points copied into games/<slug>/ on create
packages/    server (studio daemon, API, domain), shared (zod schemas), bridge (studio <-> game frame), db (Drizzle schema, PGlite), theme (the six studio themes)
apps/studio/ React studio UI: landing page, project shell, Ask panel
apps/desktop/ Electron shell for the macOS app
test/unit/   Vitest unit tests;  e2e/  Playwright suite (web + Electron)
scripts/     fake-claude.mjs (stand-in claude CLI for the CLI runner test)
.harness/    runtime data: chat logs, checkpoints, screenshots, trash, daemon.json (gitignored)
index.html   studio shell, loads apps/studio/src/main.tsx
play.html    game page shell, loads engine/runtime.js
CLAUDE.md    project instructions for Claude: run the parity skill before finishing a change
.claude/     project skills (skills/parity: browser and desktop app parity)
```

### `engine/`

- `runtime.js` - the `play.html` entry. Loads `games/<slug>/game.js`, builds the context, calls the game's `setup(ctx)`, adds the engine's own tweaks, runs Play and Build modes, the main loop, screenshots and thumbnails, and the hot-reload snapshot.
- `index.js` - public exports for games, including `defineGame` (`engine/index.js:10`).
- `API.md` - the game contract. Treat it as authoritative. Claude is told to read it before its first change in a conversation.
- `types.d.ts`, `index.d.ts` - types for the contract (`GameContext`, `SetupResult`, `TweakDef`, `SelectEntry`, `defineGame`). The engine's own classes are typed from their JS and JSDoc. `check_game` and editors use them.
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
- `build/buildmode.js` - build mode's in-world half: free camera, hover and click selection, the floating label, and `state()` for the studio's panels. `build/icons.js` holds the icons (the studio uses them too). `build/selection.js` is the point-and-prompt registry, `build/tweaks.js` the tweak store, `build/build.css` the label's styles.

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
- `physics-playground/` - ramps, a seesaw, crate towers and thrown balls on the engine's physics; the pattern for physics games.

Templates are copied, never linked. See Gotchas.

### `.harness/`

- `settings.json` - studio-wide settings: `alwaysEngine` and `theme`. Both the browser dev server and the desktop app read it fresh on every prompt.
- `db/` - the studio database (PGlite): conversations, chat items, runs. See Database.
- `projects/<slug>/chat.json` - the chat logs from before the database, imported into it once and kept as a backup.
- `git/<slug>.git`, `git/engine.git` - checkpoint history (see Checkpoints).
- `checkpoints/<slug>/<id>/` - legacy folder checkpoints from before git history, still listed and restorable.
- `shots/<slug>/` - screenshots attached to prompts.
- `trash/` - deleted projects, as `<slug>-<timestamp>/game` plus `/chat` (delete also drops the in-memory chat, so a new project with the same name starts clean).
- `backup-pre-harness.tar.gz` - the project as it was before the restructure.

## How a game plugs in

A game's `setup(ctx)` builds its world into `ctx.scene` and returns `{ world, update, ... }`. The engine owns the camera, player, sky, HUD, audio, build mode and reloads. Everything a game receives and can return, plus the tweak and select hooks, is in [engine/API.md](engine/API.md).

The runtime adds its own tweaks after the game's, so the game's show first in the panel (`engine/runtime.js:101`):

- World: time of day, day length, fog density, exposure, bloom.
- Player: walk, sprint, fly and fast fly speeds.

`ctx.rng` is seeded from the project slug (`engine/runtime.js:82`).

## Studio server: `packages/server/src/`

The old single-file Vite plugin is gone, replaced by:

- `studio.ts`: `createStudio({ root, runner })` wires the services together.
- `domain/`:
  - `projects.ts`: projects and templates.
  - `chat.ts`: `ChatService`, which owns logs, jobs and subscribers.
  - `chat-store.ts`: `ChatRepository`, JSON-backed.
  - `checkpoints/`: `CheckpointStore`, implemented by `git.ts` (with `fs.ts` for legacy checkpoints and as the fallback).
  - `reloads.ts`: `ReloadCoordinator`.
  - `settings.ts`, `prompts.ts`, `events.ts` (the `StudioEvents` bus) and `paths.ts`.
  - `agent/`: the `AgentRunner` interface and `CliRunner`.
- `app.ts`: the Hono API.
- `middleware/`: `localOnly`, and `body(schema)`, which validates JSON bodies with the zod schemas from `@ws/shared`.
- `vite/plugin.ts`: `studioPlugin(studio)`, the Vite adapter. It mounts the API, serves `/p/<slug>` from the studio app, rewrites `/play/<slug>?embed=1` (and redirects a bare one), injects the bridge agent, feeds `hotUpdate` into the reload coordinator, and forwards studio events as HMR custom events.
- `client.ts`: `studioClient()`, a typed `hono/client` for TS callers. `client.typetest.ts` checks at compile time that it sees the routes and bodies.

`vite.config.js` no longer loads any plugin itself; the daemon adds `studioPlugin` inline.

### Projects API

The same Hono app is served at `/__harness/*`, which the current JS clients call, and at `/api/*`, the typed client's base.

- `GET /projects` lists projects, newest edit first, with a thumbnail URL and a `running` flag.
- `POST /projects` creates one from `{ name, template, description }`. It copies `templates/<template>/` into `games/<slug>/` and writes `game.json` (`Projects.create`). If a description was given, Claude builds it as the project's first prompt.
- `POST /projects/<slug>/rename`, `/duplicate` and `/delete`. Delete moves the folder to `.harness/trash/` and refuses while Claude is working on that project (`ChatService.forget` throws `BusyError`, which the API turns into a 409).
- `GET /templates` lists folders in `templates/` that have a `game.js`.
- `GET /settings` returns the studio settings and `POST /settings` takes `{ alwaysEngine?, theme? }`. It writes `.harness/settings.json` and sends a `harness:settings` HMR event so open tabs on the same server update (`SettingsStore.update` emits `settings` on the event bus).
- `POST /shot`, `/thumb` and `/tweaks` take `{ slug, ... }`. They write a screenshot to `.harness/shots/<slug>/`, `thumb.jpg`, or `tweaks.json`.

The plugin turns studio events into three custom HMR events. `harness:projects` tells the landing page to re-render, `harness:reload` tells game tabs to reload (see Reloads), and `harness:settings` carries the new settings. `GET /api/events` streams the same events, plus `job` (start and stop), as SSE for clients outside Vite's HMR.

Request bodies are checked against the zod schemas in `packages/shared/src/schemas.ts`. Bad JSON gets a 400, an empty body counts as `{}`, and an unknown project gets a 404.

### Per-project chat

- `GET /chat/<slug>/events` is an SSE stream. It replays the log after `Last-Event-ID` or `?since=`, then streams live.
- `POST /chat/<slug>/prompt` takes `{ text, display, engine }`, and `/stop`, `/reset` and `/restore` round it out. `GET /chat/<slug>/checkpoints` lists checkpoints.
- One Claude job per project at a time. A second prompt gets a 409.
- The panel replays the last 400 items. The full log lives in the database (see Database).

### Claude runs

`ChatService.prompt()` checkpoints, logs the prompt and starts an `AgentRunner` (`domain/agent/`). There are two:

- `SdkRunner` (the default) drives Claude Code through `@anthropic-ai/claude-agent-sdk`.
  - It uses the `claude` binary found on PATH (`pathToClaudeCodeExecutable`), so runs use the user's own login and version. Checked 2026-10-02: no API key involved, it reports the Claude Team subscription.
  - It loads every settings source, as the CLI does, so the user's global hooks still apply.
  - It hosts studio tools in-process as `mcp__studio__*`, and Stop goes through an `AbortController`.
- `CliRunner` spawns the CLI with stream-json.
- `DEVCHAT_RUNNER=sdk|cli` picks one. With `DEVCHAT_CLAUDE` set (the tests' fake agent), the default is `cli`.

Both get the same tool rules. The CLI form is:

```
claude -p <prompt> --output-format stream-json --verbose --permission-mode default
  --allowedTools Read Glob Grep "Bash(npx vite build:*)" "Edit(games/<slug>/**)" "Write(games/<slug>/**)"
  --append-system-prompt <systemPrompt()>
  [--resume <sessionId>]
```

- Engine edits add `Edit(engine/**)` and `Write(engine/**)`. A prompt gets them when the client sends `engine: true` ("Allow engine edits", one prompt) or when the `alwaysEngine` setting is on. The server checks the setting itself in `ChatService.prompt()`, so it also covers a new project's first build from the landing page.
- `systemPrompt()` names the game folder, says whether engine edits are allowed, tells Claude to read `engine/API.md`, to expose tweaks and selectables, to keep `snapshot()`/`restore()` current, and not to start servers or tell the user to refresh.
- Each project keeps its own Claude session and resumes it. The chat's New button clears it.
- The child gets `WORLD_STUDIO_AGENT=1` (passed as `env` in `ChatService.prompt()`). The user's global `~/.claude/hooks/handoff-stop.mjs` exits early when it's set, so these short runs don't trigger the handoff Stop hook.
- `DEVCHAT_MODEL` sets the model, and `DEVCHAT_CLAUDE` sets the CLI path.
- `check_game` (SDK runs only; `domain/check-game.ts`) runs TypeScript 7 with checkJs over `games/<slug>/`, against `engine/types.d.ts`, in about 0.1 s.
  - A baseline taken when the prompt starts filters out errors the game already had. Each game has 7–10 inference errors; diagnostics are matched by file, code and message, not by line.
  - The system prompt tells the agent to call it after editing, and the chat shows it as "Check the game for errors".
  - Per-game tsconfigs are written to `.harness/tsconfig/<slug>.json`.
- Live-game tools (SDK runs; `domain/live.ts`, `ChatService.liveTools`):
  - `view_game` returns an image block: a 1024 px JPEG of the game view.
  - `game_state` returns JSON: mode, `[Game context]`, selection, fps, draw calls and triangles, errors since load, and the game's `snapshot()`.
  - `reload_game` flushes this game's pending changes mid-run, waits 1.5 s, then returns `game_state`.
  - The daemon can't see the game. `LiveGames.ask()` emits a `probe` event, which the chat SSE stream sends to every shell open on the project. The shell asks the game over the bridge (`probe` / `probeResult`) and posts the answer to `POST /chat/<slug>/probe/<id>`. The first answer wins; with no window open, the call fails after 5 s (8 s for a screenshot) with a message telling the agent to ask the user to open the project.
  - Verified with a real Haiku run on 2026-10-02: it called `view_game` and described the ground correctly, in 6.2 s for $0.085.
- Permission cards (SDK runs): a tool the harness doesn't allow on its own reaches `canUseTool`, for example an edit outside the game when engine edits are off, or a shell command outside the allowlist. `ChatService.permissionAsker` then posts a `permission` chat item, using the SDK's own `title` when it has one, and the panel opens on a card with Decline and Allow once.
  - `POST /chat/<slug>/permission/<id>` with `{ allow }` answers it, and a second `permission` item with the same id records the answer.
  - No answer within 5 minutes, or Stop, counts as a decline. A declined path is left out of the end-of-run "Blocked edits" note.
  - Deny rules from the user's settings still deny without asking.
- Tests use `FakeRunner` (`DEVCHAT_RUNNER=fake`, in-process). It scripts a run from markers in the prompt: `[slow]`, `[noedit]`, `[deny]`, `[fail]`, `[view]`, `[ask]`, `[reload]`. `scripts/fake-claude.mjs` now backs only `CliRunner`'s own test (`cli-runner.test.ts`).
- One real SDK run was verified on 2026-10-02 (Haiku, throwaway project): Read, Edit, `check_game`, done in 13.6 s for $0.096, then the scoped reload and a checkpoint diff of one file, +1.
- Path-scoped permissions were checked with a CLI spike: edits outside the allowed folder are denied. Denied paths show up in the chat as a status line, "Blocked outside this game: ..." (the `result` callback in `ChatService.prompt()`).
- Stop sends SIGTERM. The chat then says "Stopped. Open Checkpoints to undo any partial edits."

### Checkpoints

Git history, kept out of the user's own repository (`domain/checkpoints/git.ts`, `GitCheckpointStore`):

- Each project has a private repository at `.harness/git/<slug>.git`, whose work tree is `games/<slug>/`. The engine has one at `.harness/git/engine.git` (work tree `engine/`). `thumb.jpg` and `.DS_Store` are excluded.
- Before every prompt, `create()` commits the game, and the engine too when engine edits are allowed. That "before" commit is the checkpoint, and its 12-character sha is the id.
  - Trailers carry `Ws-Kind: checkpoint`, `Ws-Time`, `Ws-Prompt` (JSON) and `Ws-Engine` (the engine commit).
- When the run ends, `ChatService` calls `settle()`, which commits the run's edits as an "after" commit (`Ws-Run: <id>`). This happens before `game.json`'s `updated` stamp is written, so the stamp stays out of the diff.
- `list()` adds `files`, `additions` and `deletions` from the before-to-after diff. The Checkpoints tab shows them ("1 file, +1 −0").
- `GET /chat/<slug>/checkpoints/<id>/diff` returns `{ id, files, patch }`. Engine files get an `engine/` prefix. A run that hasn't settled diffs against the work tree.
- `restore()` first saves a "Before restoring: ..." checkpoint, so the restore can be undone. It then runs `git read-tree -u --reset <id>`, so the game matches the checkpoint exactly (files added since are removed, `thumb.jpg` stays), and commits. History only moves forward. The engine is restored too if the checkpoint has one.
- Folder checkpoints from before the switch (`.harness/checkpoints/<slug>/<id>/`) still show in the list with `legacy: true`, and they still restore through `FsCheckpointStore`. No migration step; nothing was converted.
- Deleting a project moves its history into the trash entry as `history.git`. A duplicate starts with no history.
- Without git on PATH the studio falls back to `FsCheckpointStore`, the old folder copies (newest 30 kept).
- Restore refuses while a job is running.

### Reloads

- The plugin's `hotUpdate` hook hands every file event to `ReloadCoordinator.fileChanged()`, which takes over reloads for code files in `games/` and `engine/` (`.js`, `.mjs`, `.json`, `.html`, `.glsl`, `.frag`, `.vert`) and returns `[]`, so Vite does no reload of its own.
- A changed file in `games/<slug>/` queues a reload for that slug. A changed file in `engine/` queues one for every tab.
- While any Claude job runs, in any project, queued reloads wait. When the last job ends, `flush()` (via a `ModuleInvalidator` the plugin provides over Vite's module graph) invalidates the changed modules, logs a reload line in the chat and sends one `harness:reload` with `{ slugs: [...] }` or `{ all: true }`. With no job running, a change flushes after a 180 ms debounce.
- The runtime checks the slug and reloads only matching tabs (`engine/runtime.js:398`).
- `game.json`, `tweaks.json` and `thumb.jpg` never reload a game. A `game.json` change only refreshes the landing page.

### Security

- The daemon rejects any `Host` header other than localhost, 127.0.0.1 or [::1] before Vite sees the request, which closes the DNS-rebinding gap the Origin check alone left open.
- Requests must come from a loopback address (`middleware/local-only.ts`).
- POSTs need the header `X-Devchat: 1` and an `Origin` whose host matches `Host` (same file). This blocks cross-site requests.
- The daemon listens on `localhost` only, so it isn't reachable from the LAN. Keep it that way: the chat can edit files.

### Cost

Each prompt is a real Claude Code run billed to the user's account. A tiny edit on the old single-game setup cost about $0.37. The chat shows the run time and cost in its "Done" line; every run is also a row in the `runs` table.

## Project shell and Ask panel: `apps/studio/src/routes/p.$slug.tsx`, `packages/bridge/`

A project opens at `/p/<slug>`: the studio page with the game framed full-size underneath (`/play/<slug>?embed=1`) and the Ask panel over the right edge.

- A bare `/play/<slug>` redirects to `/p/<slug>`, keeping the query. `/p/<slug>?build=1` passes `build=1` through to the frame.
- The panel lives outside the game document, so it keeps working, and keeps its scroll position and draft, when the game reloads or crashes.
- The page title is "<project name> · World Studio" (the app window's title).

The bridge (`packages/bridge/`):

- `protocol.ts`: zod-checked, versioned postMessage messages.
  - Game to studio: `ready`, `state` (mode, selection text, whether a screenshot is possible), `open`, `close`, `toggle`, `focusComposer`, `shot`, `error`, `quickPrompt`, `context`.
  - Studio to game: `panel`, `typing`, `requestContext`, `screenshot`, `exitPointerLock`.
  - Both sides check the source window and origin. Nothing reaches into the other window, so the game could later move to a sandboxed origin.
- `game-agent.ts`: injected at the top of every framed play page by `studioPlugin`, before the game, so it survives a crash.
  - It keeps the interface the engine already calls, `window.devchat` (`open`, `close`, `focusComposer`, `attach`, `reportError`, `isOpen`), and reads `window.__harness`. The engine itself didn't change for the shell.
  - It owns what must stay in the game document:
    - the quick prompt bar (Enter in play or build mode keeps pointer lock),
    - backtick and Enter while the game has focus,
    - error capture (window errors, unhandled rejections, failed script loads, `vite:error`),
    - `[Game context: …]`,
    - the `devchat-open` body class that build mode's layout uses.
  - It adds `<base target="_top">`, so in-game links (Projects, All projects) navigate the studio, not the frame. The HUD's fatal-error button uses `window.top`.
  - `game.css` holds the quick bar and the HUD offset.

The Ask panel (`apps/studio/src/chat/`):

- It ports the old `harness/client/chat.js` feature for feature and keeps its class names and `chat.css`, so it looks the same.
- `timeline.ts` (unit tested) turns the log into blocks: each turn's tools collapse into one "N steps" row, and when a turn ends, earlier texts dim as progress notes.
- `use-chat.ts` streams `/api/chat/<slug>/events`. `use-game-bridge.ts` is the studio end of the bridge, including the context request with its 600 ms timeout.
- Chips above the text box:
  - "Camera view" / "My position", on by default (localStorage `devchat:camera-context`),
  - the build-mode selection, with ×,
  - a screenshot ("Attach view", or K in build mode),
  - "Engine edits: all games" (one prompt) or "Engine edits: always on".
- The ⋯ menu has "Allow engine edits" (next prompt), "Always allow engine edits" (the studio setting) and "New conversation".
- The Checkpoints tab shows "Undo last prompt", then every checkpoint with Restore and its change counts.
- While Claude works, a card shows the latest step, the elapsed time and Stop. The status pill shows progress while the panel is closed. An empty chat shows three example prompts.
- Errors from the game show as error cards with "Fix it", deduped, and open the panel.
- Keys:
  - Backtick toggles the panel from the game or the studio.
  - Focusing the composer sends `typing` to the game first, so losing pointer lock reads as typing, not as a pause.
  - Esc in the composer blurs it during play or build, and closes the panel otherwise.
  - After a send in play mode, focus goes back to the game frame (click to re-lock the pointer).
- Panel open/closed is remembered per project in sessionStorage.

## Studio UI: `apps/studio/`

React 19 with TanStack Router (file-based routes in `src/routes/`; `routeTree.gen.ts` is generated by the Vite plugin, so don't edit it) and TanStack Query. Tailwind v4 is limited to the studio's own files (`@import 'tailwindcss' source(none); @source './'`), so it never scans `games/`. Components in `src/components/ui/` follow shadcn's style (cva, `cn()`, Radix primitives from `radix-ui`). The colors in `src/styles.css` `@theme` are the same values as `engine/ui/tokens.css`. Root `index.html` mounts `src/main.tsx`.

- Data comes through `studioClient()`, the typed Hono client (`src/lib/api.ts`). Mutations invalidate `['projects']`.
- `useStudioEvents()` (`src/lib/events.ts`) listens on `/api/events`, so a change made anywhere refreshes the list: another tab, the desktop app or an agent run. A `job` event updates the Working badge.
- The landing route (`src/routes/index.tsx`) is a port of the old vanilla page. Cards show a thumbnail or initials and "edited … ago", with Build, Duplicate, Rename and Delete in dev. The New project dialog takes a name, a template and an optional description; Claude builds the description as the first prompt, and the new project opens in build mode. Rename and Delete are in-page Radix dialogs (no `window.prompt`, which Electron lacks). Navigation stays in place.
- In production there's no New project button and no card actions. The list comes from `src/lib/registry.prod.js`, the glob of every `game.json`. A card opens `play.html?game=<slug>`.
- The React and Tailwind plugins live in `vite.config.js` and are scoped to `apps/studio/src`. Games and the engine stay plain JS, with the harness's own reload handling.
- `bun run typecheck` checks the studio too (`apps/studio/tsconfig.json`).

## Physics and the game kit: `engine/physics/`, `engine/kit/`

Games get rigid-body physics and a few plain Three.js helpers. All of it is installed at the root and documented for the agent in `engine/API.md` ("Physics", "Libraries you can use"), which can't install packages. React Three Fiber and Drei were considered and left out (2026-10-02): they would mean rewriting the engine and every game around React's render loop, and Drei's useful parts exist as plain libraries.

- **Physics** (`engine/physics/physics.js`, `@dimforge/rapier3d-compat` 0.21):
  - `await ctx.physics({ gravity })` dynamically imports Rapier and creates one world per game. Games that never call it don't load it (the build splits it into its own chunk; e2e checks the other games never fetch it).
  - The helper:
    - `addStatic(meshOrBox)`, `addHeightfield(...)`,
    - `addBody(mesh, { shape, mass, restitution, velocity, kinematic, index, ccd, ... })` (the mesh, or an `InstancedMesh` instance, follows the body after every step),
    - `onContact`, `raycast`, `groundY(x, z)` (for `world.groundY`, so the player walks on colliders), `remove`,
    - `showColliders`, plus the raw `RAPIER` and `world` for joints and controllers.
  - The runtime (`engine/runtime.js`, the loop) steps it on a fixed 1/60 s clock (at most 4 steps a frame) whenever `game.update` runs. It pauses with the game, and the step is deterministic across frame rates (unit tested).
  - In play mode the runtime moves a kinematic capsule (or a box for the car) to the player every frame, so walking or driving into bodies shoves them. The player itself still collides through `world.grid`.
  - Bodies with meshes register a `ctx.select` provider, so they're clickable in build mode. "Physics / Show colliders" is an engine tweak that draws Rapier's debug render.
  - `window.__game.physics` exposes the helper for tests.
- **Kit helpers** (`engine/kit/`, exported from `engine/index.js`):
  - `text()` wraps troika-three-text for SDF text. It needs network the first time, for the font.
  - `enableBVH()` installs three-mesh-bvh, so `geometry.computeBoundsTree()` speeds up raycasts. Its type augmentation is pulled in by `engine/index.d.ts`.
- **Types:** `engine/types.d.ts` types `ctx.physics()` and the helper, so `check_game` catches a wrong shape or a misspelled field.
- **Agent prompt:** the system prompt (`prompts.ts`) tells the agent to use physics for anything that falls, stacks, rolls or gets knocked over, and points at the libraries list.
- **Template:** `templates/physics-playground/` has ramps, a seesaw on a revolute joint, crate towers, thrown balls (R), a "Crates down" objective and a troika sign, all in one file the agent can copy.
- **Verified 2026-10-02:**
  - unit tests (falling and resting, determinism, a ramp, contacts, player shove, picking, instances),
  - e2e on web and Electron (the playground runs, throws, pauses frozen, shoves, picks; other games don't load Rapier),
  - an export from a static server.
  - A real Haiku prompt ("a pile of barrels I can knock over") read `API.md`, used `ctx.physics()` and `check_game`, and works; walking into a barrel pushed it 3.5 m.
- **Fixed along the way:**
  - `ctx.select.add` crashed on an entry with `getBox()` and no `box`. It now accepts that, and the crash took the agent's whole game down.
  - With no window open, the live tools' error now tells the agent `check_game` doesn't prove the game starts, so it shouldn't say it works.
- **Not done yet:** pmndrs `postprocessing` in place of the EffectComposer bloom, Rapier's vehicle controller for cars, a character-controller player mode, ZzFX sound effects.

## Themes: `packages/theme/`

The studio has six themes: Control Room (the default and original), Floating Canvas, Blueprint, Terminal, Arcade and Atlas. They come from the design canvas made on 2026-10-02 (directions 01, 10, 02, 04, 05, 07). Pick one in Settings: the landing page's Settings button, or "Theme and settings…" in the Ask panel's ⋯ menu.

- `themes.ts` holds `THEMES` (id, name, blurb, picker swatches, Google Fonts families), `applyTheme(id)` and `rememberedTheme()`.
  - `applyTheme(id)` sets `<html data-theme>`, adds the theme's font `<link>` once, and remembers the theme in localStorage (`worldstudio:theme`), so the next load paints in it before settings arrive.
- `themes.css` overrides, per theme, the `--ws-*` variables from `engine/ui/tokens.css` (Control Room's values) and the game HUD's own variables (`--cyan`, `--ink`, `--dim`, `--glass`, `--line` in `engine/ui/style.css`), plus a few structural rules:
  - Floating Canvas and Atlas inset the Ask panel and round the panels. Floating Canvas also detaches the top bar and Properties panel as floating cards.
  - Blueprint puts a grid on the panels; Arcade uses pixel headings and offset shadows; Terminal styles the chat as a prompt.
  - The start menu panel is restyled per theme too.
- The choice is the `theme` studio setting in `.harness/settings.json`, so the browser and the desktop app share it.
  - `Settings` in `packages/shared` validates it; an unknown value falls back to `control-room`, and `POST /settings` refuses one with a 400.
  - The settings event refetches it live everywhere.
  - `useTheme()` (`apps/studio/src/lib/theme.ts`, mounted in the root route) applies it. The project shell also sends it to the game frame (bridge message `theme`), where the bridge agent applies it, so the HUD, the selection label and the quick bar match.
- Tailwind's colors, fonts and radii in `apps/studio/src/styles.css` are `@theme inline` references to those variables, so the landing page follows a switch without any per-theme classes.
- Production builds and exports have no settings, so they use the remembered theme or the default.
- A new theme needs an entry in `THEMES` and a block in `themes.css`, and should then be checked on the landing page, the studio and the start menu. The swatches and fonts in `THEMES` must match the CSS.

## Build mode: `engine/build/buildmode.js` (in-world) and `apps/studio/src/build/` (panels)

Build mode is split down the frame:

- The engine (`buildmode.js`, inside the game) keeps what follows the 3D view: the free camera, hover and click picking, the hover outline, the selection box, and the floating label over the selection (`build.css` there now holds only that label and the HUD-hiding rules).
- `BuildMode.state()` returns plain data (frozen, time, night, moved, the selection with center and size, every tweak, the unsaved count and the values to save). `setTime()`, `frameSelection()` and `actions` take commands back.
- The studio (`build-panels.tsx`, `build.css`) draws everything flat over the frame:
  - the top bar,
  - Properties (the selection card and tweaks),
  - the collapse rail,
  - the hint bar,
  - the shortcuts sheet,
  - the first-run tips.
- The bridge agent sends `build` state about every 120 ms while build mode is on, but only when something changed (the clock counts in minutes). The panels send `buildAction` messages: `play`, `toggleFreeze`, `setTime`, `playFromHere`, `frame`, `deselect`, and `tweakSet`, `tweakReset`, `tweakDiscard`, `tweakSaved`.
- Save posts the values to `/api/tweaks`, then tells the game the values are saved.
- A click on a panel button hands the keyboard back to the game frame, so WASD keeps flying the camera. Text fields, sliders and the Shortcuts buttons keep focus.
- Sliders and the time control keep their own value while you drag, so the state echoing back doesn't fight the thumb.

How it behaves:

- Tab toggles between play and build. The start menu has Play and Build mode buttons, and `?build=1` opens straight into build mode.
- Build mode only exists under the studio (`BUILD` in `engine/runtime.js`). A production build or an exported game is play-only: no Build mode button, Tab does nothing, and `?build=1` is ignored.
- Free camera, separate from the player: right-drag looks, WASD moves, Q/E go down/up, Shift is fast, the wheel changes speed.
- Layout: a top bar, a Properties panel on the left (collapsible to a small button) and the Ask panel on the right. Shared colors, buttons and sizes are in `engine/ui/tokens.css`; icons are inline SVG in `engine/build/icons.js`. Cyan marks actions and active state, yellow marks the selection only, coral marks errors and engine edits.
- The panels make room for the Ask panel through the `devchat-open` body class, which is set on both the studio page and the game frame.
- Top bar: "Projects" link, project name, a Play | Build switch, a time-of-day slider, "Pause world" / "Resume world", "Attach view" (K), "Test from here" (P) and a shortcuts button. Labels drop to icons on narrower windows.
- Pause is on by default in build mode. It pauses `game.update` and the clock.
- Hovering outlines what's clickable, and a click selects. Picking is a ray against the boxes games register with `ctx.select`, so it works on merged and instanced geometry. The selection gets a yellow box and a floating label with an "Ask" button.
- Properties: the selection card shows kind, id, 2-3 key props and size. It has "More details" (position, remaining props, source file), "Ask about this" (focuses the prompt with the selection attached), Frame (F) and Deselect (Esc).
- Tweaks sit below the selection card: a filter box, the game's groups open, and the engine's World/Player tweaks folded under "Engine settings". A footer shows "N unsaved changes" with Discard and Save (writes `games/<slug>/tweaks.json`). Changed rows show a reset button.
- A bottom hint lists the camera keys, and "Shortcuts" opens a key reference (Esc closes it). A three-step tip card shows the first time you enter build mode (remembered in localStorage, `worldstudio:build-tips-seen`).
- Keys typed while the game has focus (K, P, F, Esc, Tab, N, G) are still handled by the runtime inside the frame.
- Test from here (P) drops the player at the camera, flying if the camera is more than 4 m up.
- The runtime sends a thumbnail 4 s after start, when you leave build mode, and every 3 minutes while playing.

## Hot reload

- On `harness:reload` (and on Vite's own `vite:beforeFullReload`), the runtime saves a snapshot to sessionStorage (`engine/runtime.js:356`): mode, Freeze, time of day, quality, player position/yaw/pitch/flying, the car if driving, the build camera pose and `game.snapshot()`.
- On boot it restores a snapshot younger than 2 minutes, puts you back in the car if you were driving, returns you to play or build mode and toasts "Changes applied" (`engine/runtime.js:369`).
- Audio waits for the next click or keypress, since browsers need a gesture.

## Meridian City: `games/meridian-city/`

A procedurally generated island city you walk, drive and fly through while collecting 40 data cores.

- City: 19x19 blocks, 64 m blocks, 16 m roads, about 1.5 km across (`games/meridian-city/config.js:2`). Block types are city, park and plaza. Downtown skyscrapers have tiered setbacks, parks have ponds, and the central plaza holds a 360 m landmark tower. Neon signs, rooftop clutter, street lamps and trees.
- Edges: a promenade and seawall, ocean around the island, and the engine's ring of mountains 2.1-5.6 km out (`engine/world/scenery.js:70`).
- Traffic: about 420 AI cars on a road-node graph with bezier turns, plus parked cars. AI cars stop for obstacles and the player, honk when blocked, and ghost through whatever is in the way after 7 s stuck (`games/meridian-city/vehicles.js:216`).
- Pedestrians: about 900, looping around sidewalks.
- Sky and light (engine): a day lasts 12 real minutes (`engine/world/environment.js:18`). The PMREM environment map regenerates every 5 game-seconds (`engine/world/environment.js:155`).
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

- Edit permissions for the agent use absolute paths (`Edit(//<abs>/games/<slug>/**)`). Relative rules resolve against Claude's current directory, so one `cd games/<slug>` in a shell command made the game's own files unwritable (seen on 2026-10-01 in the Meridian penthouse prompt).

- Engine CSS edits go through Vite's normal CSS HMR. The harness doesn't intercept them (the `CODE_FILE` check in `hotUpdate`).
- Editing `vite.config.js` restarts Vite inside the daemon. Open tabs reload through Vite's own reconnect, with no snapshot guarantee. Changes to `packages/server/` need a daemon restart (Ctrl+C and `bun run dev`, or quit and reopen the app if it owns the daemon).
- Server code in `packages/` must stay erasable TypeScript (no enums, namespaces or constructor parameter properties). Node strips the types at runtime, and `bun run typecheck` enforces it with `erasableSyntaxOnly`.
- Editing `templates/` never reloads anything. Templates are copied only when a project is created, so changing a template doesn't change existing games.
- `games/<slug>/game.json`, `tweaks.json` and `thumb.jpg` changes never reload a game.
- One Claude job per project at a time. While any job runs, in any project, all pending reloads wait until it finishes.
- Copying a template or duplicating a project writes files the watcher reports a second or two later, once per Vite environment (client and ssr). `ReloadCoordinator.markFresh()` records each copied file's mtime and skips events while it still matches, so a new project's tab doesn't reload on its own.
- `node_modules/.package-lock.json` (left behind by npm) makes Vite hash a different lockfile depending on who launched it, re-optimize deps on every start, and reload open pages. Since the move to bun it must not exist; `bun install` doesn't recreate it.
- Production-only globs live in the `registry.prod.js` files and load through dynamic `import()`, so the dev server never watches them. A static glob made every project creation reload every tab.
- Per-game RNG: Meridian uses its own `games/meridian-city/rng.js`, seeded 20260930 (`games/meridian-city/rng.js:4`). Changing the order of `rand()` calls regenerates a different city. It also breaks reload restore of collected cores, which are matched by position within 1 m (`games/meridian-city/game.js:154`).
- `ctx.rng` is seeded from the slug, so a duplicated project using `ctx.rng` generates a different world from the original. Meridian's own RNG sidesteps this.
- Esc while pointer-locked always releases the lock. That's browser behavior; click the game to re-lock.
- Ctrl is deliberately unbound, because Ctrl+W closes the tab.
- In the quick prompt bar a typed backtick is sent as text (a lone "`" once went out as a prompt). The panel textarea closes on backtick only when empty.
- three 0.186 removed `PCFSoftShadowMap`, so the renderer uses `PCFShadowMap`. `THREE.Clock` is deprecated; the loop uses `performance.now()`.
- Building collider rects carry `tiers` for flight and rooftop landing (`games/meridian-city/city.js:119`). The player controller reads them; cars use only the base footprint.
- Moved folder: the project moved from `~/Desktop/3d-city-site` to `~/Developer/Personal Projects/3d-city-site`. The Desktop folder holds only a `.vite` cache and is safe to delete. Run the dev server from the new path.
