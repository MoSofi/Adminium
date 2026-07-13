import * as SliderPrimitive from '@radix-ui/react-slider';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export interface SliderProps
  extends Omit<React.ComponentPropsWithRef<typeof SliderPrimitive.Root>, 'style' | 'asChild'> {
  /**
   * Accessible name per thumb (`aria-label`), in value order. Range sliders
   * (two-element `value`) need two labels.
   */
  thumbLabels?: readonly string[] | undefined;
}

/**
 * Slider — Radix slider with an accent range on a `--surface-3` track
 * (research/design-system.md §3 Tier 2). Arrow keys step (RTL-mirrored),
 * PageUp/Down large-step, Home/End clamp. Pass a two-element `value`/
 * `defaultValue` for a range slider.
 */
export function Slider({ className, thumbLabels, value, defaultValue, ...props }: SliderProps) {
  const thumbCount = (value ?? defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      className={cn(
        'relative flex h-5 w-full touch-none select-none items-center data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          {...(thumbLabels?.[index] === undefined ? {} : { 'aria-label': thumbLabels[index] })}
          className={cn(
            'block size-4 rounded-full border-2 border-accent bg-surface shadow-card ',
            'transition-shadow duration-150 ',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}
