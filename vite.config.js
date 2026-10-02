import { defineConfig } from 'vite';

// Shared by the studio daemon (packages/server/src/daemon.ts, which adds the studio plugin and runs
// Vite in middleware mode) and the production build.
export default defineConfig({
  appType: 'mpa', // landing page (index.html) and game runtime (play.html); /play/<slug> is rewritten by the studio plugin
  server: {
    // the chat sidebar shows errors itself; the full-screen overlay would cover it
    hmr: { overlay: false },
    watch: { ignored: ['**/.harness/**', '**/.devchat/**'] },
  },
  build: {
    rollupOptions: { input: { index: 'index.html', play: 'play.html' } },
  },
});
