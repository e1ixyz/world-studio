---
name: parity
description: Keep World Studio's two ways of running - the browser (npm run dev, localhost:5173) and the macOS Electron app (desktop/, World Studio.app, port 5199) - behaving the same. Use on every change in this repo before calling it done - engine/, harness/, templates/, games/, vite.config.js, package.json or desktop/ - and whenever a request mentions the app, the desktop version, Electron or the browser version. Skip only for the in-app agent that the harness starts to edit one games/<slug>/ folder.
---

# Web / Electron parity

World Studio runs two ways from the same checkout:

- Web: `npm run dev`, opened in a browser at http://localhost:5173.
- Desktop: `World Studio.app` on the Desktop (installed by `npm run app:install`), or `npm run app` from source. Electron 44 starts the checkout's own Vite server and harness inside its main process on port 5199 and shows it in a window. The shell is `desktop/main.js`; HANDOFF.md has the full description under "Desktop app".

Both use the same vite.config.js, harness plugin, games and `.harness/` data. The rule: every change works in both, in the same change. If one side can't support a feature, the other side gets a fallback or a quiet no-op, written now. Never finish with "works in the browser" when the app wasn't checked, unless you say so.

## When this doesn't apply

You are the in-app agent if your system prompt says you're editing one game in `games/<slug>/` for the World Studio harness. Game code runs identically in both, and you can't launch either one, so ignore this skill and follow the harness instructions.

## Where the two differ

Check the change against each item.

1. Origin. The port is 5173 in the browser and 5199 in the app (`desktop/main.js:10`), and Vite moves to the next free port if one is taken. Client code uses relative URLs or `location.origin`. Nothing outside vite.config.js names a port.
2. Storage. localStorage and sessionStorage belong to the origin, so the browser and the app don't share them (build-mode tips, the props-collapsed flag, the camera-context toggle, hot-reload snapshots). That's fine for per-window conveniences. Anything both sides must see goes through the harness into `.harness/` or the game folder.
3. Environment. A Finder launch has none of the shell's exports. `fixPath()` copies PATH and `DEVCHAT_*` from the login shell and nothing else (`SHELL_VARS` in `desktop/main.js`). A new environment variable the server reads must be added to `SHELL_VARS`, or it will work from the terminal and silently do nothing in the app. New binaries the server spawns must be on the login shell's PATH.
4. Renderer. The app window is sandboxed Chromium with context isolation and no preload: no `require`, no `process`, no Node APIs. Client code stays plain browser JS. Anything that needs the file system or a process goes through a `/__harness` route in `harness/server/plugin.js`, which both sides share. Don't add Electron-only IPC for a feature the browser also needs.
5. Windows and links. In the app, links to other sites open in the default browser, and `window.open` or `target="_blank"` never opens a window, even on the same origin. Navigate in place (`location.href = ...`) instead of opening tabs.
6. Dialogs. `alert` and `confirm` work in both (the chat's Restore uses them). `window.prompt()` doesn't exist in Electron. Use an in-page dialog like the landing page's.
7. Keyboard. The app's default menu takes Cmd+Q, Cmd+W, Cmd+R, Cmd+Shift+R, Cmd+M, Cmd+H, Cmd+Option+I, Cmd+0, Cmd+plus and Cmd+minus, Ctrl+Cmd+F, Cmd+C/V/X/A/Z and Cmd+Shift+Z. The browser takes Cmd+T, Cmd+L, Cmd+N and Cmd+W. Game and build-mode keys stay off Cmd and Ctrl combos (Ctrl is unbound on purpose).
8. Permissions. Electron grants camera, microphone, notification and clipboard requests without asking. The browser prompts and can refuse. Handle refusal anyway.
9. Downloads. An `<a download>` click (production "Attach view") saves straight to Downloads in the browser and opens a save dialog in the app. Both are acceptable. Don't rely on either.
10. Window size. The app's minimum is 960x600 and has no URL bar, and the window title comes from `document.title`. Layouts have to hold at 960x600.
11. Lifecycle. Ctrl+C on the terminal server and quitting the app both close Vite's HTTP server. Anything the plugin starts (child processes, timers, watchers) stops on `httpServer` 'close', the same way agent jobs do (`harness/server/plugin.js:476`).
12. Errors. The app has no terminal. Server output goes to `~/Library/Logs/World Studio/main.log`. Errors the user needs to see go to the chat as error cards, not only to the console.
13. Rebuilds. Changes under `engine/`, `games/`, `harness/` or `templates/` reach the app on its next launch with no rebuild. Changes to `desktop/` reach the installed app only after `npm run app:install`. Changes to the Electron or Vite version in package.json need `npm install` and then `npm run app:install`.

The production build (`npm run build`, `dist/`) is a third target with no harness. Keep `npx vite build` passing, but parity here means the dev browser and the app.

## Verify

Run what the change touches, in both.

1. `npx vite build` compiles.
2. Web: run `npm run dev` in the background and drive http://localhost:5173 with the Playwright MCP tools. `window.__game` and `window.__harness` expose state (HANDOFF.md, "Run and verify").
3. App from source: run `npx electron . --remote-debugging-port=9333` in the background, wait for `curl -s localhost:5199/` to answer, then use `scripts/cdp.mjs` from this skill:
   - `node .claude/skills/parity/scripts/cdp.mjs nav /play/meridian-city?build=1`
   - `node .claude/skills/parity/scripts/cdp.mjs eval "JSON.stringify(window.__game.state)"`
   - `node .claude/skills/parity/scripts/cdp.mjs shot <scratchpad>/app.png`

   Run the same checks you ran in the browser and compare the results. Screenshots need the window visible on screen. If `shot` times out, the window is covered, and `eval` still works.
4. If `desktop/` changed: run `npm run app:install`, then `open "$HOME/Desktop/World Studio.app"`, then `tail ~/Library/Logs/World Studio/main.log`. Expect a `claude CLI:` path and a `Vite ready` line.
5. Clean up: `osascript -e 'quit app "Electron"'` for the source run, `osascript -e 'quit app "World Studio"'` for the installed app, and stop any dev server you started.

Pointer lock, audio and real prompt runs need a person. Name them as unverified and don't guess.

## Report

End with one parity line, for example: "Parity: browser - build mode selection checked with Playwright; app - same check over CDP, matched; installed app rebuilt." If one side wasn't checked, say which one and why.
