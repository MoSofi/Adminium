// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-scatter-bubble` primitive (research/widget-registry.md §2): SVG scatter
 * with an optional bubble-radius dimension, gridlines, a dashed least-squares
 * trend line, and segment colors. The x value axis mirrors in RTL; y stays
 * pixel-down. Token-only colors; fade-in on mount (radius/opacity settle to
 * final state immediately under reduced motion).
 */
import type { ReactNode } from 'react';

import { scatterLayout } from '../geometry/correlation.js';
import type { ScatterPointInput } from '../geometry/correlation.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

/** Canonical 8-color viz palette (viz.css); series i → --viz-((i mod 8)+1). */
const VIZ_VARS = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
  'var(--viz-5)',
  'var(--viz-6)',
  'var(--viz-7)',
  'var(--viz-8)',
] as const;

export function vizColorAt(index: number): string {
  return VIZ_VARS[((index % VIZ_VARS.length) + VIZ_VARS.length) % VIZ_VARS.length] as string;
}

export interface ScatterBubbleChartProps {
  points: readonly ScatterPointInput[];
  labels: ChartLabels;
  height?: number;
  showAxis?: boolean;
  trendLine?: boolean;
  formatX?: (x: number) => string;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function ScatterBubbleChart({
  points,
  labels,
  height = 280,
  showAxis = true,
  trendLine = true,
  formatX = formatCompact,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: ScatterBubbleChartProps) {
  const pad = { top: 10, bottom: showAxis ? 22 : 8, near: showAxis ? 40 : 8, far: 14 };

  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: pad.top, bottom: pad.bottom, left: pad.near, right: pad.far }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (points.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = scatterLayout(points, { width: innerWidth, height: innerHeight, rtl, trendLine });
        const segmentColor = (segment: string | undefined): string =>
          segment === undefined ? 'var(--viz-1)' : vizColorAt(layout.segments.indexOf(segment));

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {showAxis &&
              layout.yTicks.map((tick) => (
                <g key={`y${tick}`}>
                  <line
                    className="adm-chart-gridline"
                    x1={0}
                    x2={innerWidth}
                    y1={layout.yFor(tick)}
                    y2={layout.yFor(tick)}
                  />
                  <text
                    className="adm-chart-axis-label adm-chart-num"
                    x={rtl ? innerWidth + 6 : -6}
                    y={layout.yFor(tick) + 3}
                    textAnchor={rtl ? 'start' : 'end'}
                  >
                    {formatY(tick)}
                  </text>
                </g>
              ))}

            {showAxis &&
              layout.xTicks.map((tick) => (
                <text
                  key={`x${tick}`}
                  className="adm-chart-axis-label adm-chart-num"
                  x={layout.xFor(tick)}
                  y={innerHeight + 15}
                  textAnchor="middle"
                >
                  {formatX(tick)}
                </text>
              ))}

            {trendLine && layout.trend !== null && (
              <line
                x1={layout.trend.x1}
                y1={layout.trend.y1}
                x2={layout.trend.x2}
                y2={layout.trend.y2}
                stroke="var(--fg-subtle)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                data-trend=""
              />
            )}

            {layout.marks.map((mark) => (
              <circle
                key={mark.index}
                cx={mark.cx}
                cy={mark.cy}
                r={mark.r}
                fill={segmentColor(mark.segment)}
                fillOpacity={0.72}
                stroke="var(--surface)"
                strokeWidth={1}
                data-point-index={mark.index}
                {...(mark.segment !== undefined ? { 'data-segment': mark.segment } : {})}
              />
            ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
