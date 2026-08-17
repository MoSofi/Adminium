// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-radar` primitive (research/widget-registry.md §2): N named axes on a
 * regular polygon with one filled polygon per series (current vs an optional
 * target overlay), concentric grid rings, and per-axis labels. Axis order
 * mirrors in RTL (§7.4). Colors are tokens only; geometry is pure (04 §7.1).
 */
import type { ReactNode } from 'react';

import { radarLayout } from '../geometry/radar.js';
import type { RadarSeriesInput } from '../geometry/radar.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

export interface RadarChartProps {
  axes: readonly string[];
  series: readonly RadarSeriesInput[];
  labels: ChartLabels;
  /** Diameter of the plotting circle in px (default 200). Extra room is added for labels. */
  size?: number;
  /** Concentric grid rings (default 4). */
  levels?: number;
  /** Domain max for normalization; defaults to the observed max. */
  max?: number;
  showLegend?: boolean;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const LABEL_PAD = 30;

export function Radar({
  axes,
  series,
  labels,
  size = 200,
  levels = 4,
  max,
  showLegend = true,
  dir,
  a11yFallback,
  className,
}: RadarChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const rtl = resolvedDir === 'rtl';
  const layout = radarLayout(axes, series, { size, levels, rtl, ...(max !== undefined ? { max } : {}) });
  const viewSize = size + LABEL_PAD * 2;

  return (
    <div
      className={className === undefined ? 'adm-donut' : `adm-donut ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
      data-export-node=""
    >
      <svg role="img" aria-label={labels.label} width={viewSize} height={viewSize} viewBox={`0 0 ${viewSize} ${viewSize}`}>
        {labels.description !== undefined && <desc>{labels.description}</desc>}
        <g transform={`translate(${LABEL_PAD}, ${LABEL_PAD})`} data-radar="">
          {layout.rings.map((ring) => (
            <path key={ring.level} d={ring.path} fill="none" stroke="var(--border)" strokeWidth={1} />
          ))}
          {layout.axes.map((axis) => (
            <line
              key={axis.label}
              x1={layout.center.x}
              y1={layout.center.y}
              x2={axis.point.x}
              y2={axis.point.y}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {layout.series.map((s, i) => (
            <path
              key={s.label}
              className="adm-chart-fade"
              style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 120}ms` }}
              d={s.path}
              fill={s.colorVar}
              fillOpacity={i === 0 ? 0.28 : 0.12}
              stroke={s.colorVar}
              strokeWidth={2}
              data-series={s.label}
            />
          ))}
          {layout.axes.map((axis) => {
            const anchor = Math.abs(axis.point.x - layout.center.x) < 1 ? 'middle' : axis.point.x > layout.center.x ? 'start' : 'end';
            const dx = anchor === 'middle' ? 0 : axis.point.x > layout.center.x ? 6 : -6;
            const dy = axis.point.y > layout.center.y ? 12 : axis.point.y < layout.center.y ? -6 : 4;
            return (
              <text
                key={`label-${axis.label}`}
                className="adm-chart-axis-label"
                x={axis.point.x + dx}
                y={axis.point.y + dy}
                textAnchor={anchor}
                data-axis-label={axis.label}
              >
                {axis.label}
              </text>
            );
          })}
        </g>
      </svg>

      {showLegend && layout.series.length > 0 && (
        <ul className="adm-donut-legend">
          {layout.series.map((s) => (
            <li key={s.label} className="adm-donut-legend-row">
              <span className="adm-donut-legend-dot" style={{ '--adm-dot': s.colorVar }} aria-hidden="true" />
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      )}

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
