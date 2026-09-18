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
  /**
   * The BIG line under the title, as the design comp draws it: 20px
   * mono, tight tracking — a delivery window, a size, a duration.
   *
   * `valueLine`, not `value`: a radio item's `value` is what it SUBMITS, and
   * this is what it shows. Distinct from `description`, which is the sentence
   * under it — a card that offers a choice usually has one number worth reading
   * from across the room and one line of prose, and folding them together made
   * the number prose.
   */
  valueLine?: React.ReactNode | undefined;
  /** Hide the top-end check indicator shown when selected. */
  hideIndicator?: boolean | undefined;
  /**
   * Card shape.
   *
   * `row` (default) is the one every existing caller renders: a bare leading
   * glyph beside a 13px title. `tile` and `stack` are the two the onboarding
   * comps draw — a 40px accent-filling icon tile, leading with a description
   * or centred above a label — and they are here rather than hand-rolled in
   * the wizard because the Radix item underneath is what makes arrow keys
   * and `aria-checked` work, and it is not exported.
   */
  layout?: 'row' | 'tile' | 'stack' | undefined;
}

/** Per-layout geometry, from the comp: padding, radius, and the icon's box. */
const LAYOUT = {
  row: {
    card: 'items-start gap-3 rounded-lg p-3.5',
    icon: 'items-center [&_svg]:size-[18px]',
    title: 'text-[13px] font-semibold text-fg',
    description: 'text-[11.5px] leading-4 text-fg-muted',
  },
  tile: {
    card: 'items-start gap-3 rounded-[13px] p-[15px]',
    icon:
      'size-10 items-center justify-center rounded-[11px] bg-surface-3 ' +
      'group-data-[state=checked]:bg-accent group-data-[state=checked]:text-accent-fg [&_svg]:size-[18px]',
    title: 'text-[13.5px] font-bold text-fg',
    description: 'mt-1 text-[11.5px] leading-[1.5] text-fg-subtle',
  },
  stack: {
    card: 'flex-col items-center gap-[9px] rounded-[13px] p-[15px] text-center',
    icon:
      'size-10 items-center justify-center rounded-[11px] bg-surface-3 ' +
      'group-data-[state=checked]:bg-accent group-data-[state=checked]:text-accent-fg [&_svg]:size-5',
    title: 'text-[13px] font-bold text-fg',
    description: 'mt-1 text-[11.5px] leading-[1.5] text-fg-subtle',
  },
} as const;

/**
 * RadioCard — selectable card variant of the radio item
 * (research/design-system.md Tier 2): full-card click target, selected =
 * accent border + accent-soft bg + check indicator. Must be rendered inside
 * a `RadioGroup` (./radio); arrow keys move and select between cards.
 */
export function RadioCard({
  layout = 'row',
  title,
  description,
  valueLine,
  icon,
  trailing,
  hideIndicator = false,
  className,
  ...props
}: RadioCardProps) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'group relative flex w-full cursor-pointer border border-border-strong bg-surface text-start ',
        LAYOUT[layout].card,
        layout === 'stack' ? '' : 'text-start ',
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
          className={cn(
            'flex shrink-0 text-fg-muted group-data-[state=checked]:text-accent',
            LAYOUT[layout].icon,
          )}
        >
          {icon}
        </span>
      ) : null}
      <span
        className={cn(
          'flex min-w-0 flex-col gap-0.5',
          layout === 'stack' ? 'items-center' : 'flex-1',
        )}
      >
        <span className="flex items-center gap-2">
          <span className={LAYOUT[layout].title}>{title}</span>
          {trailing ? <span className="ms-auto flex shrink-0 items-center">{trailing}</span> : null}
        </span>
        {valueLine === undefined || valueLine === null ? null : (
          <span className="font-mono text-[20px] font-extrabold tracking-[-0.02em] text-fg">
            {valueLine}
          </span>
        )}
        {description === undefined || description === null ? null : (
          <span className={LAYOUT[layout].description}>{description}</span>
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
