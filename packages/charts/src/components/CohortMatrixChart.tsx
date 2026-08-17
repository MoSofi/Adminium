// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-cohort-matrix` primitive (research/widget-registry.md §2): cohort rows
 * × period columns, accent-alpha cells, triangular nulls transparent, in-cell
 * value labels that flip to the on-accent color past ~55%. Fixed cell geometry
 * with an intrinsic size (the widget wrapper adds horizontal scroll) — the
 * DonutChart precedent for non-responsive charts. Token-only colors, mount fade
 * with a reduced-motion final-state fallback, `data-export-node` raster marker.
 */
import type { ReactNode } from 'react';

import { cohortLayout } from '../geometry/cohort.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

export interface CohortMatrixChartProps {
  rowKeys: readonly string[];
  colKeys: readonly string[];
  /** cells[row][col]; null renders a triangular gap. */
  cells: readonly (readonly (number | null)[])[];
  labels: ChartLabels;
  cellSize?: number;
  /** Value at/above which the label flips to the on-accent color (default 55). */
  flipThreshold?: number;
  /** Value mapped to the darkest ramp step (default 100, i.e. a percent scale). */
  maxValue?: number;
  /** Format a non-null cell value for its label + tooltip (default `${v}%`). */
  format?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const defaultFormat = (value: number): string => `${Math.round(value)}%`;

export function CohortMatrixChart({
  rowKeys,
  colKeys,
  cells,
  labels,
  cellSize = 40,
  flipThreshold = 55,
  maxValue = 100,
  format = defaultFormat,
  dir,
  a11yFallback,
  className,
}: CohortMatrixChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const rtl = resolvedDir === 'rtl';

  const layout = cohortLayout(rowKeys, colKeys, cells, { cellSize, flipThreshold, maxValue, rtl });

  return (
    <div
      className={className === undefined ? 'adm-cohort' : `adm-cohort ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
    >
      <svg
        role="img"
        aria-label={labels.label}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`}
        data-export-node=""
      >
        {labels.description !== undefined && <desc>{labels.description}</desc>}

        {layout.colLabels.map((col) => (
          <text
            key={`c${col.index}`}
            className="adm-chart-axis-label"
            x={col.pos}
            y={12}
            textAnchor="middle"
          >
            {col.label}
          </text>
        ))}
        {layout.rowLabels.map((row) => (
          <text
            key={`r${row.index}`}
            className="adm-chart-axis-label"
            x={layout.rowLabelX}
            y={row.pos + 3}
            textAnchor={layout.rowLabelAnchor}
          >
            {row.label}
          </text>
        ))}

        <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
          {layout.cells.map((cell) => (
            <g key={`${cell.row}-${cell.col}`}>
              <rect
                x={cell.x}
                y={cell.y}
                width={cell.size}
                height={cell.size}
                rx={4}
                fill={cell.colorVar}
                data-cohort-cell=""
                data-gap={cell.value === null ? '' : undefined}
              >
                {cell.value !== null && (
                  <title>{`${rowKeys[cell.row] ?? ''} · ${colKeys[cell.col] ?? ''}: ${format(cell.value)}`}</title>
                )}
              </rect>
              {cell.value !== null && cell.size >= 24 && (
                <text
                  className="adm-chart-num"
                  x={cell.x + cell.size / 2}
                  y={cell.y + cell.size / 2 + 3}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={cell.textLight ? 'var(--accent-fg)' : 'var(--fg)'}
                >
                  {format(cell.value)}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
