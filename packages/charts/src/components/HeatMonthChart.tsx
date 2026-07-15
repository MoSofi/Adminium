/**
 * `chart-heat-month` primitive (research/widget-registry.md §2): a 7-column
 * month grid with day numbers and up to 5 intensity levels + a day-of-week
 * header. Intrinsic cell geometry (DonutChart precedent). Token-only colors,
 * mount fade with reduced-motion fallback, `data-export-node` raster marker.
 * Day-of-week columns mirror in RTL (04 §7.4).
 */
import type { ReactNode } from 'react';

import { heatMonthLayout } from '../geometry/heatMonth.js';
import type { HeatMonthPoint } from '../geometry/heatMonth.js';
import { heatTextLight, rampColorVar } from '../geometry/heat.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

const DEFAULT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface HeatMonthChartProps {
  year: number;
  /** 0-based month. */
  month: number;
  points: readonly HeatMonthPoint[];
  labels: ChartLabels;
  /** First weekday of the row, 0=Sun..6=Sat (locale-aware). Default 0. */
  startWeekday?: number;
  levels?: number;
  cellSize?: number;
  /** Weekday short labels indexed 0=Sun..6=Sat. */
  weekdayLabels?: readonly string[];
  format?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function HeatMonthChart({
  year,
  month,
  points,
  labels,
  startWeekday = 0,
  levels = 5,
  cellSize = 40,
  weekdayLabels = DEFAULT_WEEKDAYS,
  format = String,
  dir,
  a11yFallback,
  className,
}: HeatMonthChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const rtl = resolvedDir === 'rtl';

  const layout = heatMonthLayout(year, month, points, { startWeekday, cellSize, levels, rtl });

  return (
    <div
      className={className === undefined ? 'adm-heatmonth' : `adm-heatmonth ${className}`}
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

        {layout.headerCols.map((header) => (
          <text
            key={`h${header.col}`}
            className="adm-chart-axis-label"
            x={header.x}
            y={12}
            textAnchor="middle"
          >
            {weekdayLabels[header.weekday] ?? ''}
          </text>
        ))}

        <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
          {layout.cells.map((cell) =>
            cell.day === null ? null : (
              <g key={`${cell.row}-${cell.col}`}>
                <rect
                  x={cell.x}
                  y={cell.y}
                  width={cell.size}
                  height={cell.size}
                  rx={6}
                  fill={rampColorVar(cell.level, levels)}
                  stroke="var(--border)"
                  strokeWidth={1}
                  data-heat-cell=""
                  data-level={cell.level}
                >
                  <title>{`${cell.key ?? ''}: ${format(cell.value)}`}</title>
                </rect>
                <text
                  className="adm-chart-num"
                  x={cell.x + 6}
                  y={cell.y + 14}
                  textAnchor="start"
                  fontSize={11}
                  fontWeight={600}
                  fill={heatTextLight(cell.level, levels) ? 'var(--accent-fg)' : 'var(--fg-muted)'}
                >
                  {cell.day}
                </text>
              </g>
            ),
          )}
        </g>
      </svg>

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
