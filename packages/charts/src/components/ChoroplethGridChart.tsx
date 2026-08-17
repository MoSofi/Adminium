// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-choropleth-grid` primitive (research/widget-registry.md §2): a US
 * tilegram (49 state tiles) or compact region grid, tinted by the active metric,
 * label text flipping on dark tiles, a low→high legend + per-tile tooltips.
 * Token-only colors, mount fade with reduced-motion fallback, `data-export-node`
 * raster marker. The tilegram is a geographic LTR island; the `grid` layout
 * mirrors columns in RTL (04 §7.4).
 */
import type { ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import { choroplethLayout } from '../geometry/choropleth.js';
import type { ChoroplethLayoutKind, RegionPoint } from '../geometry/choropleth.js';
import { rampColorVar } from '../geometry/heat.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

export interface ChoroplethGridChartProps {
  points: readonly RegionPoint[];
  /** Value key read from each point's `values` map. */
  metric: string;
  labels: ChartLabels;
  layout?: ChoroplethLayoutKind;
  columns?: number;
  levels?: number;
  cellSize?: number;
  legendLabels?: { low: string; high: string };
  format?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function ChoroplethGridChart({
  points,
  metric,
  labels,
  layout = 'us-tilegram',
  columns = 6,
  levels = 5,
  cellSize = 34,
  legendLabels,
  format = String,
  dir,
  a11yFallback,
  className,
}: ChoroplethGridChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const t = useMaybeT();
  const resolvedLegendLabels = legendLabels ?? {
    low: t('ui:charts.choropleth.lowLabel', 'Low'),
    high: t('ui:charts.choropleth.highLabel', 'High'),
  };
  const rtl = resolvedDir === 'rtl';

  const geo = choroplethLayout(points, { metric, layout, columns, levels, cellSize, rtl });
  const legendHeight = 24;
  const svgHeight = geo.height + legendHeight;

  return (
    <div
      className={className === undefined ? 'adm-choropleth' : `adm-choropleth ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
    >
      <svg
        role="img"
        aria-label={labels.label}
        width={geo.width}
        height={svgHeight}
        viewBox={`0 0 ${Math.max(1, geo.width)} ${Math.max(1, svgHeight)}`}
        data-export-node=""
      >
        {labels.description !== undefined && <desc>{labels.description}</desc>}

        <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
          {geo.tiles.map((tile) => (
            <g key={`${tile.code}-${tile.row}-${tile.col}`}>
              <rect
                x={tile.x}
                y={tile.y}
                width={tile.size}
                height={tile.size}
                rx={4}
                fill={tile.colorVar}
                stroke="var(--border)"
                strokeWidth={1}
                data-region-tile={tile.code}
                data-level={tile.level}
              >
                <title>{`${tile.name}: ${format(tile.value)}`}</title>
              </rect>
              <text
                className="adm-chart-num"
                x={tile.x + tile.size / 2}
                y={tile.y + tile.size / 2 + 3}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill={tile.textLight ? 'var(--accent-fg)' : 'var(--fg-muted)'}
              >
                {tile.code}
              </text>
            </g>
          ))}
        </g>

        {/* Low → High legend. */}
        <g transform={`translate(0, ${geo.height + 8})`}>
          <text className="adm-chart-axis-label" x={0} y={11} textAnchor="start">
            {resolvedLegendLabels.low}
          </text>
          {Array.from({ length: levels }, (_, level) => (
            <rect
              key={`lg${level}`}
              x={30 + level * 16}
              y={2}
              width={14}
              height={12}
              rx={2}
              fill={rampColorVar(level, levels)}
            />
          ))}
          <text className="adm-chart-axis-label" x={30 + levels * 16 + 4} y={11} textAnchor="start">
            {resolvedLegendLabels.high}
          </text>
        </g>
      </svg>

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
