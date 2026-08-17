// SPDX-License-Identifier: AGPL-3.0-only
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Input chrome per research/design-system.md §3 Tier 2: radius 10
 * (`rounded-md`), 1px `--border-strong`, `--surface-2` fill, 13px text;
 * focus = accent border + 3px accent-soft ring; error (via `aria-invalid`) =
 * danger border + danger-soft ring; disabled = 40% alpha.
 *
 * Exported so sibling form controls (`Textarea`, `Select`, `DateInput`, …)
 * reuse the exact same chrome through `cn()` overrides.
 */
export const inputVariants = cva(
  'h-[34px] w-full min-w-0 rounded-md border border-border-strong bg-surface-2 px-3 text-[13px] text-fg ' +
    'transition-[border-color,box-shadow] duration-150 placeholder:text-fg-subtle ' +
    'focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger-soft',
  {
    variants: {
      /** JetBrains Mono + tabular numerals for technical values (ids, hosts, tokens). */
      mono: {
        true: 'font-mono tabular-nums',
        false: '',
      },
    },
    defaultVariants: { mono: false },
  },
);

export interface InputProps
  extends Omit<React.ComponentPropsWithRef<'input'>, 'style' | 'size'>,
    VariantProps<typeof inputVariants> {
  /**
   * Error state: danger border + danger focus ring, and sets
   * `aria-invalid="true"` (a consumer-passed `aria-invalid` also styles the
   * same way — `FormField` uses that path).
   */
  error?: boolean | undefined;
}

/**
 * Single-line text input (research/design-system.md §3 Tier 2). Label,
 * captions and describedby/invalid wiring belong to `FormField`.
 */
export function Input({ className, mono, error = false, ...props }: InputProps) {
  return (
    <input
      // Conditional spread (not `aria-invalid={... || undefined}`) so an
      // `aria-invalid` injected by `FormField`'s Slot is never clobbered by
      // an explicit `undefined` key on the child.
      {...(error ? { 'aria-invalid': true as const, 'data-invalid': '' } : {})}
      className={cn(inputVariants({ mono }), className)}
      {...props}
    />
  );
}
