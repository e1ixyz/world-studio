import type * as React from 'react';
import { cn } from '../../lib/utils.ts';

const control =
  'w-full rounded-ws border border-line bg-field px-3 py-[11px] text-[15px] text-ink outline-none placeholder:text-dim/70 focus:border-accent/55';

export function Field({ label, className, children, ...props }: React.ComponentProps<'label'> & { label: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className={cn('mt-5 flex flex-col gap-2', className)} {...props}>
      <span className="text-xs uppercase tracking-[0.2em] text-dim">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-24 resize-y leading-[1.45]', className)} {...props} />;
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-3 text-sm text-danger-text">
      {children}
    </p>
  );
}
