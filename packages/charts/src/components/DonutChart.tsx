// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-donut` primitive (research/widget-registry.md §2): SVG arcs via
 * d3-shape, inner total slot, legend rows (color dot, label, mono value),
 * maxSlices + "other" bucket. Rotation stays clockwise in RTL; the legend and
 * center layout mirror via flex + logical properties (10-i18n-theming.md §5.5).
 */
import type { ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import { donutArcs } from '../geometry/donut.js';
import type { DonutSliceInput } from '../geometry/donut.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import { formatCompact } from '../utils/format.js';
import type { ChartLabels } from './ChartSurface.js';

export interface DonutChartProps {
  data: readonly DonutSliceInput[];
  labels: ChartLabels;
  /** Slices beyond this collapse into a trailing "other" bucket (default 5). */
  maxSlices?: number;
  otherLabel?: string;
  /** Caption under the center total (e.g. "Total"). */
  centerLabel?: string;
  /** Override the auto center value (defaults to the formatted total). */
  centerValue?: string;
  /** Ring diameter in px (default 160). */
  size?: number;
  thickness?: number;
  showLegend?: boolean;
  format?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function DonutChart({
  data,
  labels,
  maxSlices = 5,
  otherLabel,
  centerLabel,
  centerValue,
  size = 160,
  thickness = 20,
  showLegend = true,
  format = formatCompact,
  dir,
  a11yFallback,
  className,
}: DonutChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const t = useMaybeT();

  const arcs = donutArcs(data, {
    outerRadius: size / 2,
    thickness,
    maxSlices,
    // Threaded into the geometry's "other" bucket label (shared primitive key).
    otherLabel: otherLabel ?? t('ui:charts.otherLabel', 'Other'),
  });
  const total = data.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const shownCenterValue = centerValue ?? format(total);

  return (
    <div
      className={className === undefined ? 'adm-donut' : `adm-donut ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
    >
      <svg
        role="img"
        aria-label={labels.label}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        data-export-node=""
      >
        {labels.description !== undefined && <desc>{labels.description}</desc>}
        <g transform={`translate(${size / 2}, ${size / 2})`}>
          {arcs.map((slice, i) => (
            <path
              key={slice.label}
              className="adm-chart-fade"
              style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 80}ms` }}
              d={slice.path}
              fill={slice.colorVar}
              data-slice={slice.label}
              data-other={slice.isOther ? '' : undefined}
            />
          ))}
          {/* The centered value scales with the ring (design ratios 17/112 and
              26/172) so a small donut cannot overflow its own hole. */}
          <text
            className="adm-donut-center-value"
            style={{ '--adm-center-size': `${Math.round(size * 0.15)}px` }}
            textAnchor="middle"
            dy={centerLabel !== undefined ? '0.1em' : '0.35em'}
          >
            {shownCenterValue}
          </text>
          {centerLabel !== undefined && (
            <text className="adm-donut-center-label" textAnchor="middle" dy="1.6em">
              {centerLabel}
            </text>
          )}
        </g>
      </svg>

      {showLegend && (
        <ul className="adm-donut-legend">
          {arcs.map((slice) => (
            <li key={slice.label} className="adm-donut-legend-row">
              <span className="adm-donut-legend-dot" style={{ '--adm-dot': slice.colorVar }} aria-hidden="true" />
              <span>{slice.label}</span>
              <span className="adm-donut-legend-value">{format(slice.value)}</span>
            </li>
          ))}
        </ul>
      )}

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
