import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Re-export of the Radix provider: mount once per app to share the skip-delay
 * timer between tooltips. `Tooltip` also works standalone (it nests its own
 * provider), so this is an optimization, not a requirement.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

type ContentPassthrough = Pick<
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
  'side' | 'align' | 'sideOffset'
>;

export interface TooltipProps extends ContentPassthrough {
  /** Tooltip text (dark surface: `--fg` bg + `--bg` text, 12px, radius 8). */
  content: ReactNode;
  /** The trigger element; rendered `asChild`, so it must accept a ref. */
  children: ReactNode;
  /** Hover open delay in ms (design default 300). */
  delayDuration?: number | undefined;
  /** Controlled open state. */
  open?: boolean | undefined;
  /** Uncontrolled initial open state. */
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Extra classes for the tooltip bubble. */
  className?: string | undefined;
}

/**
 * Tooltip — Radix tooltip on the inverted dark surface (`--fg` background,
 * `--bg` text), radius 8, 12px text, 300ms delay
 * (research/design-system.md §3 Tier 3). Opens on hover and on keyboard
 * focus; Esc dismisses (Radix built-ins).
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  delayDuration = 300,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        {...(onOpenChange === undefined ? {} : { onOpenChange })}
      >
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(
              'z-50 max-w-[280px] rounded-[8px] bg-fg px-2.5 py-1.5 text-[12px] font-medium leading-snug text-bg shadow-menu',
              'animate-[nb-pop_.15s_cubic-bezier(.2,.7,.3,1)]',
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow width={10} height={5} className="fill-fg" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
