// SPDX-License-Identifier: AGPL-3.0-only
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

export type DeltaTrend = 'up' | 'down' | 'flat';

/**
 * Trend pill: trending-up/down/flat Lucide icon + a mono % value, tones
 * pos/danger/muted (research/design-system.md §3 Tier 1).
 */
export const deltaPillVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-bold leading-none',
  {
    variants: {
      tone: {
        pos: 'bg-pos-soft-solid text-pos',
        danger: 'bg-danger-soft-solid text-danger',
        muted: 'bg-surface-3 text-fg-muted',
      },
    },
    defaultVariants: { tone: 'muted' },
  },
);

const TREND_ICONS: Record<DeltaTrend, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export interface DeltaPillProps
  extends Omit<React.ComponentPropsWithRef<'span'>, 'style'>,
    Omit<VariantProps<typeof deltaPillVariants>, 'tone'> {
  /** Trend direction; picks the icon and (unless overridden) the tone. */
  trend: DeltaTrend;
  /**
   * Invert the good direction: down reads as pos, up as danger (costs,
   * error rates, churn). `flat` is always muted.
   */
  invertGood?: boolean;
  /** Explicit tone override — skips the trend→tone mapping. */
  tone?: 'pos' | 'danger' | 'muted';
  /** Formatted delta text (e.g. "+12.4%") — formatting is the caller's job. */
  children: React.ReactNode;
}

function trendTone(trend: DeltaTrend, invertGood: boolean): 'pos' | 'danger' | 'muted' {
  if (trend === 'flat') return 'muted';
  const good = invertGood ? trend === 'down' : trend === 'up';
  return good ? 'pos' : 'danger';
}

export function DeltaPill({ className, trend, invertGood = false, tone, children, ...props }: DeltaPillProps) {
  const resolved = tone ?? trendTone(trend, invertGood);
  const Icon = TREND_ICONS[trend];
  return (
    <span
      data-trend={trend}
      data-tone={resolved}
      className={cn(deltaPillVariants({ tone: resolved }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0 rtl:-scale-x-100" />
      <MonoText>{children}</MonoText>
    </span>
  );
}
