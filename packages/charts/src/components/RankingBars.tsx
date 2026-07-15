/**
 * `chart-ranking-bars` primitive (research/widget-registry.md §2): label +
 * proportional horizontal bar (leader at full accent, the rest dimmed) + mono
 * value. Composed from ChartSurface + pure `layoutRanking` geometry. Token-only
 * colors, RTL-mirrored value axis, mount fade with reduced-motion fallback.
 */
import type { ReactNode } from 'react';

import { layoutRanking } from '../geometry/ranking.js';
import type { RankingInput } from '../geometry/ranking.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface RankingBarsProps {
  data: readonly RankingInput[];
  labels: ChartLabels;
  /** Top-N cap (annex `n`). */
  max?: number;
  height?: number;
  /** Inline-start label gutter width, px (default 104). */
  labelGutter?: number;
  /** Inline-end value gutter width, px (default 52). */
  valueGutter?: number;
  formatValue?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function RankingBars({
  data,
  labels,
  max,
  height = 220,
  labelGutter = 104,
  valueGutter = 52,
  formatValue = formatCompact,
  dir,
  a11yFallback,
  className,
}: RankingBarsProps) {
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
        const layout = layoutRanking(data, {
          width: trackWidth,
          height: innerHeight,
          rtl,
          ...(max !== undefined ? { max } : {}),
        });

        const labelEdge = rtl ? innerWidth : 0;
        const valueEdge = rtl ? 0 : innerWidth;

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {layout.bars.map((bar) => {
              const midY = bar.rowY + layout.rowHeight / 2 + 3;
              return (
                <g key={bar.label} data-rank={bar.index}>
                  <rect
                    x={trackStart + bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.barHeight}
                    rx={3}
                    fill={bar.isLeader ? 'var(--accent)' : 'var(--viz-ramp-3)'}
                    data-leader={bar.isLeader ? '' : undefined}
                  />
                  <text
                    className="adm-chart-axis-label"
                    x={labelEdge}
                    y={midY}
                    textAnchor={rtl ? 'end' : 'start'}
                  >
                    {bar.label}
                  </text>
                  <text
                    className="adm-chart-num"
                    x={valueEdge}
                    y={midY}
                    textAnchor={rtl ? 'start' : 'end'}
                    fontSize={11}
                    fontWeight={700}
                    fill="var(--fg)"
                  >
                    {formatValue(bar.value)}
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
