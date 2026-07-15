/**
 * `chart-bullet` primitive (research/widget-registry.md §2): rows of qualitative
 * bands + a measure bar + a target tick, with an inline-start label gutter and
 * an inline-end value. Composed from ChartSurface + pure `layoutBullet` geometry
 * (identical SVG in Node and browser). Colors resolve from viz/semantic tokens
 * only; the horizontal value axis mirrors in RTL; entrance fades in on mount
 * with a reduced-motion final-state fallback.
 */
import type { ReactNode } from 'react';

import { layoutBullet } from '../geometry/bullet.js';
import type { BulletInput } from '../geometry/bullet.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface BulletChartProps {
  data: readonly BulletInput[];
  labels: ChartLabels;
  height?: number;
  /** Inline-start label gutter width, px (default 92). */
  labelGutter?: number;
  /** Inline-end value gutter width, px (default 52). */
  valueGutter?: number;
  formatValue?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

/** Band level (0..1) → accent ramp token (ramp-1 lightest → ramp-3). */
function bandColor(level: number): string {
  return `var(--viz-ramp-${1 + Math.round(level * 2)})`;
}

export function BulletChart({
  data,
  labels,
  height = 200,
  labelGutter = 92,
  valueGutter = 52,
  formatValue = formatCompact,
  dir,
  a11yFallback,
  className,
}: BulletChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 4, bottom: 4, left: 2, right: 2 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        const trackWidth = Math.max(0, innerWidth - labelGutter - valueGutter);
        if (data.length === 0 || trackWidth <= 0 || innerHeight <= 0) return null;
        const trackStart = rtl ? valueGutter : labelGutter;
        const layout = layoutBullet(data, { width: trackWidth, height: innerHeight, rtl });

        const labelEdge = rtl ? innerWidth : 0;
        const valueEdge = rtl ? 0 : innerWidth;

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {layout.rows.map((row) => {
              const midY = row.rowY + layout.rowHeight / 2 + 3;
              return (
                <g key={row.label} data-bullet-row={row.index}>
                  {/* Qualitative bands (background track). */}
                  {row.bands.map((bandSeg) => (
                    <rect
                      key={bandSeg.index}
                      x={trackStart + bandSeg.x}
                      y={row.trackY}
                      width={bandSeg.width}
                      height={row.trackHeight}
                      rx={2}
                      fill={bandColor(bandSeg.level)}
                      data-band={bandSeg.index}
                    />
                  ))}
                  {/* Measure bar. */}
                  <rect
                    x={trackStart + row.measureX}
                    y={row.measureY}
                    width={row.measureWidth}
                    height={row.measureHeight}
                    rx={1.5}
                    fill="var(--fg)"
                    data-measure=""
                  />
                  {/* Target tick. */}
                  <rect
                    x={trackStart + row.targetX - 1}
                    y={row.trackY - 2}
                    width={2}
                    height={row.trackHeight + 4}
                    fill="var(--danger)"
                    data-target=""
                  />
                  {/* Inline-start label. */}
                  <text
                    className="adm-chart-axis-label"
                    x={labelEdge}
                    y={midY}
                    textAnchor={rtl ? 'end' : 'start'}
                  >
                    {row.label}
                  </text>
                  {/* Inline-end measure value. */}
                  <text
                    className="adm-chart-num"
                    x={valueEdge}
                    y={midY}
                    textAnchor={rtl ? 'start' : 'end'}
                    fontSize={11}
                    fontWeight={700}
                    fill="var(--fg)"
                  >
                    {formatValue(row.measure)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartSurface>
  );
}
