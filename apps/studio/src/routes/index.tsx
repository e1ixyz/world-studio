import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CreateProjectDialog } from '../components/create-project-dialog.tsx';
import { ProjectCard } from '../components/project-card.tsx';
import { Button } from '../components/ui/button.tsx';
import { DEV, projectsQuery } from '../lib/api.ts';

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQuery),
  component: Landing,
});

// Re-render "edited … ago" once a minute.
function useNow(ms = 60_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Landing() {
  const { data: projects = [], error } = useQuery(projectsQuery);
  const [creating, setCreating] = useState(false);
  const now = useNow();
  return (
    <div className="mx-auto max-w-[1180px] px-6 pt-14 pb-20">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-accent">World Studio</div>
          <h1 className="mt-2.5 text-[clamp(40px,7vw,64px)] font-bold leading-[0.95] tracking-[0.02em]">
            Build worlds <span className="tracking-[0.1em] text-transparent [-webkit-text-stroke:1.5px_var(--color-ink)]">live</span>
          </h1>
          <p className="mt-3.5 max-w-[58ch] text-base leading-[1.55] text-dim">
            Every project is its own game on the same engine. Open one, press Tab for build mode, click anything and describe what to change. The game updates where you stand.
          </p>
        </div>
        {DEV && (
          <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </header>
      <h2 className="mt-12 mb-4 text-[13px] uppercase tracking-[0.24em] text-dim">Projects</h2>
      {error ? (
        <p className="text-[15px] text-dim">Couldn't load projects: {error.message}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[18px]">
          {projects.map((p) => (
            <ProjectCard key={p.slug} project={p} now={now} />
          ))}
          {DEV ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="grid min-h-[250px] place-items-center border border-dashed border-accent/40 bg-accent/[0.03] text-[15px] font-bold uppercase tracking-[0.16em] text-accent hover:bg-accent/[0.07]"
            >
              <div>
                <span className="block text-center text-[40px] font-normal">+</span>New project
              </div>
            </button>
          ) : (
            !projects.length && <p className="text-[15px] text-dim">No projects yet.</p>
          )}
        </div>
      )}
      {DEV && <CreateProjectDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}
