/**
 * `gauge-ring` (annex §1) — an SVG circle with an animated `stroke-dashoffset`
 * sweep, a center value and a status caption ("86/100 Healthy", "73% of 5M
 * rows"), plus the annex's footer variants (spent-of-total figures + trend pill,
 * or an avatar stack). Doubles as the budget/allocation donut gauge. Renders only
 * the loaded state — skeleton/empty/error are WidgetFrame's job.
 *
 * COLOUR: the sweep is tinted by the band the value falls in, and bands name
 * semantic TONES (`pos`/`warn`/`danger`/…), never raw colours — so a gauge
 * re-themes with the app and stays legible in dark mode
 * (research/widget-registry.md Conventions: "CSS variables only").
 *
 * RTL: the ring geometry does NOT mirror. A clockwise sweep is rotational, not
 * directional — mirroring it would read as "the gauge runs backwards", exactly
 * as it would for a donut (@adminium/charts geometry/radialBar.ts states the
 * same policy verbatim). The caption, footer figures and avatar stack around it
 * are ordinary logical-property flex and flip normally.
 *
 * REDUCED MOTION (04 §7.5, mandatory): the sweep animates from empty to its
 * value on mount via `useMountAnimation`, which paints the final frame
 * immediately under `prefers-reduced-motion: reduce`.
 */

import { Avatar, AvatarStack, DeltaPill, MonoText } from '@adminium/ui';
import { useMountAnimation } from '@adminium/charts';

import { computeDelta, formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asMetricDelta } from '../../lib/shapes.js';
import { bandFor, clampValue, gaugeRingGeometry, sharedToneOf } from './kpi-lib.js';
import type { GaugeRingConfig } from './kpi-config.js';
import type { Tone } from '@adminium/ui';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { gaugeRingConfigSchema, gaugeRingDemoData } from './kpi-config.js';
export type { GaugeRingConfig } from './kpi-config.js';

/**
 * Tone → the `stroke` utility for the value sweep. A lookup table (not an
 * interpolated class name) so Tailwind's scanner sees every literal and never
 * tree-shakes a tone that only appears at runtime.
 */
const STROKE_TONE: Record<Tone, string> = {
  neutral: 'stroke-fg-subtle',
  accent: 'stroke-accent',
  pos: 'stroke-pos',
  warn: 'stroke-warn',
  danger: 'stroke-danger',
  info: 'stroke-info',
};

/** Tone → the caption's text utility. */
const TEXT_TONE: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent',
  pos: 'text-pos',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

/** The avatar names off the payload (the annex's avatar-stack footer). */
function avatarsOf(data: unknown): string[] {
  const raw = typeof data === 'object' && data !== null ? (data as { avatars?: unknown }).avatars : undefined;
  return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string') : [];
}

/** The denominator off the payload (annex "+ optional numerator/denominator"). */
function totalOf(data: unknown, max: number): number {
  const raw = typeof data === 'object' && data !== null ? (data as { total?: unknown }).total : undefined;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : max;
}

export function GaugeRing({ config, data }: WidgetProps<GaugeRingConfig>) {
  const mounted = useMountAnimation();
  const metric = asMetricDelta(data);
  if (metric === null) {
    return <p className="px-[var(--widget-pad)] pb-[var(--widget-pad)] text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const value = clampValue(metric.value, config.max);
  const geometry = gaugeRingGeometry(value, config.max, config.size);
  const band = bandFor(value, config.bands);
  // The band the value lands in wins; the shared `tone` override only applies
  // to a band-less gauge (an empty `bands` array).
  const tone: Tone = band?.tone ?? sharedToneOf(config.tone, 'accent');
  const total = totalOf(data, config.max);
  const delta = computeDelta(metric, config.deltaMode, config.metricFormat, opts);

  const center =
    config.centerFormat === 'percent'
      ? formatMetricValue(geometry.fraction, 'percent', opts)
      : config.centerFormat === 'fraction'
        ? `${formatMetricValue(value, 'plain', opts)}/${formatMetricValue(config.max, 'plain', opts)}`
        : formatMetricValue(value, 'plain', opts);
  const caption = config.caption ?? band?.label;
  const avatars = avatarsOf(data);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-[var(--widget-pad)] pb-[var(--widget-pad)] compact:gap-2"
      data-widget="gauge-ring"
      data-tone={tone}
    >
      <div className="relative shrink-0">
        <svg
          width={geometry.size}
          height={geometry.size}
          viewBox={`0 0 ${geometry.size} ${geometry.size}`}
          role="img"
          aria-label={`${caption === undefined ? '' : `${caption}: `}${center}`}
          data-export-node=""
          // Rotation is direction-neutral: the sweep starts at 12 o'clock in
          // LTR and RTL alike (see the module note).
          className="-rotate-90"
        >
          <circle
            cx={geometry.center}
            cy={geometry.center}
            r={geometry.radius}
            fill="none"
            strokeWidth={geometry.thickness}
            className="stroke-surface-3"
          />
          <circle
            data-part="gauge-value"
            cx={geometry.center}
            cy={geometry.center}
            r={geometry.radius}
            fill="none"
            strokeWidth={geometry.thickness}
            strokeLinecap="round"
            strokeDasharray={geometry.circumference}
            // Starts fully offset (empty) and settles to the value; under
            // reduced motion `mounted` is true on the first render, so the
            // final frame paints immediately and the transition never runs.
            strokeDashoffset={mounted ? geometry.dashOffset : geometry.circumference}
            className={`transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none ${STROKE_TONE[tone]}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <MonoText data-part="gauge-center" className="text-[20px] font-bold leading-none text-fg">
            {center}
          </MonoText>
          {caption === undefined ? null : (
            <span data-part="gauge-caption" className={`text-micro font-bold uppercase tracking-wide ${TEXT_TONE[tone]}`}>
              {caption}
            </span>
          )}
        </div>
      </div>

      {config.footer === 'spent-of-total' && (
        <div className="flex w-full items-center justify-between gap-2" data-part="gauge-footer">
          <MonoText className="truncate text-caption text-fg-muted">
            {config.spentLabel === undefined ? '' : `${config.spentLabel} `}
            <span className="font-semibold text-fg">{formatMetricValue(value, config.metricFormat, opts)}</span>
            {` / ${formatMetricValue(total, config.metricFormat, opts)}`}
            {config.totalLabel === undefined ? '' : ` ${config.totalLabel}`}
          </MonoText>
          {delta === null ? null : (
            <DeltaPill trend={delta.trend} invertGood={config.invertDeltaGood}>
              {delta.text}
            </DeltaPill>
          )}
        </div>
      )}

      {config.footer === 'avatar-stack' && avatars.length > 0 && (
        <div className="flex w-full justify-center" data-part="gauge-footer">
          <AvatarStack size="sm" max={4} label={config.totalLabel}>
            {avatars.map((name) => (
              <Avatar key={name} name={name} size="sm" />
            ))}
          </AvatarStack>
        </div>
      )}
    </div>
  );
}
