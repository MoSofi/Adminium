import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export type CheckboxProps = Omit<
  React.ComponentPropsWithRef<typeof CheckboxPrimitive.Root>,
  'style' | 'asChild'
>;

/**
 * Checkbox — Radix checkbox, 18px square, radius 6 (`rounded-sm`), accent
 * fill + white check when checked, `Minus` glyph when `indeterminate`
 * (research/design-system.md §3 Tier 2).
 *
 * Indeterminate is the Radix contract: pass `checked="indeterminate"`
 * (controlled). Label + caption wiring belongs to `FormField` / `Label`.
 */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'group inline-flex size-[18px] shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface-2 ',
        'transition-[background-color,border-color,box-shadow] duration-150 ',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft focus-visible:border-accent ',
        'disabled:pointer-events-none disabled:opacity-40 ',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg ',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg ',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="size-3 group-data-[state=indeterminate]:hidden"
        />
        <Minus
          aria-hidden="true"
          strokeWidth={3}
          className="hidden size-3 group-data-[state=indeterminate]:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
