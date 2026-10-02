import { expect, gameFile, openGame, test, withTempProject } from './fixtures.js';

// Build mode's panels are studio UI over the game frame; they drive the game through the bridge.

test('the Properties panel shows the selection and drives the game', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug, '?build=1');
    await expect(page.locator('.ws-top')).toBeVisible();
    await expect(page.locator('.ws-proj')).toContainText('e2e');
    await expect(page.locator('.ws-sel.empty')).toBeVisible();

    await game.evaluate(() => window.__game.select.select(window.__game.select.items[0]));
    const card = page.getByTestId('selection-card');
    await expect(card.locator('h3')).toHaveText('Ground');
    await expect(card).toContainText('size');
    await card.getByRole('button', { name: /Deselect/ }).click();
    await expect.poll(() => game.evaluate(() => window.__game.select.selected)).toBeNull();
    // a click on a panel button hands the keyboard back to the game
    await expect.poll(() => game.evaluate(() => document.hasFocus())).toBe(true);

    const frozen = await game.evaluate(() => window.__game.build.actions.isFrozen());
    await page.locator('.ws-pause').click();
    await expect.poll(() => game.evaluate(() => window.__game.build.actions.isFrozen())).toBe(!frozen);
    await expect(page.locator('.ws-pause')).toHaveText(frozen ? /Pause world/ : /Resume world/);

    await page.locator('.ws-time input').fill('6');
    await expect.poll(() => game.evaluate(() => Math.round(window.__game.env.time))).toBe(6);
    await expect(page.locator('.ws-time output')).toHaveText('06:00');
  });
});

test('tweaks change the game live and save to tweaks.json', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug, '?build=1');
    const row = page.locator('.ws-tweak.t-color').first();
    const key = await row.getAttribute('data-key');
    await row.locator('input').fill('#336699');
    await expect.poll(() => game.evaluate((k) => window.__game.tweaks.get(k), key)).toBe('#336699');
    await expect(page.locator('.ws-unsaved')).toHaveText('1 unsaved change');
    await page.locator('.ws-save').click();
    await expect(page.locator('.ws-tw-foot')).toHaveCount(0);
    expect(JSON.parse(gameFile(slug, 'tweaks.json'))).toEqual({ [key]: '#336699' });
    await row.getByRole('button', { name: /Reset/ }).click();
    await expect.poll(() => game.evaluate((k) => window.__game.tweaks.get(k), key)).not.toBe('#336699');
  });
});

test('the mode switch and Test from here leave build mode', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug, '?build=1');
    await page.getByRole('radio', { name: 'Play' }).click();
    await expect.poll(() => game.evaluate(() => window.__game.state)).toBe('play');
    await expect(page.locator('.ws-top')).toHaveCount(0);
    await game.evaluate(() => window.__game.setMode('build'));
    await expect(page.locator('.ws-top')).toBeVisible();
    await page.locator('.ws-test').click();
    await expect.poll(() => game.evaluate(() => window.__game.state)).toBe('play');
  });
});

test('the shortcuts sheet and the first-run tips', async ({ page, base }) => {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('worldstudio:build-tips-seen'));
  await openGame(page, base, 'meridian-city', '?build=1');
  await expect(page.locator('.ws-tips')).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.ws-tips')).toHaveCount(0);
  await page.locator('.ws-hint').getByRole('button', { name: 'Shortcuts' }).click(); // the top bar's icon hides at this width
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});
