import fs from 'node:fs';
import path from 'node:path';
import { DOM, ROOT, api, expect, gameFile, markWindow, openGame, readChat, test, waitForReload, withTempProject } from './fixtures.js';

const GAMES = ['meridian-city', 'cyberpunk-city', 'medieval-village'];

test('landing page lists the projects', async ({ page, base }) => {
  await page.goto(`${base}/`, DOM);
  const { body } = await api(page, '/projects');
  for (const slug of GAMES) expect(body.map((p) => p.slug)).toContain(slug);
  await expect(page.getByTestId('project-name').filter({ hasText: 'Meridian City' })).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(body.length);
});

test('landing page creates, renames and deletes projects', async ({ page, base }) => {
  const name = `e2e ui ${Date.now().toString(36)}`;
  await page.goto(`${base}/`, DOM);
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('radio', { name: /Blank/ }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/play\/e2e-ui-[a-z0-9]+\?build=1$/);
  const slug = new URL(page.url()).pathname.split('/')[2];
  await page.waitForFunction(() => window.__game?.state === 'build', null, { polling: 100 });

  await page.goto(`${base}/`, DOM);
  const card = page.getByTestId('project-card').filter({ hasText: name });
  await card.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(`${name} renamed`);
  await page.getByRole('button', { name: 'Save' }).click();
  const renamed = page.getByTestId('project-card').filter({ hasText: `${name} renamed` });
  await expect(renamed).toBeVisible();

  await renamed.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(renamed).toHaveCount(0);
  expect((await api(base, '/projects')).body.map((p) => p.slug)).not.toContain(slug);
});

test('the project list updates live when something changes elsewhere', async ({ page, base }) => {
  await page.goto(`${base}/`, DOM);
  await expect(page.getByTestId('project-card').first()).toBeVisible();
  await withTempProject(page, base, async (slug) => {
    const connected = page.waitForResponse((r) => r.url().endsWith('/api/events'));
    await page.goto(`${base}/`, DOM);
    await connected;
    await api(base, `/projects/${slug}/rename`, { name: 'Renamed from elsewhere' });
    await expect(page.getByTestId('project-name').filter({ hasText: 'Renamed from elsewhere' })).toBeVisible();
  });
});

for (const slug of GAMES) {
  test(`${slug} boots and renders`, async ({ page, base }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openGame(page, base, slug, '?build=1');
    await expect.poll(() => page.evaluate(() => window.__game.state)).toBe('build');
    const f0 = await page.evaluate(() => window.__game.app.renderer.info.render.frame);
    await expect.poll(() => page.evaluate(() => window.__game.app.renderer.info.render.frame), { timeout: 10_000 }).toBeGreaterThan(f0 + 5);
    expect(errors).toEqual([]);
  });
}

test('build mode selection describes what was picked', async ({ page, base }) => {
  await openGame(page, base, 'meridian-city', '?build=1');
  const text = await page.evaluate(() => {
    const { select } = window.__game;
    const e = select.items.find((i) => i.kind === 'building') || select.items[0];
    select.select(e);
    return window.__harness.getSelection();
  });
  expect(text).toMatch(/^\[Selected object: \w+.* centered at x=-?[\d.]+, y=-?[\d.]+, z=-?[\d.]+, size [\d.]+ x [\d.]+ x [\d.]+ m/);
});

test('tweak save writes tweaks.json', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    await openGame(page, base, slug, '?build=1');
    const key = await page.evaluate(() => [...window.__game.tweaks.defs.values()].find((d) => !d.engine && d.save !== false)?.key);
    expect(key).toBeTruthy();
    const res = await api(page, '/tweaks', { slug, values: { [key]: '#123456' } });
    expect(res.status).toBe(200);
    expect(JSON.parse(gameFile(slug, 'tweaks.json'))).toEqual({ [key]: '#123456' });
  });
});

test('a prompt checkpoints, edits, reloads in place, and restore undoes it', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    await openGame(page, base, slug, '?build=1');
    await markWindow(page);
    const res = await api(page, `/chat/${slug}/prompt`, { text: 'make it rain' });
    expect(res.status).toBe(200);
    await waitForReload(page);
    await expect(page.locator('#toast')).toContainText('Changes applied');
    expect(await page.evaluate(() => window.__game.state)).toBe('build');
    expect(gameFile(slug)).toContain('// fake-agent: make it rain');

    // the chat panel shows the turn
    await expect(page.locator('.dc-msg', { hasText: 'make it rain' }).first()).toBeAttached();
    const { body: cps } = await api(page, `/chat/${slug}/checkpoints`);
    expect(cps).toHaveLength(1);
    expect(cps[0]).toMatchObject({ prompt: 'make it rain', files: 1, additions: 1, deletions: 0 });
    const { body: diff } = await api(page, `/chat/${slug}/checkpoints/${cps[0].id}/diff`);
    expect(diff.files).toEqual([{ path: 'game.js', additions: 1, deletions: 0 }]);
    expect(diff.patch).toContain('+// fake-agent: make it rain');

    await markWindow(page);
    expect((await api(page, `/chat/${slug}/restore`, { id: cps[0].id })).status).toBe(200);
    await waitForReload(page);
    expect(gameFile(slug)).not.toContain('fake-agent');
    const { body: after } = await api(page, `/chat/${slug}/checkpoints`);
    expect(after[0].prompt).toBe('Before restoring: make it rain');
  });
});

test('edits outside the game are reported as blocked', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    await page.goto(`${base}/`, DOM);
    await api(page, `/chat/${slug}/prompt`, { text: 'touch the engine [deny] [noedit]' });
    await expect.poll(() => {
      try {
        return readChat(slug).log.map((i) => i.kind);
      } catch {
        return [];
      }
    }).toContain('done');
    const blocked = readChat(slug).log.find((i) => i.kind === 'status' && i.text.startsWith('Blocked edits outside this game'));
    expect(blocked?.text).toContain('engine/core/app.js');
  });
});

test('a second prompt while one runs is refused', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    await page.goto(`${base}/`, DOM);
    expect((await api(page, `/chat/${slug}/prompt`, { text: 'slow one [slow] [noedit]' })).status).toBe(200);
    expect((await api(page, `/chat/${slug}/prompt`, { text: 'again' })).status).toBe(409);
    expect((await api(page, `/projects/${slug}/delete`, {})).status).toBe(409);
  });
});

test('engine reloads are scoped: a game edit reloads only that game', async ({ page, base, context }, info) => {
  test.skip(info.project.name === 'electron', 'the app has one window');
  test.setTimeout(120_000);
  await withTempProject(page, base, async (slug) => {
    const other = await context.newPage();
    await test.step('open meridian', () => openGame(other, base, 'meridian-city', '?build=1'));
    await markWindow(other);
    await test.step('open temp', () => openGame(page, base, slug, '?build=1'));
    await markWindow(page);
    await api(page, `/chat/${slug}/prompt`, { text: 'scoped edit' });
    await test.step('wait reload', () => waitForReload(page));
    expect(await other.evaluate(() => window.__e2eMarker)).toBe(true);
    await other.close();
  });
});

test('production build has no harness code', async ({}, info) => {
  test.skip(info.project.name === 'electron', 'build output is the same for both');
  const dist = path.join(ROOT, 'dist/assets');
  test.skip(!fs.existsSync(dist), 'run `npx vite build` first');
  for (const f of fs.readdirSync(dist).filter((f) => f.endsWith('.js'))) {
    expect(fs.readFileSync(path.join(dist, f), 'utf8')).not.toContain('/__harness/chat');
  }
});
