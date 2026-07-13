import { Slot } from '@radix-ui/react-slot';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export interface MonoTextProps extends Omit<React.ComponentPropsWithRef<'span'>, 'style'> {
  /** Merge classes/props into the single child element (Radix Slot). */
  asChild?: boolean;
}

/**
 * JetBrains Mono + `tabular-nums` wrapper (the comps' `.nb-num`) — mandatory
 * for money, KPIs, IDs, timestamps, counts, connection strings
 * (workplan/03-component-library.md §7.4). Never applies locale formatting;
 * that is the caller's job.
 */
export function MonoText({ className, asChild = false, ...props }: MonoTextProps) {
  const Comp = asChild ? Slot : 'span';
  return <Comp className={cn('font-mono tabular-nums', className)} {...props} />;
}
