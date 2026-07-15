/**
 * `chart-multiline` primitive (research/widget-registry.md §2): plain
 * multi-series polylines with gridlines, end dots and end labels (cohort LTV
 * curves, A/B conversion-over-time). Time x never mirrors; categorical x
 * mirrors in RTL (04 §7.4). Colors strictly from the viz palette; pure data +
 * config props — no fetching.
 */
import type { ReactNode } from 'react';

import { multiSeriesPaths, seriesColorVar } from '../geometry/multiLine.js';
import type { PixelSeries } from '../geometry/multiLine.js';
import { categoricalPointScale, linearYScale, timeScale } from '../geometry/scales.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { extent, niceTicks } from '../utils/stats.js';
import { formatCompact, formatShortDate } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface MultiLinePoint {
  /** Date → time axis (never mirrors); string → categorical axis (mirrors). */
  x: Date | string;
  y: number;
}

export interface MultiLineSeries {
  key: string;
  label: string;
  points: readonly MultiLinePoint[];
}

export interface MultiLineChartProps {
  series: readonly MultiLineSeries[];
  labels: ChartLabels;
  height?: number;
  smooth?: boolean;
  showAxis?: boolean;
  /** Series label at each line's end (default true). */
  showEndLabels?: boolean;
  formatX?: (x: Date | string) => string;
  formatY?: (y: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const defaultFormatX = (x: Date | string): string => (x instanceof Date ? formatShortDate(x) : String(x));

export function MultiLineChart({
  series,
  labels,
  height = 240,
  smooth = false,
  showAxis = true,
  showEndLabels = true,
  formatX = defaultFormatX,
  formatY = formatCompact,
  dir,
  a11yFallback,
  className,
}: MultiLineChartProps) {
  const isTime = series[0]?.points[0]?.x instanceof Date;
  const axisPad = {
    top: 10,
    bottom: showAxis ? 22 : 6,
    near: showAxis ? 38 : 6,
    far: showEndLabels ? 56 : 10,
  };

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
        const drawable = series.filter((s) => s.points.length > 0);
        if (drawable.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

        const xFor = isTime
          ? (() => {
              const times = drawable.flatMap((s) =>
                s.points.map((p) => (p.x instanceof Date ? p.x.getTime() : 0)),
              );
              const [lo, hi] = extent(times) ?? [0, 1];
              const scale = timeScale([new Date(lo), new Date(hi)], innerWidth);
              return (p: MultiLinePoint) => scale(p.x instanceof Date ? p.x : new Date(0));
            })()
          : (() => {
              const domain: string[] = [];
              for (const s of drawable) for (const p of s.points) {
                const key = String(p.x);
                if (!domain.includes(key)) domain.push(key);
              }
              const scale = categoricalPointScale(domain, innerWidth, rtl);
              return (p: MultiLinePoint) => scale(String(p.x)) ?? 0;
            })();

        const ys = drawable.flatMap((s) => s.points.map((p) => p.y));
        const [minY, maxY] = extent(ys) ?? [0, 1];
        const yTicks = niceTicks(Math.min(0, minY), Math.max(1, maxY), 3);
        const yDomain: [number, number] = [yTicks[0] ?? 0, yTicks.at(-1) ?? 1];
        const yScale = linearYScale(yDomain, innerHeight);

        const pixelSeries: PixelSeries[] = drawable.map((s) => ({
          key: s.key,
          label: s.label,
          points: s.points.map((p) => ({ x: xFor(p), y: yScale(p.y) })),
        }));
        const paths = multiSeriesPaths(pixelSeries, smooth);

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

            {showAxis &&
              (() => {
                const anchor = drawable[0]?.points ?? [];
                const first = anchor[0];
                const last = anchor.at(-1);
                if (first === undefined || last === undefined || anchor.length < 2) return null;
                return (
                  <>
                    <text
                      className="adm-chart-axis-label"
                      x={xFor(first)}
                      y={innerHeight + 15}
                      textAnchor={isTime || !rtl ? 'start' : 'end'}
                    >
                      {formatX(first.x)}
                    </text>
                    <text
                      className="adm-chart-axis-label"
                      x={xFor(last)}
                      y={innerHeight + 15}
                      textAnchor={isTime || !rtl ? 'end' : 'start'}
                    >
                      {formatX(last.x)}
                    </text>
                  </>
                );
              })()}

            {paths.map((sp, i) =>
              sp.path === null ? null : (
                <path
                  key={sp.key}
                  d={sp.path}
                  fill="none"
                  stroke={seriesColorVar(i)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  data-series={sp.key}
                />
              ),
            )}

            {paths.map((sp, i) =>
              sp.end === null ? null : (
                <circle
                  key={`${sp.key}-dot`}
                  cx={sp.end.x}
                  cy={sp.end.y}
                  r={3}
                  fill="var(--surface)"
                  stroke={seriesColorVar(i)}
                  strokeWidth={2}
                  data-series-dot={sp.key}
                />
              ),
            )}

            {showEndLabels &&
              paths.map((sp, i) =>
                sp.end === null ? null : (
                  <text
                    key={`${sp.key}-label`}
                    x={sp.end.x + (rtl ? -8 : 8)}
                    y={sp.end.y + 3}
                    textAnchor={rtl ? 'end' : 'start'}
                    fontSize={10}
                    fontWeight={600}
                    fill={seriesColorVar(i)}
                    data-series-label={sp.key}
                  >
                    {sp.label}
                  </text>
                ),
              )}
          </g>
        );
      }}
    </ChartSurface>
  );
}
