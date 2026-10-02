#!/usr/bin/env node
// `bun run export <slug>`: build one game as a standalone static site in exports/<slug>/
// (index.html plus assets, relative paths, no studio, no build mode tools that need the server).
// Host the folder anywhere, or open it with any static file server.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(slug) || !fs.existsSync(path.join(root, 'games', slug, 'game.js'))) {
  const games = fs.readdirSync(path.join(root, 'games')).filter((s) => fs.existsSync(path.join(root, 'games', s, 'game.js')));
  console.error(`Usage: bun run export <slug>\nGames: ${games.join(', ')}`);
  process.exit(1);
}
const outDir = path.join(root, 'exports', slug);
process.env.VITE_WS_GAME = slug; // the runtime plays this game when the URL names none

await build({
  root,
  configFile: path.join(root, 'vite.config.js'),
  base: './',
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true },
  plugins: [
    {
      name: 'ws-export-one-game',
      enforce: 'pre',
      config(config) {
        // only the game runtime, not the studio's landing page
        config.build.rollupOptions.input = { play: path.join(root, 'play.html') };
      },
      // bundle only this game (the production registry globs every game)
      transform(code, id) {
        if (id.endsWith('/engine/registry.prod.js')) return code.replaceAll("'/games/*/", `'/games/${slug}/`);
      },
    },
  ],
});
fs.renameSync(path.join(outDir, 'play.html'), path.join(outDir, 'index.html'));
const size = fs.readdirSync(path.join(outDir, 'assets')).reduce((n, f) => n + fs.statSync(path.join(outDir, 'assets', f)).size, 0);
console.log(`Exported ${slug} to ${path.relative(root, outDir)}/ (${(size / 1024 / 1024).toFixed(1)} MB). Serve the folder statically; index.html starts the game.`);
