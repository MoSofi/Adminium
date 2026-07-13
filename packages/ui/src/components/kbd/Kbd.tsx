import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export type KbdProps = Omit<React.ComponentPropsWithRef<'kbd'>, 'style'>;

/**
 * Keycap chip: JetBrains Mono, 1px border + 2px bottom border, radius 6px
 * (`rounded-sm`) — research/design-system.md §3 Tier 1.
 */
export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-b-2 border-border-strong bg-surface-2 px-1.5 font-mono text-[10.5px] font-semibold leading-none text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}
