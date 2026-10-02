// Compile-time check that the typed client sees the API's routes and bodies.
import { studioClient } from './client.ts';

const c = studioClient('http://localhost:5173');
export async function typecheckOnly() {
  const projects = await (await c.projects.$get()).json();
  projects.map((p) => p.slug.toUpperCase());
  await c.projects.$post({ json: { name: 'x', template: 'blank' } });
  await c.chat[':slug'].prompt.$post({ param: { slug: 'x' }, json: { text: 'hi' } });
  // @ts-expect-error template is required
  await c.projects.$post({ json: { name: 'x' } });
}
