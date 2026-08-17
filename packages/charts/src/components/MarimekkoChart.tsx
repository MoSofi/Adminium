// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-marimekko` primitive (research/widget-registry.md §2): column width =
 * outer share, stacked vertical segments = inner mix, with in-cell labels past
 * a size threshold. Composed from ChartSurface + pure `layoutMarimekko`
 * geometry (a §3 `matrix`). Segment color cycles the viz palette by row;
 * columns mirror in RTL; segments fade in on mount.
 */
import type { ReactNode } from 'react';

import { layoutMarimekko } from '../geometry/marimekko.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface MarimekkoChartProps {
  rowKeys: readonly string[];
  colKeys: readonly string[];
  cells: readonly (readonly number[])[];
  labels: ChartLabels;
  height?: number;
  /** Minimum segment height (px) to render its in-cell label (default 18). */
  labelThreshold?: number;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function MarimekkoChart({
  rowKeys,
  colKeys,
  cells,
  labels,
  height = 260,
  labelThreshold = 18,
  dir,
  a11yFallback,
  className,
}: MarimekkoChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 18, bottom: 4, left: 2, right: 2 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (rowKeys.length === 0 || colKeys.length === 0 || innerWidth <= 0 || innerHeight <= 0) {
          return null;
        }
        const layout = layoutMarimekko(rowKeys, colKeys, cells, {
          width: innerWidth,
          height: innerHeight,
          rtl,
        });

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {layout.columns.map((column) => (
              <g key={column.colKey} data-col={column.colIndex}>
                {column.segments.map((segment) => (
                  <g key={segment.rowKey} data-seg={`${column.colIndex}-${segment.rowIndex}`}>
                    <rect
                      x={column.x}
                      y={segment.y}
                      width={column.width}
                      height={Math.max(0, segment.height - 1)}
                      fill={`var(--viz-${(segment.rowIndex % 8) + 1})`}
                    />
                    {segment.height >= labelThreshold && column.width >= 44 && (
                      <text
                        className="adm-chart-label"
                        x={column.x + column.width / 2}
                        y={segment.y + segment.height / 2 + 3}
                        textAnchor="middle"
                        fill="var(--surface)"
                      >
                        {segment.rowKey}
                      </text>
                    )}
                  </g>
                ))}
                {/* Column header (in the top padding band): outer label + share. */}
                <text
                  className="adm-chart-axis-label"
                  x={column.x + column.width / 2}
                  y={-10}
                  textAnchor="middle"
                >
                  {column.colKey}
                </text>
                <text
                  className="adm-chart-num"
                  x={column.x + column.width / 2}
                  y={-1}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--fg-subtle)"
                >
                  {formatPercent(column.share)}
                </text>
              </g>
            ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
