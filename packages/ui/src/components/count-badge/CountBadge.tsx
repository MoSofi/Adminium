import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Mono count pill: neutral (surface-3) vs active (solid accent + accent-fg) —
 * research/design-system.md §3 Tier 1. Number formatting is the caller's job.
 */
export const countBadgeVariants = cva(
  'inline-flex h-[18px] min-w-[18px] items-center justify-center whitespace-nowrap rounded-full px-1.5 font-mono text-[10.5px] font-bold leading-none tabular-nums',
  {
    variants: {
      active: {
        true: 'bg-accent text-accent-fg',
        false: 'bg-surface-3 text-fg-muted',
      },
    },
    defaultVariants: { active: false },
  },
);

export interface CountBadgeProps
  extends Omit<React.ComponentPropsWithRef<'span'>, 'style'>,
    VariantProps<typeof countBadgeVariants> {}

export function CountBadge({ className, active, ...props }: CountBadgeProps) {
  return (
    <span
      data-active={active ? '' : undefined}
      className={cn(countBadgeVariants({ active }), className)}
      {...props}
    />
  );
}
