// SPDX-License-Identifier: AGPL-3.0-only
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Mini chip, 10px/700, radius 6px (`rounded-sm`); tones as soft-bg +
 * strong-fg; `mono` variant for schema/type chips (`varchar`, `int8`, PK/FK,
 * HTTP methods, PDF/CSV/XLSX) — research/design-system.md §3 Tier 1.
 */
export const tagVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-[3px] text-[10px] font-bold leading-none', {
  variants: {
    tone: {
      neutral: 'bg-surface-3 text-fg-muted',
      accent: 'bg-accent-soft text-accent',
      pos: 'bg-pos-soft text-pos',
      warn: 'bg-warn-soft text-warn',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
    },
    mono: {
      true: 'font-mono font-semibold tabular-nums',
      false: '',
    },
  },
  defaultVariants: { tone: 'neutral', mono: false },
});

interface TagBaseProps
  extends Omit<React.ComponentPropsWithRef<'span'>, 'style'>,
    VariantProps<typeof tagVariants> {
  /**
   * Merge classes/props into the single child element (Radix Slot). Not
   * compatible with `onRemove` (the remove button needs the span wrapper).
   */
  asChild?: boolean;
}

export type TagProps = TagBaseProps &
  (
    | {
        /** Renders a keyboard-accessible ✕ button that calls this handler. */
        onRemove: () => void;
        /** Accessible name for the ✕ button (required with `onRemove`). */
        removeLabel: string;
      }
    | { onRemove?: never; removeLabel?: never }
  );

export function Tag({ className, tone, mono, asChild = false, onRemove, removeLabel, children, ...props }: TagProps) {
  const classes = cn(tagVariants({ tone, mono }), className);

  if (asChild) {
    return (
      <Slot data-tone={tone ?? 'neutral'} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <span data-tone={tone ?? 'neutral'} className={classes} {...props}>
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="nb-ib -me-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <X aria-hidden="true" className="size-2.5" />
        </button>
      ) : null}
    </span>
  );
}
