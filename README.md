# World Studio

A local studio for building 3D browser games with Claude while they run. Each project is its own game on a shared Three.js engine. Open one, walk around in it, press Tab to switch to build mode, click anything and tell Claude what to change. The game reloads where you stand, with your position and progress kept.

It runs in a browser or as a macOS desktop app, and both talk to the same local studio server. Games and the engine are plain JavaScript on Three.js 0.186 with no asset files: every texture is drawn on a canvas and every sound is synthesized with Web Audio. The studio around them is TypeScript: a Hono server, a React app, a Postgres database (PGlite) and the Claude Agent SDK.

## Run it

You need [bun](https://bun.sh) (package manager), Node 24 or newer, git, and the [`claude` CLI](https://docs.claude.com/en/docs/claude-code) installed and logged in. The studio uses your own Claude login, the same as the CLI.

```sh
bun install
bun run dev
```

Open the URL it prints, normally http://localhost:5173. If a studio server is already running for this checkout (from another terminal or the desktop app), `bun run dev` prints its URL instead of starting a second one. The server's details are in `.harness/daemon.json`.

### Desktop app (macOS)

```sh
bun run app:install
```

This builds `World Studio.app`, installs it in `~/Applications` and puts a link on the Desktop. The app attaches to a running studio server, or starts one and stops it again when you quit, so a browser tab and the app window always see the same chats, settings and running prompts. The app runs this checkout's code, so changes to the studio, the engine or the games need no rebuild; rebuild only after changing `apps/desktop/` or the icon. `bun run app` runs it from source without packaging. Logs go to `~/Library/Logs/World Studio/main.log`.

### Build and export

`bun run build` makes a production build in `dist/` and `bun run preview` serves it. A production build plays the games but has no chat, no build mode, no project editing and no saving. `bun run export <slug>` builds one game the same way into `exports/<slug>/`, ready for any static host.

### Develop

```sh
bun run typecheck   # TypeScript 7 over the server, bridge and studio
bun run lint        # Biome
bun run test        # unit tests (Vitest)
bun run test:e2e    # production build, then Playwright in Chromium and in the Electron app
```

The end-to-end suite runs a stand-in agent, so it needs no login and costs nothing. It covers the browser and the desktop app with the same tests; every change has to work in both.

## How to use it

The landing page lists your projects. Click a card to play, or use New project to start one from a template. If you describe the game in the New project dialog, Claude builds a first version as its opening prompt, and the project opens in build mode. Each card also has Build, Duplicate, Rename and Delete. Delete moves the project and its history to `.harness/trash/`, so you can still get it back.

Inside a game:

- Play it like a normal game. The start menu has Play and Build mode buttons.
- Press Tab for build mode. You get a free camera, and the world is paused by default ("Resume world" in the top bar runs it) so you can look at things while they hold still. The top bar also has a time-of-day slider and "Test from here".
- Press backtick to open the Ask panel, or Enter for a one-line prompt bar that keeps you in the game. Each prompt runs Claude on this project only.
- Point and prompt: in build mode, hover to see what's clickable and click an object. The Properties panel shows what it is, and "Ask about this" attaches it to your next prompt. "Attach view" (K) adds a screenshot of what you see.
- Claude can look at the game itself while it works: it can take a screenshot of your view, read the game's state and errors, reload your window to test a change, and type-check the game before it finishes.
- Tweaks: under the selection in the Properties panel are the sliders, colors and toggles the game exposes, with the engine's world and player settings folded under "Engine settings". Changes apply live. Save writes them to the game's `tweaks.json`; Discard undoes unsaved changes.
- Checkpoints: one is saved before every prompt, with what that prompt changed (files and lines added and removed). Open the Checkpoints tab in the Ask panel and use "Undo last prompt" or Restore. Restoring saves a checkpoint first, so a restore can be undone too.
- Engine edits: by default Claude can edit only this game's folder. If it needs something outside it, the chat asks you first (Decline or Allow once). "Allow engine edits" in the Ask panel's ⋯ menu lets it change the shared engine for one prompt, and "Always allow engine edits" lets every prompt in every project change it until you turn it off. Engine changes affect every game.
- When the game hits an error, the chat shows it with a "Fix it" button. The chat lives outside the game, so it keeps working when the game crashes.

### Themes and settings

Settings, on the landing page or under "Theme and settings…" in the Ask panel's ⋯ menu, switches the whole studio between six themes: Control Room (the default), Floating Canvas, Blueprint, Terminal, Arcade and Atlas. The game's HUD and start menu follow. Settings are shared by every project and by the browser and the desktop app, and a change shows up in every open window at once.

## Architecture

```
  browser tab ──┐                                   ┌── games/<slug>/   game code (Claude edits these)
                ├──▶  studio server  (one per       ├── engine/         shared Three.js runtime
  desktop app ──┘     checkout, Node 24)            ├── .harness/db     PGlite: chats, runs
                      Hono API + Vite (middleware)  ├── .harness/git    checkpoint history per project
                              │                     └── .harness/settings.json
                              ▼
                      Claude Agent SDK ──▶ the claude CLI, your login
```

One studio server owns everything stateful: projects, chats, agent runs, checkpoints and reloads. `bun run dev` starts it in a terminal; the desktop app starts it in an Electron utility process or attaches to one that's running. It serves the studio and the games through Vite in middleware mode and answers only on localhost.

In the browser, a project is the studio page (React) with the game in a frame underneath it. The studio page holds the Ask panel and build mode's panels; the framed page holds only the game, the engine's 3D build tools (free camera, picking, the label over a selection) and a small bridge agent. The two talk over a typed postMessage protocol, so the chat survives game reloads and crashes, and the game could later move to its own sandboxed origin.

When you send a prompt, the server:

1. commits the game (and the engine, if engine edits are allowed) to the project's checkpoint history,
2. starts Claude Code through the Agent SDK, with edits limited to `games/<slug>/` and in-process tools for looking at the game and type-checking it,
3. streams each step to every open window,
4. records what the run changed and cost, and reloads only the windows showing that game, keeping your position.

| Path | What it is |
| --- | --- |
| `engine/` | The shared game runtime: renderer, sky, player, HUD, audio, build mode's in-world half. Its contract for games is [engine/API.md](engine/API.md), typed in `engine/types.d.ts`. |
| `games/<slug>/` | One folder per project: `game.js`, `game.json`, `tweaks.json`, `thumb.jpg` and any other game code. |
| `templates/` | Starting points copied into `games/` when you create a project. |
| `packages/server/` | The studio server: the daemon, the Hono API, projects, chats, agent runners, checkpoints, reloads, and the Vite plugin. |
| `packages/db/` | The database schema (Drizzle, Postgres) and migrations. PGlite runs it locally; a hosted Postgres could use the same schema. |
| `packages/bridge/` | The studio ↔ game protocol and the agent injected into framed game pages. |
| `packages/shared/` | Zod schemas shared by the server and the studio. |
| `packages/theme/` | The six themes and their CSS. |
| `apps/studio/` | The React studio: landing page, project shell, Ask panel, build-mode panels, settings. |
| `apps/desktop/` | The Electron shell for the macOS app. |
| `e2e/`, `test/unit/` | The Playwright suite (browser and Electron) and unit tests. |
| `.harness/` | Local runtime data, not in git: database, checkpoint history, screenshots, trash, server lock. |

## Included games and templates

- Meridian City (`games/meridian-city/`): a procedurally generated island city about 1.5 km across, with stepped skyscrapers, parks, a 360 m landmark tower, about 420 AI cars and 900 pedestrians. Find all 40 data cores; their light beams show from a distance, and a timer runs until you collect the last one. A full day passes in 12 real minutes.
- Medieval Village (`games/medieval-village/`) and Cyberpunk City (`games/cyberpunk-city/`): built in the studio from the Blank template.
- Templates for new projects: Blank world (an empty flat plane) and Meridian City.

## Controls

Play mode:

| Key | Action |
| --- | --- |
| WASD / arrows | Move, or drive |
| Mouse | Look (click the game to lock the pointer) |
| Shift | Sprint, boost, fly faster |
| Space | Jump, fly up, handbrake |
| C | Fly down |
| E | Enter or exit a car (slow down to exit) |
| F | Toggle flight |
| H | Horn |
| M | Full map |
| T (hold) | Fast-forward time |
| N | Jump between day and night |
| G | Switch graphics quality (High / Low) |
| Tab | Build mode |
| Esc | Pause |

Build mode:

| Key | Action |
| --- | --- |
| Right-drag | Look |
| WASD | Move the camera |
| Q / E | Down / up |
| Shift | Move faster |
| Mouse wheel | Change camera speed |
| Click | Select an object |
| F | Frame the selection |
| Esc | Clear the selection |
| K | Attach a screenshot to the next prompt |
| P | Play from the camera's position |
| Tab | Back to play mode |

In the studio: backtick toggles the Ask panel, and Enter opens the quick prompt bar.

## Cost and safety

Each prompt is a real Claude run billed to your account; the chat shows each run's time and cost. The studio server answers only on localhost and refuses requests from other sites, Claude's edits are limited to the project's folder unless you allow more, and none of it is part of a production build.

[HANDOFF.md](HANDOFF.md) has the full tour of the code for anyone working on the studio itself, and [engine/API.md](engine/API.md) is the contract a game follows.
