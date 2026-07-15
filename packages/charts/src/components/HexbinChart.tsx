/**
 * `chart-hexbin` primitive (research/widget-registry.md §2): hex-grid density
 * tiles, alpha by count, sparse (null/0) cells omitted. The grid mirrors in RTL
 * (columns flip). Intensity uses the accent color at a count-scaled fill
 * opacity (sequential ramp, 02-design-system.md §1.3). Fade-in on mount.
 */
import type { ReactNode } from 'react';

import { hexbinLayout } from '../geometry/correlation.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface HexbinChartProps {
  /** Sparse count grid: cells[row][col]; null/undefined omits the tile. */
  cells: readonly (readonly (number | null | undefined)[])[];
  labels: ChartLabels;
  height?: number;
  /** Minimum fill opacity for a present (count > 0) tile. */
  minAlpha?: number;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

function maxCount(cells: HexbinChartProps['cells']): number {
  let max = 0;
  for (const row of cells) {
    for (const value of row) {
      if (typeof value === 'number' && value > max) max = value;
    }
  }
  return max;
}

export function HexbinChart({
  cells,
  labels,
  height = 260,
  minAlpha = 0.18,
  dir,
  a11yFallback,
  className,
}: HexbinChartProps) {
  const rows = cells.length;
  const cols = cells.reduce((widest, row) => Math.max(widest, row.length), 0);
  const peak = maxCount(cells);

  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (rows === 0 || cols === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = hexbinLayout({ rows, cols, width: innerWidth, height: innerHeight, rtl });

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {layout.cells.map((cell) => {
              const count = cells[cell.row]?.[cell.col];
              if (typeof count !== 'number' || count <= 0) return null;
              const alpha = peak > 0 ? minAlpha + (count / peak) * (1 - minAlpha) : minAlpha;
              return (
                <polygon
                  key={`${cell.row}-${cell.col}`}
                  points={layout.hexPoints(cell.cx, cell.cy)}
                  fill="var(--accent)"
                  fillOpacity={alpha}
                  stroke="var(--surface)"
                  strokeWidth={1}
                  data-hex-row={cell.row}
                  data-hex-col={cell.col}
                  data-count={count}
                />
              );
            })}
          </g>
        );
      }}
    </ChartSurface>
  );
}
