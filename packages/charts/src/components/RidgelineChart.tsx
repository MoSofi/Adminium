/**
 * `chart-ridgeline` primitive (research/widget-registry.md §2): overlapping
 * filled density ridges with decreasing alpha, one ridge per group (front row
 * first). The value axis runs across the plot width and mirrors in RTL; group
 * labels sit in the inline-start gutter. Token-only colors; fade-in on mount.
 */
import type { ReactNode } from 'react';

import { ridgelineLayout } from '../geometry/distribution.js';
import type { RidgeGroupInput } from '../geometry/distribution.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface RidgelineChartProps {
  groups: readonly RidgeGroupInput[];
  labels: ChartLabels;
  height?: number;
  /** Peak height as a multiple of the row step (annex `overlap`). */
  overlap?: number;
  showLabels?: boolean;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function RidgelineChart({
  groups,
  labels,
  height = 260,
  overlap = 1.5,
  showLabels = true,
  dir,
  a11yFallback,
  className,
}: RidgelineChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 10, bottom: 8, left: 8, right: 8 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (groups.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = ridgelineLayout(groups, {
          width: innerWidth,
          height: innerHeight,
          rtl,
          overlap,
          labelGutter: showLabels ? 52 : 8,
        });

        // Render back-to-front so nearer ridges overlap farther ones.
        const ordered = [...layout.rows].reverse();

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {ordered.map((row) => (
              <g key={row.label} data-ridge={row.label}>
                <path
                  d={row.areaPath}
                  fill="var(--accent)"
                  fillOpacity={row.alpha * 0.55}
                  data-ridge-area=""
                />
                <path
                  d={row.linePath}
                  fill="none"
                  stroke="var(--viz-1)"
                  strokeWidth={1.5}
                  strokeOpacity={row.alpha}
                  data-ridge-line=""
                />
                {showLabels && (
                  <text
                    className="adm-chart-axis-label"
                    x={rtl ? innerWidth : 0}
                    y={row.labelY}
                    textAnchor={rtl ? 'end' : 'start'}
                  >
                    {row.label}
                  </text>
                )}
              </g>
            ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
