import type { Project } from '@ws/shared';
import { useState } from 'react';
import { DEV, playUrl, useProjectActions } from '../lib/api.ts';
import { ago, initials } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog.tsx';
import { Field, FormError, Input } from './ui/field.tsx';

export function ProjectCard({ project: p, now }: { project: Project; now: number }) {
  const actions = useProjectActions();
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <>
      <a
        href={playUrl(p.slug)}
        data-testid="project-card"
        className="group relative flex flex-col overflow-hidden rounded-ws-lg border border-line bg-card text-inherit no-underline transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-accent/45"
      >
        <div className="relative aspect-video overflow-hidden bg-[#0c1320]">
          {p.thumb ? (
            <img src={p.thumb} alt="" className="block h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,rgba(60,242,255,0.12),rgba(255,210,74,0.08)),repeating-linear-gradient(0deg,transparent_0_23px,rgba(255,255,255,0.04)_23px_24px),repeating-linear-gradient(90deg,transparent_0_23px,rgba(255,255,255,0.04)_23px_24px)] text-[42px] font-bold tracking-[0.08em] text-ink/25">
              {initials(p.name)}
            </div>
          )}
          {p.running && (
            <span className="absolute left-2.5 top-2.5 bg-accent px-2 py-[3px] text-[11px] font-bold uppercase tracking-[0.14em] text-accent-ink">Working</span>
          )}
        </div>
        <div className="flex flex-col gap-1 px-3.5 pt-3.5 pb-3">
          <div className="text-lg font-bold" data-testid="project-name">
            {p.name}
          </div>
          <div className="text-[13px] text-dim">
            {p.template || 'custom'}
            {p.updated ? ` · edited ${ago(p.updated, now)}` : ''}
          </div>
          {p.description && <div className="mt-1 line-clamp-2 text-[13.5px] leading-[1.45] text-dim">{p.description}</div>}
        </div>
        {DEV && (
          // biome-ignore lint/a11y/noStaticElementInteractions: stops the card link from following clicks on its buttons
          // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside handle keys
          <div className="flex gap-1.5 px-3.5 pb-3.5" onClick={stop}>
            <Button size="sm" variant="quiet" onClick={() => (location.href = playUrl(p.slug, true))}>
              Build
            </Button>
            <Button size="sm" variant="quiet" disabled={actions.duplicate.isPending} onClick={() => actions.duplicate.mutate({ slug: p.slug, name: `${p.name} copy` })}>
              Duplicate
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setDialog('rename')}>
              Rename
            </Button>
            <Button size="sm" variant="quiet" className="hover:border-danger/50 hover:text-danger-text" onClick={() => setDialog('delete')}>
              Delete
            </Button>
          </div>
        )}
      </a>
      {DEV && <RenameDialog project={p} open={dialog === 'rename'} onOpenChange={(o) => setDialog(o ? 'rename' : null)} />}
      {DEV && <DeleteDialog project={p} open={dialog === 'delete'} onOpenChange={(o) => setDialog(o ? 'delete' : null)} />}
    </>
  );
}

function RenameDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { rename } = useProjectActions();
  const [name, setName] = useState(project.name);
  const save = () => rename.mutate({ slug: project.slug, name }, { onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Rename</DialogTitle>
        <DialogDescription className="sr-only">Give “{project.name}” a new name.</DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Name">
            <Input value={name} maxLength={60} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
          </Field>
          <FormError>{rename.error?.message}</FormError>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" size="md" disabled={rename.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { remove } = useProjectActions();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Delete “{project.name}”?</DialogTitle>
        <DialogDescription>
          The project, its chat and its history move to <code>.harness/trash/</code>, so you can still recover it from there.
        </DialogDescription>
        <FormError>{remove.error?.message}</FormError>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Cancel</Button>
          </DialogClose>
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate({ slug: project.slug }, { onSuccess: () => onOpenChange(false) })}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
