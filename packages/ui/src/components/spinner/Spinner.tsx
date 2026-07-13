import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Rotating ring: currentColor top segment on a 25%-alpha ring, `nb-spin`
 * keyframe from @adminium/tokens. Sizes 14/18/24px
 * (research/design-system.md §3 Tier 1). Inherits its color, so it adapts to
 * `text-accent-fg` inside primary buttons; set `text-accent` (default) via
 * className on standalone usage.
 */
export const spinnerVariants = cva(
  // The literal `nb-spin` class keeps the tokens' reduced-motion policy in
  // effect (spinner keeps rotating, slower, instead of freezing).
  'nb-spin inline-block animate-[nb-spin_0.8s_linear_infinite] rounded-full border-2 border-current/25 border-t-current',
  {
    variants: {
      size: {
        sm: 'size-3.5',
        md: 'size-[18px]',
        lg: 'size-6',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

export interface SpinnerProps
  extends Omit<React.ComponentPropsWithRef<'span'>, 'style' | 'children' | 'aria-label'>,
    VariantProps<typeof spinnerVariants> {
  /**
   * Accessible name. When provided the spinner announces as `role="status"`;
   * without it the spinner is decorative (`aria-hidden`) — the parent should
   * carry `aria-busy` (e.g. a loading Button).
   */
  label?: string;
}

export function Spinner({ className, size, label, ...props }: SpinnerProps) {
  const a11y = label !== undefined ? ({ role: 'status', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const);
  return <span {...a11y} className={cn(spinnerVariants({ size }), className)} {...props} />;
}
