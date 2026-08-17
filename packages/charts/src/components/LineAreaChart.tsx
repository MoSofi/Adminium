// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-line-area` primitive (research/widget-registry.md §2): SVG line with
 * gradient area fill, optional dashed prior-period comparison series, time or
 * categorical x, linear y, minimal axis labels, nearest-x hover tooltip.
 * Pure data + config props — no fetching.
 */
import { useId, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';

import { areaPath, linePath, nearestIndexByX } from '../geometry/lineArea.js';
import { categoricalPointScale, linearYScale, timeScale } from '../geometry/scales.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { extent, niceTicks } from '../utils/stats.js';
import { formatCompact, formatShortDate } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface LineAreaPoint {
  /** Date → time axis (NEVER mirrors in RTL); string → categorical axis (mirrors). */
  x: Date | string;
  y: number;
}

export interface LineAreaChartProps {
  data: readonly LineAreaPoint[];
  /** Optional dashed comparison series (e.g. prior period), same x domain. */
  comparison?: readonly LineAreaPoint[];
  labels: ChartLabels;
  height?: number;
  /** Monotone-x smoothing (default true). */
  smooth?: boolean;
  /** Minimal axis labels: first/last x, y ticks (default true). */
  showAxis?: boolean;
  formatX?: (x: Date | string) => string;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const defaultFormatX = (x: Date | string): string => (x instanceof Date ? formatShortDate(x) : String(x));

export function LineAreaChart({
  data,
  comparison,
  labels,
  height = 240,
  smooth = true,
  showAxis = true,
  formatX = defaultFormatX,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: LineAreaChartProps) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState(-1);

  const isTime = data[0]?.x instanceof Date;
  const axisPad = showAxis ? { top: 8, bottom: 22, near: 38, far: 12 } : { top: 4, bottom: 4, near: 4, far: 4 };

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
        if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

        // x positions — time axes stay LTR; categorical mirrors via range flip.
        const xFor = isTime
          ? (() => {
              const dates = data.map((d) => (d.x instanceof Date ? d.x : new Date(0)));
              const [lo, hi] = [dates[0] ?? new Date(0), dates.at(-1) ?? new Date(0)];
              const scale = timeScale([lo, hi], innerWidth);
              return (p: LineAreaPoint) => scale(p.x instanceof Date ? p.x : new Date(0));
            })()
          : (() => {
              const scale = categoricalPointScale(
                data.map((d) => String(d.x)),
                innerWidth,
                rtl,
              );
              return (p: LineAreaPoint) => scale(String(p.x)) ?? 0;
            })();

        const ys = [...data, ...(comparison ?? [])].map((d) => d.y);
        const [minY, maxY] = extent(ys) ?? [0, 1];
        const yTicks = niceTicks(Math.min(0, minY), Math.max(1, maxY), 3);
        const yDomain: [number, number] = [yTicks[0] ?? 0, yTicks.at(-1) ?? 1];
        const yScale = linearYScale(yDomain, innerHeight);

        const points = data.map((d) => ({ x: xFor(d), y: yScale(d.y) }));
        const mainLine = linePath(points, smooth);
        const mainArea = areaPath(points, innerHeight, smooth);
        const comparisonLine =
          comparison !== undefined && comparison.length > 0
            ? linePath(
                comparison.map((d) => ({ x: xFor(d), y: yScale(d.y) })),
                smooth,
              )
            : null;

        const hover = hoverIndex >= 0 && hoverIndex < data.length ? data[hoverIndex] : undefined;
        const hoverPoint = hover !== undefined ? points[hoverIndex] : undefined;

        const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const localX = ((event.clientX - rect.left) / rect.width) * innerWidth;
          setHoverIndex(nearestIndexByX(points.map((p) => p.x), localX));
        };

        // Tooltip flips side so it never clips at the plot edge.
        const tooltipWidth = 96;
        const tooltipSide = hoverPoint !== undefined && hoverPoint.x > innerWidth / 2 ? -1 : 1;

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-area)" />
                <stop offset="100%" stopColor="var(--accent-area)" stopOpacity="0" />
              </linearGradient>
            </defs>

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

            {mainArea !== null && <path d={mainArea} fill={`url(#${gradientId})`} data-series="area" />}
            {comparisonLine !== null && (
              <path
                d={comparisonLine}
                fill="none"
                stroke="var(--viz-2)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                data-series="comparison"
              />
            )}
            {mainLine !== null && (
              <path
                d={mainLine}
                fill="none"
                stroke="var(--viz-1)"
                strokeWidth={2}
                strokeLinecap="round"
                data-series="line"
              />
            )}

            {showAxis && data.length > 1 && (
              <>
                <text
                  className="adm-chart-axis-label"
                  x={xFor(data[0] as LineAreaPoint)}
                  y={innerHeight + 15}
                  textAnchor={isTime || !rtl ? 'start' : 'end'}
                >
                  {formatX((data[0] as LineAreaPoint).x)}
                </text>
                <text
                  className="adm-chart-axis-label"
                  x={xFor(data.at(-1) as LineAreaPoint)}
                  y={innerHeight + 15}
                  textAnchor={isTime || !rtl ? 'end' : 'start'}
                >
                  {formatX((data.at(-1) as LineAreaPoint).x)}
                </text>
              </>
            )}

            {hover !== undefined && hoverPoint !== undefined && (
              <g pointerEvents="none" data-tooltip="">
                <line
                  className="adm-chart-gridline"
                  x1={hoverPoint.x}
                  x2={hoverPoint.x}
                  y1={0}
                  y2={innerHeight}
                />
                <circle cx={hoverPoint.x} cy={hoverPoint.y} r={3.5} fill="var(--viz-1)" stroke="var(--surface)" strokeWidth={1.5} />
                <g
                  transform={`translate(${hoverPoint.x + tooltipSide * 10 - (tooltipSide === -1 ? tooltipWidth : 0)}, ${Math.max(
                    0,
                    hoverPoint.y - 34,
                  )})`}
                >
                  <rect className="adm-chart-tooltip-bg" width={tooltipWidth} height={30} rx={6} />
                  <text className="adm-chart-tooltip-label" x={8} y={12}>
                    {formatX(hover.x)}
                  </text>
                  <text className="adm-chart-tooltip-value" x={8} y={25}>
                    {formatY(hover.y)}
                  </text>
                </g>
              </g>
            )}

            <rect
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              data-hover-overlay=""
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverIndex(-1)}
            />
          </g>
        );
      }}
    </ChartSurface>
  );
}
