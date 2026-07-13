import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export type LabelProps = Omit<React.ComponentPropsWithRef<'label'>, 'style'>;

/**
 * Field label: 12px/600 on `--fg` (research/design-system.md §3 Tier 1).
 * Required-asterisk and control wiring belong to `FormField` (Tier 2).
 */
export function Label({ className, ...props }: LabelProps) {
  return <label className={cn('block text-[12px] font-semibold leading-4 text-fg', className)} {...props} />;
}

export type EyebrowProps = Omit<React.ComponentPropsWithRef<'span'>, 'style'>;

/**
 * Uppercase micro-label: 10.5px/700, letter-spacing .05em, `--fg-subtle`
 * (the tokens `text-micro` scale) — nav groups, table headers, form sections.
 */
export function Eyebrow({ className, ...props }: EyebrowProps) {
  return <span className={cn('inline-block text-micro uppercase text-fg-subtle', className)} {...props} />;
}
