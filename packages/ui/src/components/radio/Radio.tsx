// SPDX-License-Identifier: AGPL-3.0-only
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { useId, useRef } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export type RadioGroupProps = Omit<
  React.ComponentPropsWithRef<typeof RadioGroupPrimitive.Root>,
  'style' | 'asChild'
>;

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/**
 * RadioGroup — Radix radio-group root. One tab stop; arrow keys move AND
 * select (RTL-mirrored via the app-level `DirectionProvider`). Hosts `Radio`
 * items or `RadioCard` items (../radio-card).
 *
 * Radix selects on an arrow only while the key is still down when focus lands
 * on the next item (it moves focus a tick later, and reads a document-level
 * "an arrow is held" flag). A key sent down and up with nothing between, as a
 * switch device, a remote desktop or browser automation sends it, moved focus
 * and chose nothing: the group then looked chosen on one item and focused on
 * another. So the root sees the one focus move an arrow makes, and chooses
 * the item itself when Radix did not.
 */
export function RadioGroup({ className, onKeyDown, onClick, onFocus, ...props }: RadioGroupProps) {
  /** The radio an arrow was pressed on, until the tick in which Radix moves focus has passed. */
  const armed = useRef<EventTarget | null>(null);
  /** Counts the arrow presses, so an earlier press's timer never ends a later one's move. */
  const presses = useRef(0);
  /** The radio Radix chose itself (its own click) on this move. */
  const chosen = useRef<Element | null>(null);
  return (
    <RadioGroupPrimitive.Root
      className={cn('flex flex-col gap-2.5', className)}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        const from = event.target as HTMLElement;
        // Only a move Radix took (it prevents the key's default), from a radio of this group: an arrow typed in a text
        // field inside the group is not one.
        if (!ARROW_KEYS.includes(event.key) || !event.defaultPrevented || from.getAttribute('role') !== 'radio') return;
        presses.current += 1;
        const press = presses.current;
        armed.current = from;
        chosen.current = null;
        // Radix moves focus in a timer set before this one: after it, the move is over. Two presses that land before
        // the first timer (a tab whose timers are slowed) are both seen through: the later press ends the move.
        setTimeout(() => {
          if (presses.current === press) armed.current = null;
        }, 0);
      }}
      onClick={(event) => {
        chosen.current = (event.target as HTMLElement).closest('[role="radio"]');
        onClick?.(event);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        const to = event.target as HTMLElement;
        if (armed.current === null || to === armed.current || to.getAttribute('role') !== 'radio') return;
        // The key was already up when focus landed, so Radix chose nothing: choose it, once.
        if (chosen.current !== to) to.click();
      }}
    />
  );
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
 * accent dot (research/design-system.md Tier 2). Card-styled selection lives
 * in `RadioCard`.
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
