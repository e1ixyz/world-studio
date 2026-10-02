import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Shared by the studio daemon (packages/server/src/daemon.ts, which adds the studio plugin and runs
// Vite in middleware mode) and the production build. React, Tailwind and the router only touch
// apps/studio; games and the engine stay plain JavaScript.
export default defineConfig({
  appType: 'mpa', // studio (index.html) and game runtime (play.html); /play/<slug> is rewritten by the studio plugin
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: 'apps/studio/src/routes',
      generatedRouteTree: 'apps/studio/src/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react({ include: /apps\/studio\/src\/.*\.[jt]sx?$/ }),
    tailwindcss(),
  ],
  server: {
    // the chat sidebar shows errors itself; the full-screen overlay would cover it
    hmr: { overlay: false },
    watch: { ignored: ['**/.harness/**', '**/.devchat/**', '**/.tanstack/**'] },
  },
  build: {
    rollupOptions: { input: { index: 'index.html', play: 'play.html' } },
  },
});
