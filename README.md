# World Studio

A local studio for building 3D browser games with Claude while they run. Each project is its own game on a shared Three.js engine. Open one, walk around in it, press Tab to switch to build mode, click anything and tell Claude what to change. The game reloads where you stand, with your position and progress kept.

Built with Three.js 0.186 and Vite 8, in plain JavaScript modules with no framework and no asset files. Every texture is drawn on a canvas and every sound is synthesized with Web Audio.

## Run it

```sh
bun install
bun run dev
```

Open the URL it prints. The studio server uses port 5173, or the next free port if that one is taken. If a studio server is already running for this checkout (from another terminal or the desktop app), `bun run dev` prints its URL instead of starting a second one.

`bun run test` runs the unit tests and `bun run test:e2e` runs the browser and desktop end-to-end suite with a stand-in agent, so it costs nothing.

The chat needs the `claude` CLI installed and logged in.

### Desktop app (macOS)

```sh
bun run app:install
```

This builds `World Studio.app`, installs it in `~/Applications` and puts a link on the Desktop. Double-click it and the studio opens in its own window. The app and `bun run dev` share one studio server: if one is already running for this checkout, the other attaches to it, so a browser tab and the app window see the same chats, settings and running prompts. If the app started the server, quitting the app stops it. The app points at this checkout: games, chats and checkpoints stay in this folder. Rebuild it only after changing `apps/desktop/main.js` or the icon. `bun run app` runs it from source without packaging.

Logs go to `~/Library/Logs/World Studio/main.log`.

`bun run build` makes a production build in `dist/`, and `bun run preview` serves it. The production build plays the games but has no chat, no build mode, no project editing and no saving. `bun run export <slug>` builds a single game the same way into `exports/<slug>/`, ready for any static host.

### Themes

Settings (on the landing page, or in the Ask panel's ⋯ menu) switches the whole studio between six themes: Control Room, Floating Canvas, Blueprint, Terminal, Arcade and Atlas. The game's HUD follows too. The choice is shared by the browser and the desktop app.

## How to use it

The landing page lists your projects. Click a card to play, or use New project to start one from a template. If you describe the game in the New project dialog, Claude builds a first version as its opening prompt, and the project opens in build mode.

Each card also has Build, Duplicate, Rename and Delete. Delete moves the project (and its chat) to `.harness/trash/`, so you can get it back by moving its `game` folder into `games/`.

Inside a game:

- Play it like a normal game. The start menu has Play and Build mode buttons.
- Press Tab for build mode. You get a free camera, and the world is paused by default ("Resume world" in the top bar runs it) so you can look at things while they hold still. The top bar also has a time-of-day slider.
- Press backtick to open the Ask panel, or Enter for a one-line prompt bar that keeps you in the game. Each prompt runs Claude Code on this project only.
- Point and prompt: in build mode, hover to see what's clickable and click an object. The Properties panel shows what it is, and "Ask about this" attaches it to your next prompt. "Attach view" (K) adds a screenshot of what you see.
- Tweaks: under the selection in the Properties panel are the sliders, colors and toggles the game exposes, with the engine's world and player settings folded under "Engine settings". Changes apply live. Save writes them to the game's `tweaks.json`; Discard undoes unsaved changes.
- Checkpoints: one is saved before every prompt. Open the Checkpoints tab in the Ask panel and use "Undo last prompt" or Restore. Restoring saves a checkpoint first, so a restore can be undone too.
- Engine edits: by default Claude can edit only this game's folder. Choose "Allow engine edits" in the Ask panel's ⋯ menu to let it change the shared engine for one prompt, or "Always allow engine edits" to let every prompt in every project change both the game and the engine until you turn it off. The setting is shared by the browser and the desktop app. Engine changes affect every game.

When a runtime error shows up, the chat shows it with an "Fix it" button.

## Included games and templates

- Meridian City (`games/meridian-city/`): a procedurally generated island city about 1.5 km across, with stepped skyscrapers, parks, a 360 m landmark tower, about 420 AI cars and 900 pedestrians. Find all 40 data cores; their light beams show from a distance, and a timer runs until you collect the last one. A full day passes in 12 real minutes.
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

Chat (dev server only): backtick toggles the panel, and Enter opens the quick prompt bar.

## Cost and safety

Each prompt is a real Claude Code run billed to your account. The harness runs only under `bun run dev`, accepts requests only from this machine, and isn't part of production builds.

See [HANDOFF.md](HANDOFF.md) for how the code is organized and how the harness works, and [engine/API.md](engine/API.md) for the contract a game follows.
