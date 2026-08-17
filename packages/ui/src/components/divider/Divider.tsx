// SPDX-License-Identifier: AGPL-3.0-only
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * 1px `--border` rule, horizontal or vertical, with an optional centered
 * label ("or") — research/design-system.md §3 Tier 1.
 */
export const dividerVariants = cva('border-0 bg-border', {
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      vertical: 'w-px self-stretch',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
});

export interface DividerProps
  extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'children'>,
    VariantProps<typeof dividerVariants> {
  /** Centered label (e.g. a localized "or"); horizontal orientation only. */
  label?: React.ReactNode;
}

export function Divider({ className, orientation = 'horizontal', label, ...props }: DividerProps) {
  if (label !== undefined && orientation === 'horizontal') {
    return (
      <div
        role="separator"
        aria-orientation="horizontal"
        className={cn('flex w-full items-center gap-3 text-caption text-fg-subtle', className)}
        {...props}
      >
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        {label}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation ?? 'horizontal'}
      className={cn(dividerVariants({ orientation }), className)}
      {...props}
    />
  );
}
