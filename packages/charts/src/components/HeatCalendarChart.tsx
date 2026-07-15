/**
 * `chart-heatmap-calendar` primitive (research/widget-registry.md §2): GitHub-
 * style week×day contribution grid with intensity levels, month markers, a
 * weekday gutter, a less→more legend and per-day native tooltips. Intrinsic cell
 * geometry (the widget wrapper adds horizontal scroll, annex "horizontal
 * scroll"). Token-only colors, mount fade with reduced-motion fallback,
 * `data-export-node` raster marker. Week columns run right→left in RTL (04 §7.4).
 */
import type { ReactNode } from 'react';

import { heatCalendarLayout } from '../geometry/heatCalendar.js';
import type { HeatPoint } from '../geometry/heatCalendar.js';
import { rampColorVar } from '../geometry/heat.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

/** Sun..Sat short weekday labels — English defaults, overridable per locale. */
const DEFAULT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DEFAULT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface HeatCalendarChartProps {
  points: readonly HeatPoint[];
  labels: ChartLabels;
  weeks?: number;
  /** First weekday of the column, 0=Sun..6=Sat (locale-aware). Default 0. */
  startWeekday?: number;
  /** Intensity levels incl. 0 (default 5). */
  levels?: number;
  cellSize?: number;
  /** Weekday short labels indexed 0=Sun..6=Sat. */
  weekdayLabels?: readonly string[];
  /** Month short labels indexed 0=Jan..11=Dec. */
  monthLabels?: readonly string[];
  legendLabels?: { less: string; more: string };
  /** Format the tooltip count (default `${v}`). */
  format?: (value: number) => string;
  /** Format the tooltip date (default ISO key). */
  formatDate?: (date: Date) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function HeatCalendarChart({
  points,
  labels,
  weeks = 53,
  startWeekday = 0,
  levels = 5,
  cellSize = 12,
  weekdayLabels = DEFAULT_WEEKDAYS,
  monthLabels = DEFAULT_MONTHS,
  legendLabels = { less: 'Less', more: 'More' },
  format = String,
  formatDate,
  dir,
  a11yFallback,
  className,
}: HeatCalendarChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const rtl = resolvedDir === 'rtl';

  const gap = 3;
  const layout = heatCalendarLayout(points, { weeks, startWeekday, cellSize, gap, levels, rtl });
  const monthHeader = 16;
  const gutter = 30;
  const legendHeight = 22;
  const gridX = rtl ? 0 : gutter;
  const svgWidth = gutter + layout.width;
  const svgHeight = monthHeader + layout.height + legendHeight;

  // Month markers at each column where the month changes (data order oldest→newest).
  const monthMarks: { x: number; label: string }[] = [];
  let prevMonth = -1;
  for (let col = 0; col < layout.weeks; col += 1) {
    const cell = layout.days.find((d) => d.weekIndex === col);
    if (cell === undefined) continue;
    const month = cell.date.getUTCMonth();
    if (month !== prevMonth) {
      monthMarks.push({ x: cell.x, label: monthLabels[month] ?? '' });
      prevMonth = month;
    }
  }

  const dateLabel = (date: Date): string => (formatDate ? formatDate(date) : date.toISOString().slice(0, 10));

  return (
    <div
      className={className === undefined ? 'adm-heatcal' : `adm-heatcal ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
    >
      <svg
        role="img"
        aria-label={labels.label}
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${Math.max(1, svgWidth)} ${Math.max(1, svgHeight)}`}
        data-export-node=""
      >
        {labels.description !== undefined && <desc>{labels.description}</desc>}

        {/* Weekday gutter — show alternate rows (Mon/Wed/Fri-style). */}
        {layout.weekdayRows.map((weekday, row) =>
          row % 2 === 1 ? (
            <text
              key={`wd${row}`}
              className="adm-chart-axis-label"
              x={rtl ? layout.width + 6 : gutter - 6}
              y={monthHeader + row * (cellSize + gap) + cellSize}
              textAnchor={rtl ? 'start' : 'end'}
            >
              {weekdayLabels[weekday] ?? ''}
            </text>
          ) : null,
        )}

        <g transform={`translate(${gridX}, ${monthHeader})`}>
          {monthMarks.map((mark, i) => (
            <text key={`m${i}`} className="adm-chart-axis-label" x={mark.x} y={-4} textAnchor="start">
              {mark.label}
            </text>
          ))}

          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {layout.days.map((day) => (
              <rect
                key={day.key}
                x={day.x}
                y={day.y}
                width={day.size}
                height={day.size}
                rx={2}
                fill={rampColorVar(day.level, levels)}
                data-heat-cell=""
                data-level={day.level}
              >
                <title>{`${dateLabel(day.date)}: ${format(day.value)}`}</title>
              </rect>
            ))}
          </g>
        </g>

        {/* Less → More legend. */}
        <g transform={`translate(${gridX}, ${monthHeader + layout.height + 8})`}>
          <text className="adm-chart-axis-label" x={0} y={9} textAnchor="start">
            {legendLabels.less}
          </text>
          {Array.from({ length: levels }, (_, level) => (
            <rect
              key={`lg${level}`}
              x={26 + level * (cellSize + 2)}
              y={0}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={rampColorVar(level, levels)}
            />
          ))}
          <text
            className="adm-chart-axis-label"
            x={26 + levels * (cellSize + 2) + 4}
            y={9}
            textAnchor="start"
          >
            {legendLabels.more}
          </text>
        </g>
      </svg>

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
