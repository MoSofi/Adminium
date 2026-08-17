// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-bar` primitive (research/widget-registry.md §2): categorical columns
 * with highlight max|current|none, grouped 2-series mode, RTL category
 * mirroring (band-scale range flip), nb-grow-style mount animation.
 */
import type { ReactNode } from 'react';

import { highlightIndex, layoutBars } from '../geometry/bars.js';
import type { HighlightMode } from '../geometry/bars.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface BarSeries {
  name: string;
  values: readonly number[];
}

export interface BarChartProps {
  categories: readonly string[];
  /** 1 series = plain columns; 2 series = grouped mode. */
  series: readonly BarSeries[];
  labels: ChartLabels;
  /** Ignored in grouped mode. Default 'max'. */
  highlight?: HighlightMode;
  height?: number;
  /** Show y gridlines + tick labels (default true). */
  showAxis?: boolean;
  /** Show category labels under the columns (default true). */
  showCategoryLabels?: boolean;
  barRadius?: number;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

/** Series color assignment: grouped mode viz-1/viz-2; single series uses the
 * accent ramp with the highlighted column at full accent. */
const GROUPED_FILLS = ['var(--viz-1)', 'var(--viz-2)'] as const;

export function BarChart({
  categories,
  series,
  labels,
  highlight = 'max',
  height = 220,
  showAxis = true,
  showCategoryLabels = true,
  barRadius = 3,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: BarChartProps) {
  const axisPad = {
    top: 8,
    bottom: showCategoryLabels ? 22 : 6,
    near: showAxis ? 38 : 6,
    far: 8,
  };
  const grouped = series.length > 1;

  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: axisPad.top, bottom: axisPad.bottom, left: axisPad.near, right: axisPad.far }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (categories.length === 0 || series.length === 0 || innerWidth <= 0 || innerHeight <= 0) {
          return null;
        }

        const layout = layoutBars({
          categories,
          series: series.map((s) => s.values),
          width: innerWidth,
          height: innerHeight,
          rtl,
        });
        const highlighted = grouped ? -1 : highlightIndex([...(series[0]?.values ?? [])], highlight);

        return (
          <g>
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

            {layout.bars.map((bar) => {
              const fill = grouped
                ? GROUPED_FILLS[bar.seriesIndex % 2]
                : bar.categoryIndex === highlighted
                  ? 'var(--accent)'
                  : 'var(--viz-ramp-3)';
              return (
                <rect
                  key={`${bar.categoryIndex}-${bar.seriesIndex}`}
                  className="adm-chart-grow"
                  style={{ '--adm-grow': mounted ? '1' : '0', '--adm-stagger': `${bar.categoryIndex * 80}ms` }}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx={barRadius}
                  fill={fill}
                  data-category-index={bar.categoryIndex}
                  data-series-index={bar.seriesIndex}
                  data-highlighted={bar.categoryIndex === highlighted ? '' : undefined}
                />
              );
            })}

            {showCategoryLabels &&
              layout.categoryCenters.map((center) => (
                <text
                  key={center.label}
                  className="adm-chart-axis-label"
                  x={center.x}
                  y={innerHeight + 15}
                  textAnchor="middle"
                >
                  {center.label}
                </text>
              ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
