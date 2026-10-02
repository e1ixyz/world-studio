// The daemon's studio-wide event stream (/api/events) keeps queries fresh: a project created,
// renamed or edited anywhere (another tab, the desktop app, an agent run) refetches the list.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { DEV } from './api.ts';

export function useStudioEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!DEV) return;
    const es = new EventSource('/api/events');
    const projects = () => qc.invalidateQueries({ queryKey: ['projects'] });
    es.addEventListener('projects', projects);
    es.addEventListener('job', projects); // the "Working" badge
    es.addEventListener('settings', () => qc.invalidateQueries({ queryKey: ['settings'] }));
    return () => es.close();
  }, [qc]);
}
