import fs from 'node:fs';
import path from 'node:path';
import { DOM, ROOT, api, chatLog, expect, gameFrame, markWindow, openGame, test, waitForReload, withTempProject } from './fixtures.js';

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
    const log = await chatLog(base, slug);
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
    await expect.poll(async () => (await chatLog(base, slug)).some((i) => i.kind === 'done')).toBe(true);
    expect((await chatLog(base, slug)).find((i) => i.kind === 'user').text).toBe('add a lamp post here [noedit]');
  });
});

test('the agent can see the game through the open window', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    await openGame(page, base, slug, '?build=1');
    await page.locator('textarea[aria-label=Prompt]').fill('look at it [view] [noedit]');
    await page.locator('.dc-send').click();
    await expect.poll(async () => (await chatLog(base, slug)).some((i) => i.kind === 'done'), { timeout: 30_000 }).toBe(true);
    const texts = (await chatLog(base, slug)).filter((i) => i.kind === 'text').map((i) => i.text);
    expect(texts.find((t) => t.startsWith('view_game'))).toMatch(/got a image\/jpeg image, \d{4,} base64 chars\. Screenshot of the game view, 1024x\d+/);
    const state = texts.find((t) => t.startsWith('game_state'));
    expect(state).toContain('"running": true');
    expect(state).toContain('"mode": "build"');
    await expect(page.locator('.dc-steps-count').first()).toContainText('steps');
  });
});

for (const allow of [true, false]) {
  test(`a permission card asks before the agent leaves the game folder (${allow ? 'allow' : 'decline'})`, async ({ page, base }) => {
    await withTempProject(page, base, async (slug) => {
      const game = await openGame(page, base, slug);
      await markWindow(game);
      await page.evaluate(() => sessionStorage.clear());
      const { status } = await api(base, `/chat/${slug}/prompt`, { text: 'edit the engine [ask]' });
      expect(status).toBe(200);
      const card = page.getByTestId('permission-card');
      await expect(card).toContainText('Edit engine/core/fake-ask.js');
      await expect(page.locator('.dc-root.open')).toHaveCount(1); // the question opens the panel
      await card.getByRole('button', { name: allow ? 'Allow once' : 'Decline' }).click();
      await expect(card).toContainText(allow ? 'Allowed' : 'Declined');
      await expect.poll(async () => (await chatLog(base, slug)).some((i) => i.kind === 'done')).toBe(true);
      const edited = fs.readFileSync(path.join(ROOT, 'games', slug, 'game.js'), 'utf8').includes('fake-agent');
      expect(edited).toBe(allow);
      if (allow) await waitForReload(game);
    });
  });
}
