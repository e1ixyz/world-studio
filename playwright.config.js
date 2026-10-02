import { defineConfig } from '@playwright/test';

// Two targets, one suite: "web" drives a dev server in Chromium, "electron" drives the desktop
// shell from source. Both use the fake agent (scripts/fake-claude.mjs), so no prompt costs money.
export const WEB_PORT = 5180;

export default defineConfig({
  testDir: 'e2e',
  workers: 1, // tests create and delete projects in the real checkout
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'web', use: { browserName: 'chromium', baseURL: `http://localhost:${WEB_PORT}`, viewport: { width: 1280, height: 800 } } },
    { name: 'electron' },
  ],
  webServer: {
    // a private daemon: no lock, so it runs next to a real one without attaching to it
    command: `node packages/server/src/cli.ts --port ${WEB_PORT} --strict-port --no-lock`,
    url: `http://localhost:${WEB_PORT}/`,
    reuseExistingServer: false,
    env: { DEVCHAT_CLAUDE: 'scripts/fake-claude.mjs' },
  },
});
