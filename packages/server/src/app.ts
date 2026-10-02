// The studio HTTP API (Hono). Served at /__harness/* (what the current clients call) and at /api/*
// (the typed client and the coming React shell).
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  CreateProjectBody,
  DuplicateBody,
  ImageBody,
  PromptBody,
  RenameBody,
  RestoreBody,
  SettingsBody,
  TweaksBody,
} from '@ws/shared';
import { z } from 'zod';
import { BusyError } from './domain/chat.ts';
import { firstBuildPrompt } from './domain/prompts.ts';
import { body } from './middleware/body.ts';
import { localOnly } from './middleware/local-only.ts';
import type { Studio } from './studio.ts';

const Empty = z.object({}).loose();
const decodeImage = (data: string) => Buffer.from(String(data).replace(/^data:image\/\w+;base64,/, ''), 'base64');

export function createApi(studio: Studio) {
  const { projects, chats, settings, checkpoints, events } = studio;

  const project = new Hono()
    .post('/rename', body(RenameBody), (c) => {
      projects.rename(c.req.param('slug') as string, c.var.body.name);
      return c.json({ ok: true });
    })
    .post('/duplicate', body(DuplicateBody), (c) => c.json({ slug: projects.duplicate(c.req.param('slug') as string, c.var.body.name) }))
    .post('/delete', body(Empty), (c) => {
      const slug = c.req.param('slug') as string;
      chats.forget(slug); // throws BusyError while a job runs
      projects.trash(slug);
      return c.json({ ok: true });
    });

  const chat = new Hono()
    .get('/events', (c) => {
      const slug = c.req.param('slug') as string;
      const since = Number(c.req.header('last-event-id') || c.req.query('since') || 0);
      return streamSSE(c, async (stream) => {
        let done: () => void = () => {};
        const closed = new Promise<void>((r) => {
          done = r;
        });
        const unsubscribe = chats.subscribe(slug, since, (item) => void stream.writeSSE({ id: String(item.seq ?? 0), data: JSON.stringify(item) }), done);
        const ping = setInterval(() => void stream.write(': ping\n\n'), 20000);
        stream.onAbort(done);
        await closed;
        clearInterval(ping);
        unsubscribe();
      });
    })
    .get('/checkpoints', (c) => c.json(checkpoints.list(c.req.param('slug') as string)))
    .get('/checkpoints/:id/diff', (c) => {
      const d = checkpoints.diff?.(c.req.param('slug') as string, c.req.param('id'));
      return d ? c.json(d) : c.json({ error: 'No diff for this checkpoint' }, 404);
    })
    .post('/prompt', body(PromptBody), (c) => {
      const text = c.var.body.text.trim();
      if (!text) return c.json({ error: 'empty prompt' }, 400);
      chats.prompt(c.req.param('slug') as string, text, { display: String(c.var.body.display || text), engine: !!c.var.body.engine });
      return c.json({ ok: true });
    })
    .post('/stop', body(Empty), (c) => {
      chats.stop(c.req.param('slug') as string);
      return c.json({ ok: true });
    })
    .post('/reset', body(Empty), (c) => {
      chats.reset(c.req.param('slug') as string);
      return c.json({ ok: true });
    })
    .post('/restore', body(RestoreBody), (c) => {
      chats.restore(c.req.param('slug') as string, c.var.body.id);
      return c.json({ ok: true });
    });

  const requireProject = (slugOf: (c: any) => string) =>
    async (c: any, next: () => Promise<void>) => {
      if (!projects.exists(slugOf(c))) return c.json({ error: 'No such project' }, 404);
      await next();
    };

  const api = new Hono()
    .use(localOnly)
    .get('/settings', (c) => c.json(settings.get()))
    .post('/settings', body(SettingsBody), (c) => c.json(settings.update(c.var.body)))
    .get('/projects', (c) => c.json(projects.list()))
    .post('/projects', body(CreateProjectBody), (c) => {
      const { slug, templateName } = projects.create(c.var.body);
      const description = c.var.body.description?.trim();
      if (description) chats.prompt(slug, firstBuildPrompt(slug, templateName, description), { display: description });
      return c.json({ slug });
    })
    .use('/projects/:slug/*', requireProject((c) => c.req.param('slug')))
    .route('/projects/:slug', project)
    .get('/templates', (c) => c.json(projects.templates()))
    .use('/chat/:slug/*', requireProject((c) => c.req.param('slug')))
    .route('/chat/:slug', chat)
    .post('/shot', body(ImageBody), requireProject((c) => c.var.body.slug), (c) => c.json({ path: projects.saveShot(c.var.body.slug, decodeImage(c.var.body.data)) }))
    .post('/thumb', body(ImageBody), requireProject((c) => c.var.body.slug), (c) => {
      projects.saveThumb(c.var.body.slug, decodeImage(c.var.body.data));
      return c.json({ ok: true });
    })
    .post('/tweaks', body(TweaksBody), requireProject((c) => c.var.body.slug), (c) => {
      projects.saveTweaks(c.var.body.slug, c.var.body.values);
      return c.json({ ok: true });
    })
    // Studio-wide stream: projects, settings, reloads and job state, for clients outside Vite's HMR.
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        const send = (event: string) => (data: unknown) => void stream.writeSSE({ event, data: JSON.stringify(data ?? {}) });
        const handlers = { projects: send('projects'), reload: send('reload'), settings: send('settings'), job: send('job') } as const;
        for (const [k, fn] of Object.entries(handlers)) events.on(k as keyof typeof handlers, fn as any);
        const ping = setInterval(() => void stream.write(': ping\n\n'), 20000);
        await new Promise<void>((r) => stream.onAbort(r));
        clearInterval(ping);
        for (const [k, fn] of Object.entries(handlers)) events.off(k as keyof typeof handlers, fn as any);
      }),
    );

  api.onError((err, c) => {
    if (err instanceof BusyError) return c.json({ error: err.message }, 409);
    return c.json({ error: err.message }, 500);
  });
  api.notFound((c) => c.json({ error: 'Not found' }, 404));
  return api;
}

export type ApiType = ReturnType<typeof createApi>;

export function createApp(studio: Studio) {
  const api = createApi(studio);
  return new Hono().route('/__harness', api).route('/api', api);
}
