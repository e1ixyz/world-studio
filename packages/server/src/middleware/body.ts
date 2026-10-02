// JSON body parsing that matches the old harness: an empty body is {}, bad JSON is a 400, and the
// result is checked against a zod schema. Typed as a json validator, so the hono/client sees the
// request body's shape.
import type { MiddlewareHandler } from 'hono';
import type { z } from 'zod';

export const MAX_BODY = 20e6;

type BodyEnv<S extends z.ZodType> = { Variables: { body: z.output<S> } };
type BodyInput<S extends z.ZodType> = { in: { json: z.input<S> }; out: { json: z.output<S> } };

export function body<S extends z.ZodType>(schema: S): MiddlewareHandler<BodyEnv<S>, string, BodyInput<S>> {
  return async (c, next) => {
    const text = await c.req.text();
    if (text.length > MAX_BODY) return c.json({ error: 'too large' }, 413);
    let data: unknown;
    try {
      data = JSON.parse(text || '{}');
    } catch {
      return c.json({ error: 'bad json' }, 400);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    c.set('body', parsed.data);
    await next();
  };
}
