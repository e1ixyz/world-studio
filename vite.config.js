import { defineConfig } from 'vite';
import harness from './harness/server/plugin.js';

export default defineConfig({
  appType: 'mpa', // landing page (index.html) and game runtime (play.html); /play/<slug> is rewritten by the plugin
  plugins: [harness()],
  server: {
    port: 5173,
    // the chat sidebar shows errors itself; the full-screen overlay would cover it
    hmr: { overlay: false },
    watch: { ignored: ['**/.harness/**', '**/.devchat/**'] },
  },
  build: {
    rollupOptions: { input: { index: 'index.html', play: 'play.html' } },
  },
});
