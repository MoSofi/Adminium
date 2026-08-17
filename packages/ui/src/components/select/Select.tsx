// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronDown } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { inputVariants } from '../input/index.js';

export interface SelectProps extends Omit<React.ComponentPropsWithRef<'select'>, 'style' | 'size'> {
  /** Danger border + focus ring + `aria-invalid`. */
  error?: boolean | undefined;
  /** JetBrains Mono value (enum/technical values). */
  mono?: boolean | undefined;
  /** Extra classes for the positioning wrapper (className styles the `<select>`). */
  wrapperClassName?: string | undefined;
}

/**
 * Native `<select>` in the Input chrome with a chevron-down affordance
 * (research/design-system.md §3 Tier 2). Kept native for plain forms —
 * searchable/rich cases (avatar rows, empty state) are `Combobox`.
 * Children are regular `<option>`/`<optgroup>` elements.
 */
export function Select({ className, wrapperClassName, error = false, mono = false, children, ...props }: SelectProps) {
  return (
    <span className={cn('relative inline-block w-full', wrapperClassName)}>
      <select
        {...(error ? { 'aria-invalid': true as const, 'data-invalid': '' } : {})}
        className={cn(
          inputVariants({ mono }),
          'cursor-pointer appearance-none pe-8',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
      />
    </span>
  );
}
