/**
 * `chart-slope` primitive (research/widget-registry.md §2): two period axes
 * (A → B) with one connecting line per record, colored pos/danger by direction,
 * and end labels. Composed from ChartSurface + pure `layoutSlope` geometry
 * (deterministic two-point paths). Token-only colors; the two period columns
 * are categorical and mirror in RTL; lines fade in on mount.
 */
import type { ReactNode } from 'react';

import { layoutSlope } from '../geometry/slope.js';
import type { SlopeInput } from '../geometry/slope.js';
import { formatCompact } from '../utils/format.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface SlopeChartProps {
  data: readonly SlopeInput[];
  labels: ChartLabels;
  height?: number;
  /** Period axis captions [A, B] (annex `periodLabels`). */
  periodLabels?: readonly [string, string];
  /** Inline-start label gutter width, px (default 84). */
  labelGutter?: number;
  /** Inline-end value gutter width, px (default 56). */
  valueGutter?: number;
  formatValue?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function SlopeChart({
  data,
  labels,
  height = 260,
  periodLabels,
  labelGutter = 84,
  valueGutter = 56,
  formatValue = formatCompact,
  dir,
  a11yFallback,
  className,
}: SlopeChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 18, bottom: 8, left: labelGutter, right: valueGutter }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = layoutSlope(data, { width: innerWidth, height: innerHeight, rtl });
        const captionA = periodLabels?.[0];
        const captionB = periodLabels?.[1];

        return (
          <g>
            {/* Period axes. */}
            <line x1={layout.xA} x2={layout.xA} y1={0} y2={innerHeight} stroke="var(--border)" strokeWidth={1} />
            <line x1={layout.xB} x2={layout.xB} y1={0} y2={innerHeight} stroke="var(--border)" strokeWidth={1} />
            {captionA !== undefined && (
              <text className="adm-chart-axis-label" x={layout.xA} y={-6} textAnchor="middle">
                {captionA}
              </text>
            )}
            {captionB !== undefined && (
              <text className="adm-chart-axis-label" x={layout.xB} y={-6} textAnchor="middle">
                {captionB}
              </text>
            )}

            <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
              {layout.lines.map((slope) => {
                const stroke = slope.rising ? 'var(--pos)' : 'var(--danger)';
                return (
                  <g key={slope.label} data-slope={slope.index} data-rising={slope.rising ? '' : undefined}>
                    {slope.path !== null && (
                      <path d={slope.path} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
                    )}
                    <circle cx={slope.xA} cy={slope.yA} r={3} fill={stroke} />
                    <circle cx={slope.xB} cy={slope.yB} r={3} fill={stroke} />
                    {/* Inline-start category label. */}
                    <text
                      className="adm-chart-axis-label"
                      x={slope.xA + (rtl ? 8 : -8)}
                      y={slope.yA + 3}
                      textAnchor={rtl ? 'start' : 'end'}
                    >
                      {slope.label}
                    </text>
                    {/* Inline-end end value. */}
                    <text
                      className="adm-chart-num"
                      x={slope.xB + (rtl ? -8 : 8)}
                      y={slope.yB + 3}
                      textAnchor={rtl ? 'end' : 'start'}
                      fontSize={10}
                      fontWeight={700}
                      fill={stroke}
                    >
                      {formatValue(slope.b)}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        );
      }}
    </ChartSurface>
  );
}
