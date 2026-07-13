import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Square icon button, radius 10 (`rounded-md`), sizes 28/32/34/38px. Hover →
 * surface-3, active scale .9 via the tokens `.nb-ib` interaction class
 * (research/design-system.md §3 Tier 1).
 */
export const iconButtonVariants = cva(
  'nb-ib inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
    'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        bordered: 'border border-border-strong bg-surface',
        ghost: '',
      },
      size: {
        sm: 'size-7',
        md: 'size-8',
        lg: 'size-[34px]',
        xl: 'size-[38px]',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface IconButtonProps
  extends Omit<React.ComponentPropsWithRef<'button'>, 'style' | 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  /** Required accessible name (icon-only control) — rendered as `aria-label`. */
  label: string;
  /** Merge classes/props into the single child element (Radix Slot). */
  asChild?: boolean;
}

export function IconButton({ className, variant, size, label, asChild = false, children, ...props }: IconButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      {...(asChild ? {} : { type: 'button' as const })}
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Comp>
  );
}
