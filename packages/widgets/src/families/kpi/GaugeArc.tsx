/**
 * `gauge-arc` (annex §1) — a 180° speedometer arc with coloured qualitative
 * bands and a needle (or a plain half-arc dasharray gauge with `needle: false`),
 * plus the annex's grid-of-gauges CLUSTER mode (2×2 / 5-up SLA + system-health
 * clusters). Renders only the loaded state — skeleton/empty/error are
 * WidgetFrame's job.
 *
 * TWO SHAPES, ONE WIDGET (04 §3): the definition declares
 * `['single-metric', 'categorical']` because `cluster` is a CONFIG flag — the
 * single gauge binds a score, the cluster binds a {label, pct, tone} list. The
 * component reads whichever its config selects; `gaugeArcDemoData` emits a
 * payload satisfying both.
 *
 * COLOUR: bands name semantic TONES, never raw colours — a gauge re-themes with
 * the app (research/widget-registry.md Conventions: "CSS variables only").
 *
 * RTL: the arc does NOT mirror. The sweep is rotational, not directional (the
 * @adminium/charts donut / radial-bar policy verbatim) — a mirrored speedometer
 * would read as running backwards. The labels, values and the cluster grid
 * around it are logical-property flex/grid and flip normally.
 *
 * REDUCED MOTION (04 §7.5, mandatory): the needle and the value sweep settle in
 * from the arc's start via `useMountAnimation`, which paints the final frame
 * immediately under `prefers-reduced-motion: reduce`.
 */

import { EmptyState, MonoText } from '@adminium/ui';
import { useMountAnimation } from '@adminium/charts';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asCategorical, asSingleMetric } from '../../lib/shapes.js';
import { bandFor, clampValue, gaugeArcGeometry, toneOf } from './kpi-lib.js';
import type { GaugeArcConfig } from './kpi-config.js';
import type { GaugeBand } from './kpi-lib.js';
import type { Tone } from '@adminium/ui';
import type { MetricFormatOptions } from '../../lib/format.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { gaugeArcConfigSchema, gaugeArcDemoData } from './kpi-config.js';
export type { GaugeArcConfig } from './kpi-config.js';

/**
 * Tone → `stroke` / `fill` / `text` utilities. Lookup tables (not interpolated
 * class names) so Tailwind's scanner sees every literal and never tree-shakes a
 * tone that only appears at runtime.
 */
const STROKE_TONE: Record<Tone, string> = {
  neutral: 'stroke-fg-subtle',
  accent: 'stroke-accent',
  pos: 'stroke-pos',
  warn: 'stroke-warn',
  danger: 'stroke-danger',
  info: 'stroke-info',
};
const FILL_TONE: Record<Tone, string> = {
  neutral: 'fill-fg-subtle',
  accent: 'fill-accent',
  pos: 'fill-pos',
  warn: 'fill-warn',
  danger: 'fill-danger',
  info: 'fill-info',
};
const TEXT_TONE: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent',
  pos: 'text-pos',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

interface ArcProps {
  value: number;
  max: number;
  bands: readonly GaugeBand[];
  needle: boolean;
  width: number;
  mounted: boolean;
  label: string;
  /**
   * The RESOLVED tone of this reading — passed in, never re-derived here. In
   * cluster mode an item may declare its own tone (the annex's cluster contract
   * is `{label, pct, tone}`), and that tone already colours the cell's label and
   * value; deriving the sweep's colour from `bandFor(value, bands)` instead
   * would let one cell paint a green arc under a red reading.
   */
  tone: Tone;
}

/** The bare arc canvas — geometry only, no chrome. */
function Arc({ value, max, bands, needle, width, mounted, label, tone }: ArcProps) {
  const geometry = gaugeArcGeometry(value, max, bands, { width });
  const rest = gaugeArcGeometry(0, max, bands, { width });

  return (
    <svg
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      role="img"
      aria-label={label}
      data-export-node=""
      className="overflow-visible"
    >
      <path
        d={geometry.trackPath}
        fill="none"
        strokeWidth={geometry.thickness}
        strokeLinecap="round"
        className="stroke-surface-3"
      />
      {geometry.bandSegments.map((segment, index) => (
        <path
          key={`${segment.tone}-${index}`}
          data-part="gauge-band"
          data-tone={segment.tone}
          d={segment.path}
          fill="none"
          strokeWidth={geometry.thickness}
          // Bands are the qualitative backdrop; the value sweep reads on top.
          className={`opacity-30 ${STROKE_TONE[segment.tone]}`}
        />
      ))}
      <path
        data-part="gauge-value"
        d={mounted ? geometry.valuePath : rest.valuePath}
        fill="none"
        strokeWidth={geometry.thickness}
        strokeLinecap="round"
        className={STROKE_TONE[tone]}
      />
      {needle ? (
        <g
          data-part="gauge-needle"
          className="transition-opacity duration-500 ease-out motion-reduce:transition-none"
          opacity={mounted ? 1 : 0}
        >
          <line
            x1={geometry.cx}
            y1={geometry.cy}
            x2={mounted ? geometry.needle.x : rest.needle.x}
            y2={mounted ? geometry.needle.y : rest.needle.y}
            strokeWidth={2.5}
            strokeLinecap="round"
            className={`transition-all duration-700 ease-out motion-reduce:transition-none ${STROKE_TONE[tone]}`}
          />
          <circle cx={geometry.cx} cy={geometry.cy} r={4} className={FILL_TONE[tone]} />
        </g>
      ) : null}
    </svg>
  );
}

/** One cluster cell: a small arc + its label and value (annex §1 cluster mode). */
function ClusterCell({
  label,
  value,
  max,
  bands,
  needle,
  mounted,
  text,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  bands: readonly GaugeBand[];
  needle: boolean;
  mounted: boolean;
  text: string;
  tone: Tone;
}) {
  return (
    <div className="flex flex-col items-center gap-1" data-part="gauge-cell" data-tone={tone}>
      <Arc
        value={value}
        max={max}
        bands={bands}
        needle={needle}
        width={110}
        mounted={mounted}
        label={`${label}: ${text}`}
        tone={tone}
      />
      <MonoText className={`text-body-sm font-bold leading-none ${TEXT_TONE[tone]}`}>{text}</MonoText>
      <span className="max-w-full truncate text-micro uppercase tracking-wide text-fg-subtle">{label}</span>
    </div>
  );
}

/** Format one gauge reading with the config's unit suffix. */
function readingOf(value: number, config: GaugeArcConfig, opts: MetricFormatOptions): string {
  const text = formatMetricValue(value, config.valueFormat, opts);
  return config.unit === undefined ? text : `${text}${config.unit}`;
}

/** Cluster-mode grid columns — a lookup table so Tailwind sees the literals. */
const GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

export function GaugeArc({ config, data }: WidgetProps<GaugeArcConfig>) {
  const mounted = useMountAnimation();
  const opts = formatOptionsOf(config);

  if (config.cluster) {
    const categorical = asCategorical(data);
    if (categorical === null) {
      return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
    }
    // A categorical payload with no items is EMPTY, not malformed — an SLA or
    // system-health query is allowed to return zero rows. The frame can't route
    // it (see `emptyTitle` in kpi-config), so the per-widget empty copy is here
    // rather than the developer-facing "unexpected shape" line above.
    if (categorical.items.length === 0) {
      return (
        <EmptyState
          compact
          preset="no-data"
          title={config.emptyTitle ?? 'No gauges to show'}
          body={config.emptyBody ?? 'Services appear here as gauges once there is a reading for them.'}
        />
      );
    }
    return (
      <div
        className={`grid h-full content-center gap-3 px-4 pb-4 compact:px-3 compact:pb-3 ${GRID_COLUMNS[config.columns] ?? 'grid-cols-2'}`}
        data-widget="gauge-arc"
        data-cluster="true"
      >
        {categorical.items.map((item) => {
          const value = clampValue(item.value, config.max);
          const tone = toneOf(item.tone, bandFor(value, config.bands)?.tone ?? 'accent');
          return (
            <ClusterCell
              key={item.key}
              label={item.label}
              value={value}
              max={config.max}
              bands={config.bands}
              needle={config.needle}
              mounted={mounted}
              text={readingOf(value, config, opts)}
              tone={tone}
            />
          );
        })}
      </div>
    );
  }

  const metric = asSingleMetric(data);
  if (metric === null) {
    return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }
  const value = clampValue(metric.value, config.max);
  const band = bandFor(value, config.bands);
  const tone: Tone = band?.tone ?? 'accent';
  const text = readingOf(value, config, opts);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 px-4 pb-4 compact:px-3 compact:pb-3"
      data-widget="gauge-arc"
      data-cluster="false"
      data-tone={tone}
    >
      <Arc
        value={value}
        max={config.max}
        bands={config.bands}
        needle={config.needle}
        width={180}
        mounted={mounted}
        label={`${band?.label === undefined ? '' : `${band.label}: `}${text}`}
        tone={tone}
      />
      <MonoText data-part="gauge-value-text" className="text-[22px] font-bold leading-none text-fg">
        {text}
      </MonoText>
      {band?.label === undefined ? null : (
        <span className={`text-micro font-bold uppercase tracking-wide ${TEXT_TONE[tone]}`}>{band.label}</span>
      )}
    </div>
  );
}
