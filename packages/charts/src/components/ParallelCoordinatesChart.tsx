// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-parallel-coordinates` primitive (research/widget-registry.md §2):
 * evenly spaced vertical axes with one colored polyline per record. Axis order
 * mirrors in RTL. Values normalise within each axis's [min, max]. Records are
 * colored by segment from the viz palette. Fade-in on mount.
 */
import type { ReactNode } from 'react';

import { parallelLayout } from '../geometry/correlation.js';
import type { ParallelAxisInput, ParallelRecordInput } from '../geometry/correlation.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';
import { vizColorAt } from './ScatterBubbleChart.js';

export interface ParallelCoordinatesChartProps {
  axes: readonly ParallelAxisInput[];
  records: readonly ParallelRecordInput[];
  labels: ChartLabels;
  height?: number;
  showAxisLabels?: boolean;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function ParallelCoordinatesChart({
  axes,
  records,
  labels,
  height = 280,
  showAxisLabels = true,
  dir,
  a11yFallback,
  className,
}: ParallelCoordinatesChartProps) {
  const pad = { top: 12, bottom: showAxisLabels ? 22 : 8, near: 20, far: 20 };

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
        if (axes.length === 0 || records.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = parallelLayout(axes, records, { width: innerWidth, height: innerHeight, rtl });
        const recordColor = (segment: string | undefined): string =>
          segment === undefined ? 'var(--viz-1)' : vizColorAt(layout.segments.indexOf(segment));

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {layout.axisX.map((x, i) => (
              <line
                key={axes[i]?.key ?? i}
                x1={x}
                x2={x}
                y1={layout.yTop}
                y2={layout.yBottom}
                stroke="var(--border-strong)"
                strokeWidth={1}
                data-axis-index={i}
              />
            ))}

            {layout.paths.map((record) => (
              <path
                key={record.index}
                d={record.path}
                fill="none"
                stroke={recordColor(record.segment)}
                strokeWidth={1.5}
                strokeOpacity={0.7}
                strokeLinejoin="round"
                data-record-index={record.index}
                {...(record.segment !== undefined ? { 'data-segment': record.segment } : {})}
              />
            ))}

            {showAxisLabels &&
              layout.axisX.map((x, i) => (
                <text
                  key={`label-${axes[i]?.key ?? i}`}
                  className="adm-chart-axis-label"
                  x={x}
                  y={innerHeight + 15}
                  textAnchor="middle"
                >
                  {axes[i]?.label ?? ''}
                </text>
              ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
