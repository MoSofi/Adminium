import * as PopoverPrimitive from '@radix-ui/react-popover';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/** Root — controls open state (`open`/`onOpenChange`/`defaultOpen`). */
export const Popover = PopoverPrimitive.Root;

/** Trigger — `asChild`-compatible; typically wraps a `Button`/`IconButton`. */
export const PopoverTrigger = PopoverPrimitive.Trigger;

/** Optional anchor when the panel should attach to something other than the trigger. */
export const PopoverAnchor = PopoverPrimitive.Anchor;

/** Close control for use inside the panel (`asChild`-compatible). */
export const PopoverClose = PopoverPrimitive.Close;

export type PopoverContentProps = Omit<
  React.ComponentPropsWithRef<typeof PopoverPrimitive.Content>,
  'style'
>;

/**
 * Popover — anchored panel on `--surface`, radius 14 (`rounded-lg`),
 * `--shadow-menu`, `nb-pop` entrance (research/design-system.md §3 Tier 3).
 * Focus is moved into the panel and trapped by Radix; Esc/outside-click
 * dismiss and return focus to the trigger.
 */
export function PopoverContent({ className, sideOffset = 6, align = 'center', ...props }: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 w-[280px] rounded-lg border border-border bg-surface p-3.5 shadow-menu outline-none ',
          'animate-[nb-pop_.16s_cubic-bezier(.2,.7,.3,1)]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
