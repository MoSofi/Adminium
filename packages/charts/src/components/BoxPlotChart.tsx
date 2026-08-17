// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-boxplot` primitive (research/widget-registry.md §2): whisker/box/median
 * per category with a y-axis tick scale. Categorical x mirrors in RTL (band
 * range flip); the value axis stays pixel-down. Token-only colors; fade-in on
 * mount with the reduced-motion fallback baked into `useMountAnimation`.
 */
import type { ReactNode } from 'react';

import { boxplotLayout } from '../geometry/distribution.js';
import type { BoxplotGroupInput } from '../geometry/distribution.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface BoxPlotChartProps {
  groups: readonly BoxplotGroupInput[];
  labels: ChartLabels;
  height?: number;
  showAxis?: boolean;
  showCategoryLabels?: boolean;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function BoxPlotChart({
  groups,
  labels,
  height = 260,
  showAxis = true,
  showCategoryLabels = true,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: BoxPlotChartProps) {
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
        const layout = boxplotLayout(groups, { width: innerWidth, height: innerHeight, rtl });

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

            {layout.boxes.map((box) => {
              const capHalf = box.boxWidth / 2;
              return (
                <g key={box.label} data-box={box.label}>
                  {/* Whisker spine + min/max caps. */}
                  <line x1={box.centerX} x2={box.centerX} y1={box.yMax} y2={box.yMin} stroke="var(--viz-1)" strokeWidth={1.5} />
                  <line
                    x1={box.centerX - capHalf / 2}
                    x2={box.centerX + capHalf / 2}
                    y1={box.yMax}
                    y2={box.yMax}
                    stroke="var(--viz-1)"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={box.centerX - capHalf / 2}
                    x2={box.centerX + capHalf / 2}
                    y1={box.yMin}
                    y2={box.yMin}
                    stroke="var(--viz-1)"
                    strokeWidth={1.5}
                  />
                  {/* Interquartile box. */}
                  <rect
                    x={box.boxX}
                    y={box.yQ3}
                    width={box.boxWidth}
                    height={Math.max(0, box.yQ1 - box.yQ3)}
                    rx={2}
                    fill="var(--accent-area)"
                    stroke="var(--viz-1)"
                    strokeWidth={1.5}
                    data-box-rect=""
                  />
                  {/* Median. */}
                  <line
                    x1={box.boxX}
                    x2={box.boxX + box.boxWidth}
                    y1={box.yMed}
                    y2={box.yMed}
                    stroke="var(--viz-1)"
                    strokeWidth={2}
                    data-median=""
                  />
                </g>
              );
            })}

            {showCategoryLabels &&
              layout.boxes.map((box) => (
                <text
                  key={box.label}
                  className="adm-chart-axis-label"
                  x={box.centerX}
                  y={innerHeight + 15}
                  textAnchor="middle"
                >
                  {box.label}
                </text>
              ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
