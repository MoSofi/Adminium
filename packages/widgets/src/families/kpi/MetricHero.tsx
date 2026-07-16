/**
 * `metric-hero` (annex §1) — the oversized single metric: a
 * `requestAnimationFrame` count-up to the bound value, a delta pill, a spark
 * strip, and a goal progress track ("Goal · $650k, 74%"). Renders only the
 * loaded state — skeleton/empty/error are WidgetFrame's job.
 *
 * REDUCED MOTION (04 §7.5, mandatory): `prefers-reduced-motion: reduce` skips
 * the count-up entirely and paints the final value on the first frame — an
 * animated number is exactly the kind of motion the query exists to suppress,
 * and a KPI that "spins up" is unreadable to a vestibular-sensitive user. The
 * hook seeds its state from the query rather than transitioning to it, so the
 * intermediate values never render even once.
 */

import { DeltaPill, MonoText, ProgressBar } from '@adminium/ui';
import { Sparkline, prefersReducedMotion } from '@adminium/charts';
import { useEffect, useRef, useState } from 'react';

import { computeDelta, formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asMetricDelta } from '../../lib/shapes.js';
import { fractionOf } from './kpi-lib.js';
import type { MetricHeroConfig } from './kpi-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { metricHeroConfigSchema, metricHeroDemoData } from './kpi-config.js';
export type { MetricHeroConfig } from './kpi-config.js';

/** Count-up duration in ms (research/design-system.md §4.3 — "hero" tier). */
const COUNT_UP_MS = 900;

/** Cubic ease-out — fast start, settled landing. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animate 0 → `target` over `COUNT_UP_MS` via rAF. Returns `target` immediately
 * when the caller disables it, when the browser has no rAF (SSR / the Node test
 * env), or under `prefers-reduced-motion`.
 */
export function useCountUp(target: number, enabled: boolean): number {
  const reduced = prefersReducedMotion();
  const animate = enabled && !reduced && typeof requestAnimationFrame === 'function';
  const [value, setValue] = useState(() => (animate ? 0 : target));
  const frameRef = useRef(0);

  useEffect(() => {
    if (!animate) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      setValue(target * easeOut(t));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, animate]);

  return value;
}

/** The goal scalar off the payload (config wins when set). */
function goalOf(data: unknown, configGoal: number | undefined): number | undefined {
  if (configGoal !== undefined) return configGoal;
  const raw = typeof data === 'object' && data !== null ? (data as { goal?: unknown }).goal : undefined;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

export function MetricHero({ config, data }: WidgetProps<MetricHeroConfig>) {
  const metric = asMetricDelta(data);
  const goal = goalOf(data, config.goalValue);
  // Hooks must run before any early return (rules-of-hooks); a malformed
  // payload counts up to 0 and is discarded by the guard below.
  const animated = useCountUp(metric?.value ?? 0, config.countUp);

  if (metric === null) {
    return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const value = formatMetricValue(animated, config.metricFormat, opts);
  const delta = computeDelta(metric, config.deltaMode, config.metricFormat, opts);
  const label = config.metricLabel ?? config.title;
  const spark = metric.spark?.slice(0, config.sparkBars);

  const goalPct = goal === undefined ? null : fractionOf(metric.value, goal) * 100;
  const goalText =
    goal === undefined
      ? null
      : `${config.goalLabel ?? 'Goal'} · ${formatMetricValue(goal, config.metricFormat, opts)}, ${formatMetricValue(
          (goalPct as number) / 100,
          'percent',
          opts,
        )}`;

  return (
    <div className="flex h-full flex-col justify-between gap-3 px-4 pb-4 compact:px-3 compact:pb-3" data-widget="metric-hero">
      <div className="flex flex-col gap-1.5">
        {label === undefined ? null : <p className="truncate text-body-sm text-fg-muted">{label}</p>}
        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            aria-live is deliberately absent: the count-up would otherwise
            announce dozens of intermediate values. The final number is read
            from the DOM on focus like any other static text.
          */}
          <MonoText
            data-part="hero-value"
            className="text-[38px] font-bold leading-none text-fg compact:text-[30px]"
          >
            {value}
          </MonoText>
          {delta === null ? null : (
            <DeltaPill trend={delta.trend} invertGood={config.invertDeltaGood}>
              {delta.text}
            </DeltaPill>
          )}
        </div>
      </div>

      {spark === undefined || spark.length === 0 ? null : (
        <Sparkline data={spark} variant="bar" width={220} height={40} className="w-full" />
      )}

      {goalText === null ? null : (
        <div className="flex flex-col gap-1.5" data-part="goal-track">
          <span className="truncate text-caption text-fg-muted">{goalText}</span>
          <ProgressBar
            value={goalPct as number}
            max={100}
            tone="accent"
            size="md"
            label={goalText}
          />
        </div>
      )}
    </div>
  );
}
