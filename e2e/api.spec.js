import { expect, test } from './fixtures.js';

// Contract checks against the daemon's HTTP API. Same for both targets, so web only.
test.describe('studio API', () => {
  test.skip(() => test.info().project.name === 'electron', 'same server code on both');

  const post = (base, route, body, headers = {}) =>
    fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Devchat': '1', ...headers }, body });

  test('is served at /api and /__harness alike', async ({ base }) => {
    const a = await (await fetch(`${base}/api/projects`)).json();
    const b = await (await fetch(`${base}/__harness/projects`)).json();
    expect(a.map((p) => p.slug)).toEqual(b.map((p) => p.slug));
    expect((await (await fetch(`${base}/api/templates`)).json()).map((t) => t.id)).toContain('blank');
  });

  test('rejects cross-site POSTs, bad JSON, bad bodies and unknown projects', async ({ base }) => {
    expect((await post(base, '/api/settings', '{}', { 'X-Devchat': '' })).status).toBe(403);
    expect((await post(base, '/api/settings', '{}', { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(base, '/api/settings', '{nope')).status).toBe(400);
    expect((await post(base, '/api/projects', JSON.stringify({ name: 'x' }))).status).toBe(400); // no template
    expect((await post(base, '/api/projects', JSON.stringify({ name: 'x', template: 'nope' }))).status).toBe(500);
    expect((await post(base, '/api/projects/no-such-game/rename', '{}')).status).toBe(404);
    expect((await fetch(`${base}/api/chat/no-such-game/checkpoints`)).status).toBe(404);
    expect((await post(base, '/api/tweaks', JSON.stringify({ slug: 'no-such-game', values: {} }))).status).toBe(404);
  });

  test('/api/events streams studio events', async ({ base }) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body.getReader();
    const { slug } = await (await post(base, '/api/projects', JSON.stringify({ name: 'e2e events', template: 'blank' }))).json();
    let text = '';
    const deadline = Date.now() + 5000;
    while (!text.includes('event: projects') && Date.now() < deadline) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    expect(text).toContain('event: projects');
    expect((await post(base, `/api/projects/${slug}/delete`, '')).status).toBe(200); // empty body is {}
  });
});
