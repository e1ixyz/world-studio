// The Vite side of the studio: serves the API inside Vite's middleware stack, rewrites
// /play/<slug> to the game runtime, injects the bridge agent into play pages, takes over reloads
// for game and engine code, and forwards studio events to open pages as HMR custom events.
// Projects open at /p/<slug>: the studio shell (apps/studio) with the game framed at
// /play/<slug>?embed=1, which gets the bridge agent (packages/bridge/src/game-agent.ts).
import { getRequestListener } from '@hono/node-server';
import type { Plugin } from 'vite';
import { createApp } from '../app.ts';
import type { Studio } from '../studio.ts';

export function studioPlugin(studio: Studio): Plugin {
  return {
    name: 'world-studio',
    apply: 'serve',
    configureServer(server) {
      const send = (event: string, data: unknown) => server.environments.client.hot.send({ type: 'custom', event, data });
      studio.events.on('projects', () => send('harness:projects', {}));
      studio.events.on('reload', (scope) => send('harness:reload', scope));
      studio.events.on('settings', (s) => send('harness:settings', s));
      studio.setInvalidator({
        invalidateFiles(files) {
          for (const env of Object.values(server.environments)) {
            for (const file of files) for (const m of env.moduleGraph.getModulesByFile(file) || []) env.moduleGraph.invalidateModule(m);
          }
        },
        invalidateAll() {
          for (const env of Object.values(server.environments)) env.moduleGraph.invalidateAll();
        },
      });
      const api = getRequestListener(createApp(studio).fetch);
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url.startsWith('/__harness/') || url.startsWith('/api/')) return void api(req, res);
        // /p/<slug>: the studio's project shell (a client-side route of index.html)
        if (/^\/p\/[\w-]+\/?(\?.*)?$/.test(url)) {
          req.url = '/index.html';
          return next();
        }
        // /play/<slug>?embed=1 serves the game runtime inside the shell's frame. Opened on its own,
        // a game goes to its project shell, so the Ask panel is always there.
        const m = url.match(/^\/play\/([\w-]+)\/?(\?.*)?$/);
        if (m) {
          const query = new URLSearchParams(m[2]?.slice(1) || '');
          if (!query.has('embed')) {
            res.statusCode = 302;
            res.setHeader('Location', `/p/${m[1]}${m[2] || ''}`);
            return void res.end();
          }
          req.url = `/play.html${m[2] || ''}`;
        }
        next();
      });
    },
    transformIndexHtml(_html, ctx) {
      if (!ctx.path.startsWith('/play')) return;
      // before the game, so it keeps working if the game crashes
      return [{ tag: 'script', attrs: { type: 'module', src: '/packages/bridge/src/game-agent.ts' }, injectTo: 'head-prepend' }];
    },
    // Game and engine code reloads are handled by the studio instead of Vite's default full reload:
    // batched while Claude works, and scoped to the tabs that play the changed game.
    hotUpdate({ file }) {
      return studio.reloads.fileChanged(file) === 'pass' ? undefined : [];
    },
    // runs on server.close(): don't leave agent runs behind
    closeBundle() {
      return studio.close();
    },
  };
}
