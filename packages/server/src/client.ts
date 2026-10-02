// Typed client for the studio API, for TypeScript callers (the coming React shell and tests).
// Requests carry the X-Devchat header the API requires on POSTs.
import { hc } from 'hono/client';
import type { ApiType } from './app.ts';

export function studioClient(origin = '') {
  return hc<ApiType>(`${origin}/api`, { headers: { 'X-Devchat': '1' } });
}
export type StudioClient = ReturnType<typeof studioClient>;
