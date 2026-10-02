import fs from 'node:fs';
import path from 'node:path';
import { DOM, ROOT, expect, gameFrame, markWindow, openGame, test, waitForReload, withTempProject } from './fixtures.js';

// The project shell: the game in a frame, the Ask panel beside it, the bridge between them.

test('a game opened on its own goes to its project shell', async ({ page, base }) => {
  await page.goto(`${base}/play/meridian-city?build=1`, DOM);
  await page.waitForURL(`${base}/p/meridian-city?build=1`);
  const game = await gameFrame(page);
  await game.waitForFunction(() => window.__game?.state === 'build', null, { polling: 100, timeout: 30_000 });
  await expect(page).toHaveTitle(/Meridian City · World Studio/);
});

test('backtick in the game toggles the Ask panel, and build mode opens it', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug, '?build=1');
    await expect(page.locator('.dc-root.open')).toHaveCount(1); // build mode opens the panel
    await page.locator('.dc-close').click();
    await expect(page.locator('.dc-root.open')).toHaveCount(0);
    // keys typed while the game has focus go through the bridge
    await page.getByTestId('game-frame').focus();
    await game.waitForFunction(() => document.hasFocus(), null, { polling: 100 });
    await page.keyboard.press('Backquote');
    await expect(page.locator('.dc-root.open')).toHaveCount(1);
    await expect(page.locator('textarea[aria-label=Prompt]')).toBeFocused();
  });
});

test('the chat survives a game crash and offers a fix', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug, '?build=1');
    await markWindow(game);
    const file = path.join(ROOT, 'games', slug, 'game.js');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\nthrow new Error('e2e crash');\n`);
    await game.waitForFunction(() => !window.__e2eMarker, null, { polling: 100, timeout: 30_000 });
    const card = page.locator('.dc-error', { hasText: 'e2e crash' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Fix it' })).toBeVisible();
    await expect(page.locator('.dc-root.open')).toHaveCount(1);
  });
});

test('a prompt sent from the panel carries the selection and the game reloads in place', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug, '?build=1');
    await game.evaluate(() => window.__game.select.select(window.__game.select.items[0]));
    await expect(page.locator('.dc-chip-sel')).toContainText('ground');
    await markWindow(game);
    await page.locator('textarea[aria-label=Prompt]').fill('make the ground shiny');
    await page.locator('.dc-send').click();
    await waitForReload(game);
    await expect(page.locator('.dc-user')).toContainText('make the ground shiny');
    await expect(page.locator('.dc-user .dc-with')).toHaveText('with selection');
    const log = JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/projects', slug, 'chat.json'), 'utf8')).log;
    expect(log.find((i) => i.kind === 'user').text).toContain('[with selection]');
    // the checkpoint list shows what the prompt changed
    await page.getByRole('tab', { name: 'Checkpoints' }).click();
    await expect(page.locator('.dc-cp-meta').first()).toContainText('1 file');
  });
});

test("build mode's Projects link leaves the shell, not just the frame", async ({ page, base }) => {
  const game = await openGame(page, base, 'meridian-city', '?build=1');
  await game.locator('.ws-back').click();
  await page.waitForURL(`${base}/`);
  await expect(page.getByTestId('project-card').first()).toBeVisible();
});

test('Enter in play mode opens the quick prompt bar inside the game, and it sends', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug);
    await game.evaluate(() => window.__game.start('play'));
    await expect.poll(() => game.evaluate(() => window.__game.state)).toBe('play');
    await page.getByTestId('game-frame').focus();
    await game.waitForFunction(() => document.hasFocus(), null, { polling: 100 });
    await page.keyboard.press('Enter');
    const bar = game.locator('.dc-quick.open input');
    await expect(bar).toBeFocused();
    await bar.fill('add a lamp post here [noedit]');
    await bar.press('Enter');
    await expect(game.locator('.dc-quick.open')).toHaveCount(0);
    await expect(page.locator('.dc-feed.show')).toContainText(/Sent: add a lamp post|Read|Done/);
    const log = () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/projects', slug, 'chat.json'), 'utf8')).log;
      } catch {
        return []; // not written yet
      }
    };
    await expect.poll(() => log().some((i) => i.kind === 'done')).toBe(true);
    expect(log().find((i) => i.kind === 'user').text).toBe('add a lamp post here [noedit]');
  });
});
