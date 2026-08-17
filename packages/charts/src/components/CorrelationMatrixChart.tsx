// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-correlation-matrix` primitive (research/widget-registry.md §2): n×n grid
 * of Pearson r, accent for positive / danger for negative, fill opacity by |r|,
 * mono values that flip to the accent foreground past a strong threshold.
 * Column order mirrors in RTL. Fade-in on mount.
 */
import type { ReactNode } from 'react';

import { matrixGridLayout } from '../geometry/correlation.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface CorrelationMatrixChartProps {
  /** Square correlation grid: cells[row][col] ∈ [-1, 1] (null = blank). */
  cells: readonly (readonly (number | null)[])[];
  columns: readonly string[];
  labels: ChartLabels;
  height?: number;
  showLabels?: boolean;
  /** |r| above which cell text uses the accent foreground (default 0.55). */
  strongThreshold?: number;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

function formatR(value: number): string {
  const fixed = value.toFixed(2);
  return fixed === '-0.00' ? '0.00' : fixed;
}

export function CorrelationMatrixChart({
  cells,
  columns,
  labels,
  height = 260,
  showLabels = true,
  strongThreshold = 0.55,
  dir,
  a11yFallback,
  className,
}: CorrelationMatrixChartProps) {
  const rows = cells.length;
  const cols = columns.length;
  const pad = { top: showLabels ? 18 : 6, bottom: 6, near: showLabels ? 68 : 6, far: 8 };

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
        if (rows === 0 || cols === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = matrixGridLayout({ rows, cols, width: innerWidth, height: innerHeight, rtl });
        const showText = layout.cellW >= 26 && layout.cellH >= 18;

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {layout.cells.map((cell) => {
              const r = cells[cell.row]?.[cell.col];
              if (typeof r !== 'number') return null;
              const magnitude = Math.min(1, Math.abs(r));
              const strong = magnitude >= strongThreshold;
              return (
                <g key={`${cell.row}-${cell.col}`} data-cell-row={cell.row} data-cell-col={cell.col}>
                  <rect
                    x={cell.x}
                    y={cell.y}
                    width={cell.w}
                    height={cell.h}
                    rx={3}
                    fill={r >= 0 ? 'var(--accent)' : 'var(--danger)'}
                    fillOpacity={0.12 + magnitude * 0.88}
                    data-sign={r >= 0 ? 'pos' : 'neg'}
                  />
                  {showText && (
                    <text
                      className="adm-chart-num"
                      x={cell.x + cell.w / 2}
                      y={cell.y + cell.h / 2 + 3}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      fill={strong ? 'var(--accent-fg)' : 'var(--fg-muted)'}
                    >
                      {formatR(r)}
                    </text>
                  )}
                </g>
              );
            })}

            {showLabels &&
              columns.map((label, col) => (
                <text
                  key={`col-${label}`}
                  className="adm-chart-axis-label"
                  x={layout.colX(col) + layout.cellW / 2}
                  y={-6}
                  textAnchor="middle"
                >
                  {label}
                </text>
              ))}

            {showLabels &&
              columns.map((label, row) =>
                row < rows ? (
                  <text
                    key={`row-${label}`}
                    className="adm-chart-axis-label"
                    x={rtl ? innerWidth + 6 : -6}
                    y={layout.rowY(row) + layout.cellH / 2 + 3}
                    textAnchor={rtl ? 'start' : 'end'}
                  >
                    {label}
                  </text>
                ) : null,
              )}
          </g>
        );
      }}
    </ChartSurface>
  );
}
