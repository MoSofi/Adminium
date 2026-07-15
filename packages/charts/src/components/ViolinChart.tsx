/**
 * `chart-violin` primitive (research/widget-registry.md §2): mirrored density
 * profiles with a median line, one violin per group. Categorical x mirrors in
 * RTL; the value axis stays pixel-down. Token-only colors; fade-in on mount.
 */
import type { ReactNode } from 'react';

import { violinLayout } from '../geometry/distribution.js';
import type { ViolinGroupInput } from '../geometry/distribution.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface ViolinChartProps {
  groups: readonly ViolinGroupInput[];
  labels: ChartLabels;
  height?: number;
  showAxis?: boolean;
  showCategoryLabels?: boolean;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function ViolinChart({
  groups,
  labels,
  height = 260,
  showAxis = true,
  showCategoryLabels = true,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: ViolinChartProps) {
  const pad = {
    top: 8,
    bottom: showCategoryLabels ? 22 : 6,
    near: showAxis ? 40 : 6,
    far: 10,
  };

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
        if (groups.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = violinLayout(groups, { width: innerWidth, height: innerHeight, rtl });

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {showAxis &&
              layout.yTicks.map((tick) => (
                <g key={tick}>
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

            {layout.violins.map((violin) => (
              <g key={violin.label} data-violin={violin.label}>
                <path
                  d={violin.path}
                  fill="var(--accent-area)"
                  stroke="var(--viz-1)"
                  strokeWidth={1.5}
                  data-violin-path=""
                />
                <line
                  x1={violin.centerX - layout.bandwidth * 0.24}
                  x2={violin.centerX + layout.bandwidth * 0.24}
                  y1={violin.medY}
                  y2={violin.medY}
                  stroke="var(--viz-1)"
                  strokeWidth={2}
                  data-median=""
                />
              </g>
            ))}

            {showCategoryLabels &&
              layout.violins.map((violin) => (
                <text
                  key={violin.label}
                  className="adm-chart-axis-label"
                  x={violin.centerX}
                  y={innerHeight + 15}
                  textAnchor="middle"
                >
                  {violin.label}
                </text>
              ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
