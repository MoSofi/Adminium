// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-stream` primitive (research/widget-registry.md §2): centered stacked
 * "stream" bands over time with a legend (traffic composition). Time x never
 * mirrors; categorical x mirrors in RTL, and the legend — HTML below the
 * surface, like the donut family — lays out in the reading direction (04 §7.4).
 * Colors strictly from the viz palette.
 */
import type { ReactNode } from 'react';

import { bandAreaPath, stackStream } from '../geometry/streamStack.js';
import type { StreamInputSeries } from '../geometry/streamStack.js';
import { seriesColorVar } from '../geometry/multiLine.js';
import { categoricalPointScale, linearYScale, timeScale } from '../geometry/scales.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { extent } from '../utils/stats.js';
import type { MultiLineSeries } from './MultiLineChart.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface StreamChartProps {
  series: readonly MultiLineSeries[];
  labels: ChartLabels;
  height?: number;
  /** Smooth basis-spline bands (default true). */
  smooth?: boolean;
  showLegend?: boolean;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

/** Height the HTML legend below the surface is allowed, so the component still
    occupies exactly `height` (one 11px row plus its 8px margin). */
const LEGEND_BLOCK_H = 22;

export function StreamChart({
  series,
  labels,
  height = 260,
  smooth = true,
  showLegend = true,
  dir,
  a11yFallback,
  className,
}: StreamChartProps) {
  const resolvedDir = useChartDir(dir);
  const isTime = series[0]?.points[0]?.x instanceof Date;
  const drawable = series.filter((s) => s.points.length > 0);

  return (
    <div className={className} {...(dir !== undefined ? { dir: resolvedDir } : {})}>
      <ChartSurface
        labels={labels}
        height={showLegend ? Math.max(0, height - LEGEND_BLOCK_H) : height}
        {...(dir !== undefined ? { dir } : {})}
        {...(a11yFallback !== undefined ? { a11yFallback } : {})}
        padding={{ top: 8, bottom: 8, left: 6, right: 6 }}
      >
        {({ innerWidth, innerHeight, rtl, mounted }) => {
          if (drawable.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

          // `stackStream` builds band arrays of length = MAX point-count across
          // every series, so `xs` must span the same index range. Deriving it
          // from only the first series collapses band indices past that series'
          // length onto x=0; use the longest series as the x spine instead.
          const spine = drawable.reduce((a, b) => (b.points.length > a.points.length ? b : a));
          const xs = isTime
            ? (() => {
                const times = drawable.flatMap((s) =>
                  s.points.map((p) => (p.x instanceof Date ? p.x.getTime() : 0)),
                );
                const [lo, hi] = extent(times) ?? [0, 1];
                const scale = timeScale([new Date(lo), new Date(hi)], innerWidth);
                return spine.points.map((p) => scale(p.x instanceof Date ? p.x : new Date(0)));
              })()
            : (() => {
                const domain = spine.points.map((p) => String(p.x));
                const scale = categoricalPointScale(domain, innerWidth, rtl);
                return domain.map((d) => scale(d) ?? 0);
              })();

          const inputs: StreamInputSeries[] = drawable.map((s) => ({
            key: s.key,
            label: s.label,
            values: s.points.map((p) => p.y),
          }));
          const { bands, min, max } = stackStream(inputs, 'silhouette');
          const yScale = linearYScale([min, max], innerHeight);

          return (
            <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
              {bands.map((band, i) => {
                const low = band.low.map((v) => yScale(v));
                const high = band.high.map((v) => yScale(v));
                const path = bandAreaPath(xs, low, high, smooth);
                return path === null ? null : (
                  <path
                    key={band.key}
                    d={path}
                    fill={seriesColorVar(i)}
                    fillOpacity={0.82}
                    stroke="var(--surface)"
                    strokeWidth={0.75}
                    data-series={band.key}
                  />
                );
              })}
            </g>
          );
        }}
      </ChartSurface>

      {/* The legend used to be hand-laid-out inside the SVG, estimating each
          entry's width from its character count and taking 20px off the plot.
          HTML wraps and mirrors on its own. */}
      {showLegend && (
        <ul className="adm-legend">
          {drawable.map((s, i) => (
            <li key={s.key} className="adm-legend-row" data-legend-item={s.key}>
              <span className="adm-legend-dot" style={{ '--adm-dot': seriesColorVar(i) }} aria-hidden="true" />
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
