// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-stacked-bar-100` primitive (research/widget-registry.md §2): a single
 * horizontal 100% bar of gapped segments + a multi-column legend. Composed from
 * ChartSurface (the bar) + pure `layoutStacked100` geometry; the legend is HTML
 * (logical properties, mirrors under dir). Token-only colors; segment order
 * mirrors in RTL; segments fade in on mount.
 */
import type { ReactNode } from 'react';

import { layoutStacked100 } from '../geometry/stacked100.js';
import type { StackedInput } from '../geometry/stacked100.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface StackedBar100Props {
  data: readonly StackedInput[];
  labels: ChartLabels;
  /** Bar thickness in px (default 26). */
  barHeight?: number;
  /** Gap between segments in px (default 2). */
  gapPx?: number;
  showLegend?: boolean;
  /** Legend column count (annex `legendColumns`, default 2). */
  legendColumns?: number;
  /** In-segment share label when the segment is wide enough. */
  showSegmentLabels?: boolean;
  formatValue?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function StackedBar100({
  data,
  labels,
  barHeight = 26,
  gapPx = 2,
  showLegend = true,
  legendColumns = 2,
  showSegmentLabels = true,
  formatValue,
  dir,
  a11yFallback,
  className,
}: StackedBar100Props) {
  const resolvedDir = useChartDir(dir);

  return (
    <div
      className={className === undefined ? 'adm-stacked' : `adm-stacked ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
    >
      <ChartSurface
        labels={labels}
        height={barHeight}
        {...(dir !== undefined ? { dir } : {})}
        {...(a11yFallback !== undefined ? { a11yFallback } : {})}
        padding={{ top: 0, bottom: 0, left: 0, right: 0 }}
      >
        {({ innerWidth, rtl, mounted }) => {
          if (data.length === 0 || innerWidth <= 0) return null;
          const layout = layoutStacked100(data, { width: innerWidth, rtl, gap: gapPx });
          return (
            <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
              {layout.segments.map((segment) => (
                <g key={segment.key} data-seg={segment.index}>
                  <rect
                    x={segment.x}
                    y={0}
                    width={Math.max(0, segment.width)}
                    height={barHeight}
                    rx={4}
                    fill={`var(--viz-${(segment.index % 8) + 1})`}
                  />
                  {showSegmentLabels && segment.width >= 34 && (
                    <text
                      className="adm-chart-num"
                      x={segment.x + segment.width / 2}
                      y={barHeight / 2 + 3}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill="var(--surface)"
                    >
                      {formatPercent(segment.share)}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        }}
      </ChartSurface>

      {showLegend && (
        <ul className="adm-legend adm-legend-cols" style={{ '--adm-legend-cols': String(Math.max(1, legendColumns)) }}>
          {data.map((item, index) => {
            const total = data.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
            const share = total > 0 ? Math.max(0, item.value) / total : 0;
            return (
              <li key={item.key} className="adm-legend-row">
                <span className="adm-legend-dot" style={{ '--adm-dot': `var(--viz-${(index % 8) + 1})` }} aria-hidden="true" />
                <span>{item.label}</span>
                <span className="adm-legend-value">
                  {formatValue !== undefined ? formatValue(item.value) : formatPercent(share)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
