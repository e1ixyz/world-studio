// The Vite side of the studio: serves the API inside Vite's middleware stack, rewrites
// /play/<slug> to the game runtime, injects the chat client into play pages, takes over reloads
// for game and engine code, and forwards studio events to open pages as HMR custom events.
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
        // /play/<slug> serves the game runtime
        const m = url.match(/^\/play\/([\w-]+)\/?(\?.*)?$/);
        if (m) req.url = `/play.html${m[2] || ''}`;
        next();
      });
    },
    transformIndexHtml(_html, ctx) {
      if (!ctx.path.startsWith('/play')) return;
      return [{ tag: 'script', attrs: { type: 'module', src: '/harness/client/chat.js' }, injectTo: 'head-prepend' }];
    },
    // Game and engine code reloads are handled by the studio instead of Vite's default full reload:
    // batched while Claude works, and scoped to the tabs that play the changed game.
    hotUpdate({ file }) {
      return studio.reloads.fileChanged(file) === 'pass' ? undefined : [];
    },
    // runs on server.close(): don't leave agent runs behind
    closeBundle() {
      studio.close();
    },
  };
}
