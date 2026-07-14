/**
 * Onboarding progress ring (M5-T06 keeper from designs/Workspace
 * Onboarding.dc.html). A bespoke SVG data-viz — like the chart widgets it uses
 * token colors via `stroke="var(--…)"` and drives the arc with a numeric SVG
 * `stroke-dashoffset` (never the banned `style` prop / raw hex). The centre
 * label is `Intl`-formatted so ar_EG renders Arabic-Indic numerals.
 */

import { getFormatters } from '@adminium/i18n';
import { useMemo } from 'react';

export interface ProgressRingProps {
  /** Completed steps. */
  done: number;
  /** Total steps (0 renders an empty ring). */
  total: number;
  /** BCP-47-ish app locale (e.g. `en_US`); underscores are normalized. */
  locale?: string | undefined;
  /** Outer diameter in px. */
  size?: number | undefined;
  /** Accessible label; falls back to a percentage sentence. */
  ariaLabel?: string | undefined;
}

const STROKE = 9;

export function ProgressRing({ done, total, locale, size = 116, ariaLabel }: ProgressRingProps) {
  const fraction = total === 0 ? 0 : Math.min(1, Math.max(0, done / total));
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - fraction);
  const center = size / 2;

  const percentLabel = useMemo(() => {
    const tag = (locale ?? 'en_US').replace('_', '-');
    // Standalone sans-serif figure (not a mono/tabular cell) → prose context,
    // so ar_EG renders Arabic-Indic numerals (§4.2), via the i18n format layer.
    return getFormatters(tag).percent(fraction, { ctx: 'prose' });
  }, [fraction, locale]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={ariaLabel ?? percentLabel}
      data-part="onboarding-progress-ring"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--surface-3)"
        strokeWidth={STROKE}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${String(center)} ${String(center)})`}
        className="transition-[stroke-dashoffset] duration-500"
      />
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-fg text-title font-extrabold"
        aria-hidden="true"
      >
        {percentLabel}
      </text>
    </svg>
  );
}
