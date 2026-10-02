// Studio data access. In dev everything goes through the daemon's typed API; a production build
// has no server, so the project list comes from the game.json files bundled at build time.
import { studioClient } from '@ws/server/client';
import type { GameMeta, Project, Settings, Template } from '@ws/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

export const DEV = import.meta.env.DEV;
export const api = studioClient();

// Navigate in place (never new tabs): the desktop app doesn't open windows.
export const playUrl = (slug: string, build = false) => (DEV ? `/p/${slug}${build ? '?build=1' : ''}` : `play.html?game=${slug}${build ? '&build=1' : ''}`);

async function ok<T>(res: Promise<Response>): Promise<T> {
  const r = await res;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || r.statusText);
  return data as T;
}

async function prodProjects(): Promise<Project[]> {
  const { metas } = (await import('./registry.prod.js')) as { metas: Record<string, GameMeta> };
  return Object.entries(metas).map(([p, m]) => ({
    slug: p.split('/')[2],
    name: m.name || p.split('/')[2],
    template: m.template || '',
    description: m.description || '',
    created: m.created || 0,
    updated: m.updated || 0,
    thumb: null,
    running: false,
  }));
}

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: () => (DEV ? ok<Project[]>(api.projects.$get()) : prodProjects()),
});

// Studio settings (theme, engine edits). In a production build there is no server: the
// remembered theme applies and nothing can be changed.
export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: () => ok<Settings>(api.settings.$get()),
  enabled: DEV,
});

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => ok<Settings>(api.settings.$post({ json: patch })),
    onMutate: (patch) => qc.setQueryData(['settings'], (s: Settings | undefined) => (s ? { ...s, ...patch } : s)),
    onSuccess: (s) => qc.setQueryData(['settings'], s),
    onError: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export const templatesQuery = queryOptions({
  queryKey: ['templates'],
  queryFn: () => ok<Template[]>(api.templates.$get()),
  enabled: DEV,
});

export function useProjectActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['projects'] });
  return {
    create: useMutation({
      mutationFn: (body: { name: string; template: string; description?: string }) => ok<{ slug: string }>(api.projects.$post({ json: body })),
    }),
    rename: useMutation({
      mutationFn: ({ slug, name }: { slug: string; name: string }) => ok(api.projects[':slug'].rename.$post({ param: { slug }, json: { name } })),
      onSuccess: refresh,
    }),
    duplicate: useMutation({
      mutationFn: ({ slug, name }: { slug: string; name: string }) => ok<{ slug: string }>(api.projects[':slug'].duplicate.$post({ param: { slug }, json: { name } })),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: ({ slug }: { slug: string }) => ok(api.projects[':slug'].delete.$post({ param: { slug }, json: {} })),
      onSuccess: refresh,
    }),
  };
}
