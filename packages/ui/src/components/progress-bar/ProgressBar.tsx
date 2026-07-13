import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import type { Tone } from '../badge/Badge.js';

/**
 * Pill progress track (surface-3) — 4/6/10px heights
 * (research/design-system.md §3 Tier 1).
 */
export const progressBarVariants = cva('w-full overflow-hidden rounded-full bg-surface-3', {
  variants: {
    size: {
      sm: 'h-1',
      md: 'h-1.5',
      lg: 'h-2.5',
    },
  },
  defaultVariants: { size: 'md' },
});

const FILL_TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface ProgressBarProps
  extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'children'>,
    VariantProps<typeof progressBarVariants> {
  /** Current value, clamped to `[0, max]`. */
  value: number;
  /** Maximum value. Default 100. */
  max?: number;
  /** Fill tone. Default `accent`. */
  tone?: Tone;
  /** Animate the fill growing on mount (`nb-grow`). Default true. */
  animated?: boolean;
  /** Accessible name for the progressbar. */
  label?: string;
}

export function ProgressBar({
  className,
  size,
  value,
  max = 100,
  tone = 'accent',
  animated = true,
  label,
  ...props
}: ProgressBarProps) {
  const upper = max > 0 ? max : 100;
  const clamped = Math.min(Math.max(value, 0), upper);
  const pct = (clamped / upper) * 100;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={upper}
      aria-valuenow={clamped}
      aria-label={label}
      data-tone={tone}
      className={cn(progressBarVariants({ size }), className)}
      {...props}
    >
      <div
        className={cn(
          'h-full w-[var(--adm-progress)] rounded-full',
          FILL_TONE_CLASSES[tone],
          animated &&
            'origin-[0%_50%] animate-[nb-grow_0.85s_cubic-bezier(.2,.7,.3,1)] [--nb-grow-x:0] [--nb-grow-y:1] rtl:origin-[100%_50%]',
        )}
        // Sanctioned escape hatch: CSS custom properties only (02-design-system.md §8).
        style={{ '--adm-progress': `${pct}%` }}
      />
    </div>
  );
}
