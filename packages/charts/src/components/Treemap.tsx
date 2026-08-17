/**
 * `chart-treemap` primitive (research/widget-registry.md §2): squarified
 * slice-and-dice tiles, area/alpha by value, in-tile labels above a threshold.
 * Tiles fill with the accent alpha ramp (theme-safe text contrast); the RTL x
 * axis mirrors via `mirrorTiles`. Colors are tokens only; the geometry is pure
 * so a report worker rasterizes the identical layout (04 §7.1/§7.6).
 */
import type { ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import { mirrorTiles, treemapTiles } from '../geometry/treemap.js';
import type { TreemapInput } from '../geometry/treemap.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface TreemapChartProps {
  data: readonly TreemapInput[];
  labels: ChartLabels;
  height?: number;
  /** Slices beyond this fold into a trailing "Other" tile. */
  maxTiles?: number;
  otherLabel?: string;
  /** Hide the in-tile label below this width/height in px (default 48/36). */
  labelMinWidth?: number;
  labelMinHeight?: number;
  format?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function Treemap({
  data,
  labels,
  height = 260,
  maxTiles,
  otherLabel,
  labelMinWidth = 48,
  // 16 (name baseline) + 14 (line advance) + 6 breathing room. At the old 26 a
  // tile drew its value 4px past its own bottom edge, onto its neighbour.
  labelMinHeight = 36,
  format = formatCompact,
  dir,
  a11yFallback,
  className,
}: TreemapChartProps) {
  const t = useMaybeT();
  // Threaded into the geometry's trailing "Other" tile label (shared primitive key).
  const resolvedOtherLabel = otherLabel ?? t('ui:charts.otherLabel', 'Other');
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 2, right: 2, bottom: 2, left: 2 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (innerWidth <= 0 || innerHeight <= 0) return null;
        const laidOut = treemapTiles(data, {
          width: innerWidth,
          height: innerHeight,
          ...(maxTiles !== undefined ? { maxTiles } : {}),
          otherLabel: resolvedOtherLabel,
        });
        const tiles = rtl ? mirrorTiles(laidOut, innerWidth) : laidOut;

        return (
          <g data-treemap="">
            {tiles.map((tile, i) => {
              const showLabel = tile.width >= labelMinWidth && tile.height >= labelMinHeight;
              // The tile fill is the accent ramp, so from step 4 up the default
              // foreground sits at ~2.7:1 on it — below AA and below the 3:1
              // large-text floor, in both themes. Flip to the on-accent color.
              const labelFill = tile.rampStep >= 4 ? 'var(--accent-fg)' : 'var(--fg)';
              return (
                <g
                  key={tile.label}
                  className="adm-chart-fade"
                  style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 45}ms` }}
                  data-tile={tile.label}
                >
                  <rect
                    x={tile.x}
                    y={tile.y}
                    width={Math.max(0, tile.width - 2)}
                    height={Math.max(0, tile.height - 2)}
                    rx={4}
                    fill={tile.rampVar}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                  {showLabel && (
                    <>
                      <text
                        x={tile.x + 8}
                        y={tile.y + 16}
                        className="adm-chart-tile-name"
                        textAnchor="start"
                        fill={labelFill}
                      >
                        {tile.label}
                      </text>
                      <text
                        x={tile.x + 8}
                        y={tile.y + 30}
                        className="adm-chart-num adm-chart-tile-value"
                        textAnchor="start"
                        fill={labelFill}
                      >
                        {format(tile.value)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartSurface>
  );
}
