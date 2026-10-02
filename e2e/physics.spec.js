import { api, expect, openGame, test, withTempProject } from './fixtures.js';

// Physics (Rapier) through ctx.physics(): loaded only by games that ask, stepped with the game,
// paused with it, pushed by the player and clickable in build mode.

async function playground(page, base, fn) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const { body } = await api(base, '/projects', { name: `e2e phys ${Date.now().toString(36)}`, template: 'physics-playground' });
  try {
    await fn(body.slug);
  } finally {
    await expect.poll(async () => (await api(base, `/projects/${body.slug}/delete`, {})).status, { timeout: 20_000 }).toBe(200);
  }
}

const ballYs = (game) => game.evaluate(() => window.__game.physics.bodies.filter((b) => b.collider(0).shape.type === 0).map((b) => b.translation().y));

test('the physics playground runs, throws balls and pauses with the world', async ({ page, base }) => {
  await playground(page, base, async (slug) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const game = await openGame(page, base, slug);
    await expect.poll(() => game.evaluate(() => window.__game.physics?.bodies.length ?? 0)).toBeGreaterThan(20);
    await game.evaluate(() => window.__game.start('play'));
    await game.evaluate(() => window.__game.game.onKey('KeyR', window.__game.ctx));
    // the ball flies and falls
    const y0 = (await ballYs(game))[0];
    await expect.poll(async () => (await ballYs(game))[0], { timeout: 10_000 }).toBeLessThan(y0 - 0.5);
    await expect(game.locator('#objective')).toContainText('Crates down');

    // build mode with the world paused: nothing moves
    await game.evaluate(() => window.__game.game.onKey('KeyR', window.__game.ctx));
    await game.evaluate(() => window.__game.setMode('build'));
    await expect.poll(() => game.evaluate(() => window.__game.build.actions.isFrozen())).toBe(true);
    const frozen = await ballYs(game);
    await page.waitForTimeout(600);
    expect(await ballYs(game)).toEqual(frozen);
    expect(errors).toEqual([]);
  });
});

test('the player shoves bodies, and build mode picks them', async ({ page, base }) => {
  await playground(page, base, async (slug) => {
    const game = await openGame(page, base, slug);
    await expect.poll(() => game.evaluate(() => window.__game.physics?.bodies.length ?? 0)).toBeGreaterThan(20);
    await game.evaluate(() => window.__game.start('play'));
    // walk the player through the bottom crate of the tower at x = 8, z = -8
    const moved = await game.evaluate(async () => {
      const g = window.__game;
      const crate = g.physics.bodies.find((b) => Math.abs(b.translation().x - 8) < 0.3 && b.translation().y < 1);
      const before = crate.translation().x;
      for (let i = 0; i < 40; i++) {
        g.player.teleport(6 + i * 0.08, 0, -8, -Math.PI / 2, 0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      return crate.translation().x - before;
    });
    expect(moved).toBeGreaterThan(0.3);

    await game.evaluate(() => window.__game.setMode('build'));
    const kind = await game.evaluate(() => {
      const g = window.__game;
      const crate = g.physics.bodies.find((b) => g.physics.meshOf(b) && Math.abs(b.translation().x + 6) < 0.5);
      const p = crate.translation();
      const ray = new g.ctx.THREE.Raycaster(new g.ctx.THREE.Vector3(p.x, 40, p.z), new g.ctx.THREE.Vector3(0, -1, 0));
      return g.select.pick(ray)?.kind;
    });
    expect(kind).toBe('crate');
  });
});

test('games without physics never load it', async ({ page, base }) => {
  await withTempProject(page, base, async (slug) => {
    const game = await openGame(page, base, slug);
    await page.waitForTimeout(1000);
    expect(await game.evaluate(() => window.__game.physics)).toBeNull();
    expect(await game.evaluate(() => performance.getEntriesByType('resource').some((e) => /rapier/i.test(e.name)))).toBe(false);
  });
});
