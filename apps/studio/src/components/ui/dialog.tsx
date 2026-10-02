import { Dialog as D } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../../lib/utils.ts';

export const Dialog = D.Root;
export const DialogClose = D.Close;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-10 bg-[rgba(3,6,12,0.72)] backdrop-blur-[6px]" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-10 max-h-[calc(100vh-32px)] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-line bg-surface p-7 shadow-dialog focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn('text-[26px] font-bold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn('mt-1.5 text-sm leading-normal text-dim', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-6 flex justify-end gap-2.5', className)} {...props} />;
}
