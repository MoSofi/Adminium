// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-anomaly` primitive (research/widget-registry.md §2): actual line over
 * an expected-range band + dashed expected line + halo dots on anomalies. A
 * time axis (never mirrors, 04 §7.4). The expected band + anomaly flags are
 * computed by the pure `anomalyModel` (z-score). Colors from the viz palette
 * and the danger token only.
 */
import type { ReactNode } from 'react';

import { anomalyModel } from '../geometry/anomaly.js';
import { confidenceBandPath } from '../geometry/forecast.js';
import { linePath } from '../geometry/lineArea.js';
import type { XYPoint } from '../geometry/lineArea.js';
import { linearYScale, timeScale } from '../geometry/scales.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { extent, niceTicks } from '../utils/stats.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface AnomalyPoint {
  x: Date;
  y: number;
}

export interface AnomalyChartProps {
  points: readonly AnomalyPoint[];
  labels: ChartLabels;
  height?: number;
  /** z-score threshold for flagging anomalies (default 2). */
  sensitivity?: number;
  /** Centered moving-average window for the expected line (default 7). */
  window?: number;
  showAxis?: boolean;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function AnomalyChart({
  points,
  labels,
  height = 220,
  sensitivity = 2,
  window = 7,
  showAxis = true,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: AnomalyChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 10, bottom: showAxis ? 22 : 8, left: showAxis ? 38 : 6, right: 10 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (points.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

        const dates = points.map((p) => p.x.getTime());
        const [loT, hiT] = extent(dates) ?? [0, 1];
        const xScale = timeScale([new Date(loT), new Date(hiT)], innerWidth);

        const values = points.map((p) => p.y);
        const model = anomalyModel(values, sensitivity, window);

        const ys = [...values, ...model.lo, ...model.hi];
        const [minY, maxY] = extent(ys) ?? [0, 1];
        const yTicks = niceTicks(Math.min(0, minY), Math.max(1, maxY), 3);
        const yScale = linearYScale([yTicks[0] ?? 0, yTicks.at(-1) ?? 1], innerHeight);

        const xAt = (i: number) => xScale(points[i]!.x);
        const upper: XYPoint[] = points.map((_, i) => ({ x: xAt(i), y: yScale(model.hi[i] ?? 0) }));
        const lower: XYPoint[] = points.map((_, i) => ({ x: xAt(i), y: yScale(model.lo[i] ?? 0) }));
        const bandPath = confidenceBandPath(upper, lower);
        const midLine = linePath(points.map((_, i) => ({ x: xAt(i), y: yScale(model.mid[i] ?? 0) })), true);
        const actualLine = linePath(points.map((p, i) => ({ x: xAt(i), y: yScale(p.y) })), false);

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {showAxis &&
              yTicks.map((tick) => (
                <g key={tick}>
                  <line className="adm-chart-gridline" x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} />
                  <text
                    className="adm-chart-axis-label adm-chart-num"
                    x={rtl ? innerWidth + 6 : -6}
                    y={yScale(tick) + 3}
                    textAnchor={rtl ? 'start' : 'end'}
                  >
                    {formatY(tick)}
                  </text>
                </g>
              ))}

            {bandPath !== null && (
              <path d={bandPath} fill="var(--viz-1)" fillOpacity={0.12} stroke="none" data-band="expected" />
            )}
            {midLine !== null && (
              <path
                d={midLine}
                fill="none"
                stroke="var(--fg-subtle)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                data-series="expected"
              />
            )}
            {actualLine !== null && (
              <path
                d={actualLine}
                fill="none"
                stroke="var(--viz-1)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                data-series="actual"
              />
            )}

            {model.anomalies.map((i) => (
              <g key={`anomaly-${i}`} data-anomaly={i}>
                <circle cx={xAt(i)} cy={yScale(values[i] ?? 0)} r={7} fill="var(--danger)" fillOpacity={0.22} />
                <circle
                  cx={xAt(i)}
                  cy={yScale(values[i] ?? 0)}
                  r={3.5}
                  fill="var(--danger)"
                  stroke="var(--surface)"
                  strokeWidth={1.5}
                />
              </g>
            ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
