/**
 * `chart-pareto` primitive (research/widget-registry.md §2): sorted bars + a
 * cumulative-% accent line with an optional 80% cutline. Composed from
 * ChartSurface + pure `layoutPareto` geometry (deterministic path strings).
 * Bars grow from the baseline on mount; the line fades in; token-only colors;
 * categorical x mirrors in RTL (the value axis and % axis swap sides).
 */
import type { ReactNode } from 'react';

import { layoutPareto } from '../geometry/pareto.js';
import type { ParetoInput } from '../geometry/pareto.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface ParetoChartProps {
  data: readonly ParetoInput[];
  labels: ChartLabels;
  height?: number;
  /** Cumulative cutline fraction 0..1 (annex default 0.8); null disables it. */
  cutline?: number | null;
  smooth?: boolean;
  showAxis?: boolean;
  formatValue?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const PERCENT_TICKS = [0, 0.5, 1] as const;

export function ParetoChart({
  data,
  labels,
  height = 240,
  cutline = 0.8,
  smooth = false,
  showAxis = true,
  formatValue = formatCompact,
  dir,
  a11yFallback,
  className,
}: ParetoChartProps) {
  const gutter = showAxis ? 34 : 6;
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 10, bottom: 22, left: gutter, right: gutter }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = layoutPareto(data, {
          width: innerWidth,
          height: innerHeight,
          rtl,
          cutline,
          smooth,
        });
        const valueEdge = rtl ? innerWidth + 6 : -6;
        const percentEdge = rtl ? -6 : innerWidth + 6;
        const percentY = (frac: number): number => innerHeight - frac * innerHeight;

        return (
          <g>
            {showAxis &&
              layout.yTicks.map((tick) => (
                <g key={`v-${tick}`}>
                  <line
                    className="adm-chart-gridline"
                    x1={0}
                    x2={innerWidth}
                    y1={layout.yFor(tick)}
                    y2={layout.yFor(tick)}
                  />
                  <text
                    className="adm-chart-axis-label adm-chart-num"
                    x={valueEdge}
                    y={layout.yFor(tick) + 3}
                    textAnchor={rtl ? 'start' : 'end'}
                  >
                    {formatValue(tick)}
                  </text>
                </g>
              ))}

            {/* Bars (bottom-anchored, grow on mount). */}
            {layout.bars.map((bar) => (
              <rect
                key={bar.label}
                className="adm-chart-grow"
                style={{ '--adm-grow': mounted ? '1' : '0', '--adm-stagger': `${bar.index * 80}ms` }}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={2}
                fill="var(--viz-ramp-3)"
                data-bar={bar.index}
              />
            ))}

            {/* Cutline (dashed) on the cumulative axis. */}
            {layout.cutlineY !== null && (
              <line
                x1={0}
                x2={innerWidth}
                y1={layout.cutlineY}
                y2={layout.cutlineY}
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="4 4"
                data-cutline=""
              />
            )}

            {/* Cumulative line + vertices. */}
            <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
              {layout.linePath !== null && (
                <path
                  d={layout.linePath}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  data-cumulative=""
                />
              )}
              {layout.linePoints.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={3}
                  fill="var(--accent)"
                  stroke="var(--surface)"
                  strokeWidth={1.5}
                />
              ))}
            </g>

            {showAxis &&
              PERCENT_TICKS.map((frac) => (
                <text
                  key={`p-${frac}`}
                  className="adm-chart-axis-label adm-chart-num"
                  x={percentEdge}
                  y={percentY(frac) + 3}
                  textAnchor={rtl ? 'end' : 'start'}
                >
                  {`${Math.round(frac * 100)}%`}
                </text>
              ))}

            {/* Category labels. */}
            {layout.bars.map((bar) => (
              <text
                key={`c-${bar.label}`}
                className="adm-chart-axis-label"
                x={bar.centerX}
                y={innerHeight + 15}
                textAnchor="middle"
              >
                {bar.label}
              </text>
            ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
