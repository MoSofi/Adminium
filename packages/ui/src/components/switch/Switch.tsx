// SPDX-License-Identifier: AGPL-3.0-only
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export type SwitchProps = Omit<
  React.ComponentPropsWithRef<typeof SwitchPrimitive.Root>,
  'style' | 'asChild'
>;

/**
 * Switch — Radix switch, 40x23 track, 19px white knob, accent when on /
 * `--surface-3` when off, .18s knob travel (research/design-system.md §3
 * Tier 2). Space/Enter toggle; label wiring via `Label htmlFor` or
 * `FormField`. Knob travel mirrors in RTL.
 */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-[23px] w-10 shrink-0 items-center rounded-full bg-surface-3 p-0.5 ',
        'transition-colors duration-[180ms] ',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ',
        'disabled:pointer-events-none disabled:opacity-40 ',
        'data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-[19px] rounded-full bg-white shadow-card transition-transform duration-[180ms] ',
          'data-[state=checked]:translate-x-[17px] rtl:data-[state=checked]:-translate-x-[17px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
