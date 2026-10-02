import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { playUrl, templatesQuery, useProjectActions } from '../lib/api.ts';
import { cn } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog.tsx';
import { Field, FormError, Input, Textarea } from './ui/field.tsx';

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: templates = [] } = useQuery({ ...templatesQuery, enabled: open });
  const { create } = useProjectActions();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<string | null>(null);
  const chosen = template ?? templates.find((t) => t.id === 'blank')?.id ?? templates[0]?.id;

  useEffect(() => {
    if (!open) create.reset();
  }, [open, create.reset]);

  const submit = () => {
    if (!name.trim() || !chosen) return;
    create.mutate({ name: name.trim(), template: chosen, description }, { onSuccess: ({ slug }) => (location.href = playUrl(slug, true)) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>Pick a starting point. If you describe the game, a first version is built while it loads.</DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Name">
            <Input autoFocus required placeholder="e.g. Sky Islands" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset className="mt-5 flex flex-col gap-2">
            <legend className="mb-2 text-xs uppercase tracking-[0.2em] text-dim">Template</legend>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5" role="radiogroup">
              {templates.map((t) => (
                // biome-ignore lint/a11y/useSemanticElements: a card-style choice; role and aria-checked make it a radio for assistive tech
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={t.id === chosen}
                  onClick={() => setTemplate(t.id)}
                  className={cn('flex flex-col gap-1 border border-line bg-white/[0.03] p-3 text-left text-ink', t.id === chosen && 'border-accent bg-accent/[0.08]')}
                >
                  <b className="text-[15px]">{t.name}</b>
                  <small className="text-[12.5px] leading-[1.4] text-dim">{t.description}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Describe your game (optional)">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Floating islands connected by rope bridges. Collect crystals before the sun sets; falling off respawns you on the last island."
            />
          </Field>
          <FormError>{create.error?.message}</FormError>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" size="md" disabled={create.isPending || create.isSuccess}>
              {create.isPending || create.isSuccess ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
