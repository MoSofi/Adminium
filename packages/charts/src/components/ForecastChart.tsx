// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-forecast` primitive (research/widget-registry.md §2): history line +
 * dashed forecast + widening confidence polygon + "now" divider + projected
 * footer legend. A time axis, so it never mirrors (04 §7.4 LTR island); the
 * footer legend follows reading direction. Colors from the viz palette only.
 */
import type { ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import { confidenceBandPath } from '../geometry/forecast.js';
import { linePath } from '../geometry/lineArea.js';
import type { XYPoint } from '../geometry/lineArea.js';
import { linearYScale, timeScale } from '../geometry/scales.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { extent, niceTicks } from '../utils/stats.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface ForecastPoint {
  x: Date;
  y: number;
}

export interface ForecastBandPoint {
  lo: number;
  hi: number;
}

export interface ForecastChartProps {
  history: readonly ForecastPoint[];
  forecast: readonly ForecastPoint[];
  /** Confidence edges aligned 1:1 to `forecast`. */
  band: readonly ForecastBandPoint[];
  labels: ChartLabels;
  height?: number;
  showAxis?: boolean;
  /** Divider caption (default "Now"). */
  nowLabel?: string;
  /** Footer legend caption for the projection (default "Forecast"). */
  forecastLabel?: string;
  actualLabel?: string;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function ForecastChart({
  history,
  forecast,
  band,
  labels,
  height = 260,
  showAxis = true,
  nowLabel,
  forecastLabel,
  actualLabel,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: ForecastChartProps) {
  const t = useMaybeT();
  const resolvedNowLabel = nowLabel ?? t('ui:charts.forecast.nowLabel', 'Now');
  const resolvedForecastLabel = forecastLabel ?? t('ui:charts.forecast.forecastLabel', 'Forecast');
  const resolvedActualLabel = actualLabel ?? t('ui:charts.forecast.actualLabel', 'Actual');
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 10, bottom: showAxis ? 24 : 8, left: showAxis ? 38 : 6, right: 10 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (history.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

        const allDates = [...history, ...forecast].map((p) => p.x.getTime());
        const [loT, hiT] = extent(allDates) ?? [0, 1];
        const xScale = timeScale([new Date(loT), new Date(hiT)], innerWidth);

        const ys = [
          ...history.map((p) => p.y),
          ...forecast.map((p) => p.y),
          ...band.map((b) => b.lo),
          ...band.map((b) => b.hi),
        ];
        const [minY, maxY] = extent(ys) ?? [0, 1];
        const yTicks = niceTicks(Math.min(0, minY), Math.max(1, maxY), 3);
        const yScale = linearYScale([yTicks[0] ?? 0, yTicks.at(-1) ?? 1], innerHeight);

        const now = history.at(-1)!;
        const nowX = xScale(now.x);
        const nowPix: XYPoint = { x: nowX, y: yScale(now.y) };

        const historyPix = history.map((p) => ({ x: xScale(p.x), y: yScale(p.y) }));
        const forecastPix = forecast.map((p) => ({ x: xScale(p.x), y: yScale(p.y) }));
        const upper: XYPoint[] = [nowPix, ...forecast.map((p, i) => ({ x: xScale(p.x), y: yScale(band[i]?.hi ?? p.y) }))];
        const lower: XYPoint[] = [nowPix, ...forecast.map((p, i) => ({ x: xScale(p.x), y: yScale(band[i]?.lo ?? p.y) }))];

        const historyLine = linePath(historyPix, true);
        const forecastLine = linePath([nowPix, ...forecastPix], true);
        const bandPath = confidenceBandPath(upper, lower);

        const legendStart = rtl ? innerWidth : 0;

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {showAxis &&
              yTicks.map((tick) => (
                <g key={tick}>
                  <line className="adm-chart-gridline" x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} />
                  <text
                    className="adm-chart-axis-label adm-chart-num"
                    x={rtl ? innerWidth + 6 : -6}
                    y={yScale(tick) + 3}
                    textAnchor={rtl ? 'start' : 'end'}
                  >
                    {formatY(tick)}
                  </text>
                </g>
              ))}

            {bandPath !== null && (
              <path d={bandPath} fill="var(--viz-1)" fillOpacity={0.15} stroke="none" data-band="confidence" />
            )}

            {/* "Now" divider between history and forecast. */}
            <line
              x1={nowX}
              x2={nowX}
              y1={0}
              y2={innerHeight}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
              data-now-divider=""
            />
            <text
              x={nowX + (rtl ? -4 : 4)}
              y={10}
              textAnchor={rtl ? 'end' : 'start'}
              fontSize={9.5}
              fontWeight={600}
              fill="var(--fg-subtle)"
              data-now-label=""
            >
              {resolvedNowLabel}
            </text>

            {forecastLine !== null && (
              <path
                d={forecastLine}
                fill="none"
                stroke="var(--viz-1)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
                data-series="forecast"
              />
            )}
            {historyLine !== null && (
              <path
                d={historyLine}
                fill="none"
                stroke="var(--viz-1)"
                strokeWidth={2}
                strokeLinecap="round"
                data-series="history"
              />
            )}
            <circle cx={nowPix.x} cy={nowPix.y} r={3} fill="var(--viz-1)" stroke="var(--surface)" strokeWidth={1.5} />

            {/* Projected footer legend: solid = actual, dashed = forecast. */}
            <g data-footer-legend="" transform={`translate(0, ${innerHeight + (showAxis ? 16 : 4)})`}>
              <line
                x1={rtl ? legendStart : legendStart}
                x2={rtl ? legendStart - 16 : legendStart + 16}
                y1={0}
                y2={0}
                stroke="var(--viz-1)"
                strokeWidth={2}
              />
              <text
                x={rtl ? legendStart - 20 : legendStart + 20}
                y={3}
                textAnchor={rtl ? 'end' : 'start'}
                fontSize={9.5}
                fontWeight={600}
                fill="var(--fg-muted)"
              >
                {resolvedActualLabel}
              </text>
              <line
                x1={rtl ? legendStart - 96 : legendStart + 96}
                x2={rtl ? legendStart - 112 : legendStart + 112}
                y1={0}
                y2={0}
                stroke="var(--viz-1)"
                strokeWidth={2}
                strokeDasharray="4 3"
              />
              <text
                x={rtl ? legendStart - 116 : legendStart + 116}
                y={3}
                textAnchor={rtl ? 'end' : 'start'}
                fontSize={9.5}
                fontWeight={600}
                fill="var(--fg-muted)"
              >
                {resolvedForecastLabel}
              </text>
            </g>
          </g>
        );
      }}
    </ChartSurface>
  );
}
