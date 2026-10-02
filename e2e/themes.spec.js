import { DOM, api, expect, gameFrame, test } from './fixtures.js';

// Themes are a studio setting: the switch in Settings changes the studio page and the game frame,
// live, and is saved to .harness/settings.json (shared with the desktop app).

test('Settings switches the theme for the studio and the game frame', async ({ page, base }) => {
  const before = (await api(base, '/settings')).body.theme;
  try {
    await page.goto(`${base}/`, DOM);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByRole('radio')).toHaveCount(6);
    await dialog.getByTestId('theme-terminal').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'terminal');
    await expect(dialog.getByTestId('theme-terminal')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await api(base, '/settings')).body.theme).toBe('terminal');
    await dialog.getByRole('button', { name: 'Done' }).click();

    await page.goto(`${base}/p/meridian-city?build=1`, DOM);
    const game = await gameFrame(page);
    await game.waitForFunction(() => window.__game?.state === 'build', null, { polling: 100, timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'terminal');
    await expect.poll(() => game.evaluate(() => document.documentElement.dataset.theme)).toBe('terminal');

    // a change made elsewhere (another window, the desktop app) arrives live, in the frame too
    await api(base, '/settings', { theme: 'atlas' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'atlas');
    await expect.poll(() => game.evaluate(() => document.documentElement.dataset.theme)).toBe('atlas');
    await expect.poll(() => game.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Bricolage');
  } finally {
    await api(base, '/settings', { theme: before ?? 'control-room' });
  }
});

test('an unknown theme is refused, and the Ask menu opens the same settings', async ({ page, base }) => {
  expect((await api(base, '/settings', { theme: 'nope' })).status).toBe(400);
  await page.goto(`${base}/p/meridian-city`, DOM);
  await page.locator('.dc-root').waitFor({ state: 'attached' });
  if (!(await page.locator('.dc-root.open').count())) await page.locator('.dc-tab').click(); // remembered per window
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Theme and settings/ }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('radio')).toHaveCount(6);
});
