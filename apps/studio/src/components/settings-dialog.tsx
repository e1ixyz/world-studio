// Studio settings: the theme (with a live preview of each) and engine edits. Settings are shared by
// every project and by the browser and the desktop app, so a change shows up everywhere at once.
import { THEMES } from '@ws/theme';
import { useQuery } from '@tanstack/react-query';
import { settingsQuery, useSaveSettings } from '../lib/api.ts';
import { cn } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog.tsx';
import { FormError } from './ui/field.tsx';

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useQuery(settingsQuery);
  const save = useSaveSettings();
  const current = data?.theme ?? 'control-room';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))]">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>These apply to every project, in this browser and in the desktop app.</DialogDescription>

        <fieldset className="mt-6 flex flex-col gap-3">
          <legend className="mb-3 text-xs uppercase tracking-[0.2em] text-dim">Theme</legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              // biome-ignore lint/a11y/useSemanticElements: a card-style choice with radio semantics
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === current}
                data-testid={`theme-${t.id}`}
                onClick={() => save.mutate({ theme: t.id })}
                className={cn('flex flex-col overflow-hidden rounded-ws border border-line bg-card text-left text-ink', t.id === current && 'border-accent ring-2 ring-accent')}
              >
                {/* a tiny studio in the theme's own colors */}
                <span className="relative block h-20" style={{ background: t.swatches[0] }}>
                  <span className="absolute left-2 top-2 bottom-2 w-10" style={{ background: t.swatches[1] }} />
                  <span className="absolute right-2 top-2 bottom-2 w-16" style={{ background: t.swatches[1] }} />
                  <span className="absolute left-16 bottom-3 h-8 w-6" style={{ background: t.swatches[1], outline: `2px solid ${t.swatches[3]}` }} />
                  <span className="absolute right-4 bottom-4 h-2 w-10" style={{ background: t.swatches[2] }} />
                </span>
                <span className="flex flex-col gap-1 p-3">
                  <b className="text-[15px]">{t.name}</b>
                  <small className="text-[12.5px] leading-[1.4] text-dim">{t.blurb}</small>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-6 flex items-start gap-3 rounded-ws border border-line p-3 text-[15px]">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[var(--ws-accent)]"
            checked={!!data?.alwaysEngine}
            onChange={(e) => save.mutate({ alwaysEngine: e.target.checked })}
          />
          <span>
            Always allow engine edits
            <small className="block text-[13px] text-dim">Every prompt, in every project, can change the game and the shared engine.</small>
          </span>
        </label>
        <FormError>{save.error?.message}</FormError>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="primary">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
