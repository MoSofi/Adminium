// SPDX-License-Identifier: AGPL-3.0-only
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { useId } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export type RadioGroupProps = Omit<
  React.ComponentPropsWithRef<typeof RadioGroupPrimitive.Root>,
  'style' | 'asChild'
>;

/**
 * RadioGroup — Radix radio-group root. One tab stop; arrow keys move AND
 * select (RTL-mirrored via the app-level `DirectionProvider`). Hosts `Radio`
 * items or `RadioCard` items (../radio-card).
 */
export function RadioGroup({ className, ...props }: RadioGroupProps) {
  return <RadioGroupPrimitive.Root className={cn('flex flex-col gap-2.5', className)} {...props} />;
}

export interface RadioProps
  extends Omit<React.ComponentPropsWithRef<typeof RadioGroupPrimitive.Item>, 'style' | 'asChild' | 'children'> {
  /**
   * Optional label rendered next to the dot and wired via `htmlFor`. Without
   * it, provide an `aria-label` (icon-less bare dot).
   */
  label?: React.ReactNode | undefined;
  /** Muted second line under the label. */
  description?: React.ReactNode | undefined;
}

/**
 * Radio — dot radio, 18px circle on `--surface-2`; checked = accent border +
 * accent dot (research/design-system.md §3 Tier 2). Card-styled selection
 * lives in `RadioCard`.
 */
export function Radio({ label, description, className, id, ...props }: RadioProps) {
  const generatedId = useId();
  const itemId = id ?? generatedId;

  const item = (
    <RadioGroupPrimitive.Item
      id={itemId}
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-2 ',
        'transition-[border-color,box-shadow] duration-150 ',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft focus-visible:border-accent ',
        'disabled:pointer-events-none disabled:opacity-40 ',
        'data-[state=checked]:border-accent',
        // mt aligns the dot with the first label line when a description wraps below
        label ? 'mt-px' : '',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <span aria-hidden="true" className="block size-2 rounded-full bg-accent" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );

  if (label === undefined || label === null) return item;

  return (
    <div className="flex items-start gap-2.5">
      {item}
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={itemId} className="cursor-default text-[13px] font-medium leading-[18px] text-fg">
          {label}
        </label>
        {description === undefined || description === null ? null : (
          <span className="text-[11.5px] leading-4 text-fg-muted">{description}</span>
        )}
      </div>
    </div>
  );
}
