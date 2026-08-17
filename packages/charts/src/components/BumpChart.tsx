// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-bump` primitive (research/widget-registry.md §2): rank-over-time
 * polylines with hollow dots and end labels (channel rank). Rank is an ordinal
 * axis, so the period axis mirrors in RTL (04 §7.4 — rankings mirror) and end
 * labels sit on the inline-end. Colors from the viz palette only.
 */
import type { ReactNode } from 'react';

import { layoutBump } from '../geometry/bump.js';
import type { BumpSeries } from '../geometry/bump.js';
import { multiSeriesPaths, seriesColorVar } from '../geometry/multiLine.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface BumpChartProps {
  series: readonly BumpSeries[];
  labels: ChartLabels;
  /** Number of ordered periods (x buckets). */
  periods: number;
  /** Worst rank shown (y extent). */
  maxRank: number;
  /** Period axis tick labels (bottom); defaults to 1…periods. */
  periodLabels?: readonly string[];
  height?: number;
  showEndLabels?: boolean;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const SIDE_PAD = 54;

export function BumpChart({
  series,
  labels,
  periods,
  maxRank,
  periodLabels,
  height = 240,
  showEndLabels = true,
  dir,
  a11yFallback,
  className,
}: BumpChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 10, bottom: 22, left: SIDE_PAD, right: SIDE_PAD }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (series.length === 0 || periods <= 0 || maxRank <= 0 || innerWidth <= 0 || innerHeight <= 0) {
          return null;
        }

        const layout = layoutBump(series, periods, maxRank, innerWidth, innerHeight, rtl);
        const paths = multiSeriesPaths(
          layout.lines.map((l) => ({ key: l.key, label: l.label, points: l.points })),
          false,
        );

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {/* Rank rows as subtle guides. */}
            {Array.from({ length: maxRank }, (_, r) => (
              <line
                key={r}
                className="adm-chart-gridline"
                x1={0}
                x2={innerWidth}
                y1={layout.yForRank(r + 1)}
                y2={layout.yForRank(r + 1)}
              />
            ))}

            {/* Period axis labels. */}
            {Array.from({ length: periods }, (_, i) => (
              <text
                key={`period-${i}`}
                className="adm-chart-axis-label"
                x={layout.xForPeriod(i)}
                y={innerHeight + 15}
                textAnchor="middle"
              >
                {periodLabels?.[i] ?? String(i + 1)}
              </text>
            ))}

            {paths.map((sp, i) =>
              sp.path === null ? null : (
                <path
                  key={sp.key}
                  d={sp.path}
                  fill="none"
                  stroke={seriesColorVar(i)}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  data-series={sp.key}
                />
              ),
            )}

            {layout.lines.map((line, i) =>
              line.points.map((point, j) => (
                <circle
                  key={`${line.key}-${j}`}
                  cx={point.x}
                  cy={point.y}
                  r={3.5}
                  fill="var(--surface)"
                  stroke={seriesColorVar(i)}
                  strokeWidth={2}
                  data-series-dot={line.key}
                />
              )),
            )}

            {showEndLabels &&
              paths.map((sp, i) =>
                sp.end === null ? null : (
                  <text
                    key={`${sp.key}-label`}
                    x={sp.end.x + (rtl ? -8 : 8)}
                    y={sp.end.y + 3}
                    textAnchor={rtl ? 'end' : 'start'}
                    fontSize={10}
                    fontWeight={600}
                    fill={seriesColorVar(i)}
                    data-series-label={sp.key}
                  >
                    {sp.label}
                  </text>
                ),
              )}
          </g>
        );
      }}
    </ChartSurface>
  );
}
