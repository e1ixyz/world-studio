// Claude can edit files through this API, so only this machine may call it, and POSTs only from
// this site (a custom header plus a same-host Origin blocks cross-site requests). The daemon also
// rejects non-localhost Host headers before anything gets here.
import type { IncomingMessage } from 'node:http';
import { createMiddleware } from 'hono/factory';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const localOnly = createMiddleware<{ Bindings: { incoming?: IncomingMessage } }>(async (c, next) => {
  const addr = c.env?.incoming?.socket.remoteAddress;
  if (!addr || !LOOPBACK.has(addr)) return c.json({ error: 'World Studio is local-only' }, 403);
  if (c.req.method === 'POST') {
    const origin = c.req.header('origin');
    if (c.req.header('x-devchat') !== '1' || (origin && new URL(origin).host !== c.req.header('host'))) return c.json({ error: 'bad origin' }, 403);
  }
  await next();
});
