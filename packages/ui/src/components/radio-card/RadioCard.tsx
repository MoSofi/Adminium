// SPDX-License-Identifier: AGPL-3.0-only
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Check } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export interface RadioCardProps
  extends Omit<React.ComponentPropsWithRef<typeof RadioGroupPrimitive.Item>, 'style' | 'asChild' | 'children' | 'title'> {
  /** Card title (the item's accessible name together with `description`). */
  title: React.ReactNode;
  /** Muted body copy under the title. */
  description?: React.ReactNode | undefined;
  /** Leading slot — typically an `IconTile` or Lucide icon. */
  icon?: React.ReactNode | undefined;
  /** Trailing slot on the title row — e.g. a mono price or a `Badge`. */
  trailing?: React.ReactNode | undefined;
  /** Hide the top-end check indicator shown when selected. */
  hideIndicator?: boolean | undefined;
}

/**
 * RadioCard — selectable card variant of the radio item
 * (research/design-system.md §3 Tier 2): full-card click target, selected =
 * accent border + accent-soft bg + check indicator. Must be rendered inside
 * a `RadioGroup` (../radio); arrow keys move and select between cards.
 */
export function RadioCard({
  title,
  description,
  icon,
  trailing,
  hideIndicator = false,
  className,
  ...props
}: RadioCardProps) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-lg border border-border-strong bg-surface p-3.5 text-start ',
        'transition-[border-color,background-color,box-shadow] duration-150 hover:border-fg-subtle ',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ',
        'disabled:pointer-events-none disabled:opacity-40 ',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center text-fg-muted group-data-[state=checked]:text-accent [&_svg]:size-[18px]"
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg">{title}</span>
          {trailing ? <span className="ms-auto flex shrink-0 items-center">{trailing}</span> : null}
        </span>
        {description === undefined || description === null ? null : (
          <span className="text-[11.5px] leading-4 text-fg-muted">{description}</span>
        )}
      </span>
      {hideIndicator ? null : (
        <RadioGroupPrimitive.Indicator
          aria-hidden="true"
          className={cn(
            'absolute end-2.5 top-2.5 flex size-[18px] items-center justify-center rounded-full bg-accent text-accent-fg',
            // keep the check clear of the trailing slot when both are present
            trailing ? 'top-auto bottom-2.5' : '',
          )}
        >
          <Check strokeWidth={3} className="size-3" />
        </RadioGroupPrimitive.Indicator>
      )}
    </RadioGroupPrimitive.Item>
  );
}
