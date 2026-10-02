import fs from 'node:fs';
import path from 'node:path';
import { _electron, test as base, expect } from '@playwright/test';

// Don't wait for "load": it waits on the Google Fonts stylesheet, which can stall.
export const DOM = { waitUntil: 'domcontentloaded' };
export const ROOT = path.resolve(import.meta.dirname, '..');

// `page` is a browser tab for "web" and the app window for "electron"; `base` is its origin.
export const test = base.extend({
  electronApp: [async ({}, use, info) => {
    if (info.project.name !== 'electron') return use(null);
    const app = await _electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: { ...process.env, DEVCHAT_RUNNER: 'fake', WORLD_STUDIO_ROOT: ROOT, WORLD_STUDIO_ISOLATED: '1' },
    });
    await use(app);
    await app.close();
  }, { scope: 'worker' }],

  page: async ({ page, electronApp }, use) => {
    let p = page;
    if (electronApp) {
      p = await electronApp.firstWindow();
      await p.waitForURL(/^http:\/\/localhost:\d+\//, { timeout: 30_000 });
    }
    // the runtime posts a landing-page thumbnail 4 s after start; keep tests off the real games' thumb.jpg
    await p.route('**/__harness/thumb', (r) => r.fulfill({ json: { ok: true } }));
    await use(p);
  },

  base: async ({ page, baseURL }, use) => {
    if (baseURL) return use(baseURL);
    await use(new URL(page.url()).origin);
  },
});
export { expect };

// Harness API calls from the test process. Not from inside the page: a prompt can reload the
// page before an in-page fetch resolves.
export async function api(pageOrBase, route, body) {
  const base = typeof pageOrBase === 'string' ? pageOrBase : new URL(pageOrBase.url()).origin;
  const res = await fetch(`${base}/__harness${route}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Devchat': '1' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Opens a project in the studio shell and returns the game's frame (where window.__game lives).
export async function openGame(page, base, slug, query = '') {
  await page.goto(`${base}/p/${slug}${query}`, DOM);
  const frame = await gameFrame(page);
  await frame.waitForFunction(() => window.__game?.state, null, { timeout: 30_000, polling: 100 });
  return frame;
}

export async function gameFrame(page) {
  const handle = await page.waitForSelector('iframe[data-testid=game-frame]', { timeout: 30_000 });
  return handle.contentFrame();
}

export const readChat = (slug) => JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/projects', slug, 'chat.json'), 'utf8'));
export const gameFile = (slug, file = 'game.js') => fs.readFileSync(path.join(ROOT, 'games', slug, file), 'utf8');

// Wait for the game's in-place reload inside its frame: the marker set on the old window
// disappears and the new runtime is back up.
export async function waitForReload(frame) {
  await frame.waitForFunction(() => !window.__e2eMarker && window.__game?.state, null, { timeout: 30_000, polling: 100 });
}
export const markWindow = (frame) => frame.evaluate(() => { window.__e2eMarker = true; });

// A throwaway project from the blank template, deleted (moved to .harness/trash) afterwards.
export async function withTempProject(page, base, fn) {
  await page.goto(`${base}/`, DOM);
  const { body } = await api(page, '/projects', { name: `e2e ${Date.now().toString(36)}`, template: 'blank' });
  const slug = body.slug;
  try {
    await fn(slug);
  } finally {
    await expect.poll(async () => (await api(base, `/projects/${slug}/delete`, {})).status, { timeout: 20_000 }).toBe(200);
  }
}
