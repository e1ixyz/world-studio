import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../../lib/utils.ts';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ws font-semibold uppercase transition-[box-shadow,border-color,color,background] duration-150 ease-ws disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink font-bold tracking-[0.16em] shadow-glow hover:shadow-glow-strong',
        ghost: 'border border-line bg-transparent text-ink tracking-[0.08em] hover:border-accent/50',
        danger: 'bg-danger text-danger-ink font-bold tracking-[0.1em]',
        quiet: 'border border-line bg-transparent text-dim tracking-[0.06em] hover:text-ink hover:border-line-strong',
      },
      size: {
        lg: 'px-[22px] py-[14px] text-[15px]',
        md: 'px-[14px] py-[9px] text-[13px]',
        sm: 'px-[10px] py-[6px] text-xs',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
