---
name: parity
description: Keep World Studio's two ways of running - the browser (bun run dev, localhost:5173) and the macOS Electron app (apps/desktop/, World Studio.app) - behaving the same. Both are clients of one studio daemon (packages/server). Use on every change in this repo before calling it done - engine/, harness/, packages/, templates/, games/, vite.config.js, package.json or apps/desktop/ - and whenever a request mentions the app, the desktop version, Electron or the browser version. Skip only for the in-app agent that the harness starts to edit one games/<slug>/ folder.
---

# Web / Electron parity

World Studio runs two ways from the same checkout, and both talk to one studio daemon (`packages/server/src/daemon.ts`: Vite in middleware mode plus the harness, one per checkout, recorded in `.harness/daemon.json`):

- Web: `bun run dev` starts the daemon in the terminal (or prints the URL of the one already running); open it in a browser, normally http://localhost:5173.
- Desktop: `World Studio.app` on the Desktop (installed by `bun run app:install`), or `bun run app` from source. The shell is `apps/desktop/main.js`. It attaches to a running daemon, or starts one in an Electron utilityProcess and shows it in a window. HANDOFF.md has the full description under "Desktop app".

So a browser tab and the app window on the same checkout normally share one harness: the same chats, jobs, settings and reloads. The rule: every change works in both, in the same change. If one side can't support a feature, the other side gets a fallback or a quiet no-op, written now. Never finish with "works in the browser" when the app wasn't checked, unless you say so.

## When this doesn't apply

You are the in-app agent if your system prompt says you're editing one game in `games/<slug>/` for the World Studio harness. Game code runs identically in both, and you can't launch either one, so ignore this skill and follow the harness instructions.

## Where the two differ

Check the change against each item.

1. Origin. The daemon listens on 5173, or the next free port, and writes the real one to `.harness/daemon.json`. The browser and the app usually load the same origin, but tests run private daemons on other ports (`--no-lock`, `WORLD_STUDIO_ISOLATED=1`). Client code uses relative URLs or `location.origin`. Nothing outside packages/server and the e2e config names a port.
2. Storage. localStorage and sessionStorage belong to the browser profile as well as the origin, so the browser and the app don't share them even on the same port (build-mode tips, the props-collapsed flag, the camera-context toggle, hot-reload snapshots). That's fine for per-window conveniences. Anything both sides must see goes through the harness into `.harness/` or the game folder.
3. Environment. The daemon's environment is whoever started it: the terminal's, or the app's. A Finder launch has none of the shell's exports. `fixPath()` copies PATH and `DEVCHAT_*` from the login shell and nothing else (`SHELL_VARS` in `apps/desktop/main.js`), then forks the daemon with that environment. A new environment variable the server reads must be added to `SHELL_VARS`, or it will work from the terminal and silently do nothing in an app-started daemon. New binaries the server spawns must be on the login shell's PATH.
4. Renderer. The app window is sandboxed Chromium with context isolation and no preload: no `require`, no `process`, no Node APIs. Client code stays plain browser JS. Anything that needs the file system or a process goes through a route on the daemon's API (`packages/server/src/app.ts`, served at `/__harness` and `/api`), which both sides share. Don't add Electron-only IPC for a feature the browser also needs.
5. Windows and links. In the app, links to other sites open in the default browser, and `window.open` or `target="_blank"` never opens a window, even on the same origin. Navigate in place (`location.href = ...`) instead of opening tabs. Inside the game frame, navigate the studio instead (`window.top.location`, or a plain link, which the bridge agent's `<base target="_top">` sends to the top).
6. Dialogs. `alert` and `confirm` work in both (the chat's Restore uses them). `window.prompt()` doesn't exist in Electron. Use an in-page dialog like the landing page's.
7. Keyboard. The app's default menu takes Cmd+Q, Cmd+W, Cmd+R, Cmd+Shift+R, Cmd+M, Cmd+H, Cmd+Option+I, Cmd+0, Cmd+plus and Cmd+minus, Ctrl+Cmd+F, Cmd+C/V/X/A/Z and Cmd+Shift+Z. The browser takes Cmd+T, Cmd+L, Cmd+N and Cmd+W. Game and build-mode keys stay off Cmd and Ctrl combos (Ctrl is unbound on purpose).
8. Permissions. Electron grants camera, microphone, notification and clipboard requests without asking. The browser prompts and can refuse. Handle refusal anyway.
9. Downloads. An `<a download>` click (production "Attach view") saves straight to Downloads in the browser and opens a save dialog in the app. Both are acceptable. Don't rely on either.
10. Window size. The app's minimum is 960x600 and has no URL bar, and the window title comes from `document.title`. Layouts have to hold at 960x600.
11. Lifecycle. Whoever started the daemon owns it. Ctrl+C stops a terminal daemon, and the app keeps showing it only while it runs. Quitting the app stops the daemon only if the app started it, and a browser tab on that daemon goes offline with it. The daemon runs Vite in middleware mode, which has no `httpServer`, so anything the studio starts (child processes, timers, watchers) stops in `studio.close()`, which the plugin's `closeBundle` hook runs on `vite.close()`, the same way agent jobs do (`packages/server/src/vite/plugin.ts`).
12. Errors. The app has no terminal. Output from an app-started daemon goes to `~/Library/Logs/World Studio/main.log`; a terminal daemon logs to its terminal. Errors the user needs to see go to the chat as error cards, not only to the console.
13. Rebuilds. Changes under `engine/`, `games/`, `harness/`, `packages/` or `templates/` reach the app on the daemon's next start with no rebuild. The daemon runs from TypeScript source; Node 24, both the system one and Electron's, strips the types itself, so keep `packages/` to erasable syntax (`erasableSyntaxOnly`). Changes to `apps/desktop/` reach the installed app only after `bun run app:install`. Changes to the Electron or Vite version in package.json need `bun install` and then `bun run app:install`.

The production build (`bun run build`, `dist/`) is a third target with no harness. Keep `npx vite build` passing, but parity here means the dev browser and the app.

## Verify

Run what the change touches, in both.

1. `npx vite build` compiles, and `bun run test` and `bun run typecheck` pass.
2. Both sides at once: `bun run test:e2e` runs the Playwright suite in `e2e/` against a private web daemon and a private app daemon (`WORLD_STUDIO_ISOLATED=1`), with the fake agent `scripts/fake-claude.mjs` standing in for `claude`. Add a test there for whatever the change touches.
3. Web by hand: run `bun run dev` in the background, read the URL from `.harness/daemon.json`, and drive it with the Playwright MCP tools. A project is `/p/<slug>`: the studio page, with the game in an iframe. `window.__game` and `window.__harness` live in that frame (`document.querySelector('iframe').contentWindow.__game` from the page). See HANDOFF.md, "Run and verify".
4. App by hand: run `npx electron . --remote-debugging-port=9333` in the background. It attaches to the daemon from step 3 if one is running. Use `scripts/cdp.mjs` from this skill:
   - `node .claude/skills/parity/scripts/cdp.mjs nav /p/meridian-city?build=1`
   - `node .claude/skills/parity/scripts/cdp.mjs eval "JSON.stringify(document.querySelector('iframe').contentWindow.__game.state)"`
   - `node .claude/skills/parity/scripts/cdp.mjs shot <scratchpad>/app.png`

   Run the same checks you ran in the browser and compare the results. Screenshots need the window visible on screen. If `shot` times out, the window is covered, and `eval` still works.
5. If `apps/desktop/` changed: quit any terminal daemon, run `bun run app:install`, then `open "$HOME/Desktop/World Studio.app"`, then `tail ~/Library/Logs/World Studio/main.log`. Expect a `claude CLI:` path and a `Started the studio daemon` (or `Attached to the running daemon`) line.
6. Clean up: `osascript -e 'quit app "Electron"'` for the source run, `osascript -e 'quit app "World Studio"'` for the installed app, and stop any dev server you started.

Pointer lock, audio and real prompt runs need a person. Name them as unverified and don't guess.

## Report

End with one parity line, for example: "Parity: browser - build mode selection checked with Playwright; app - same check over CDP, matched; installed app rebuilt." If one side wasn't checked, say which one and why.
