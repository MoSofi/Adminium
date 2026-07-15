/**
 * `chart-radial-bar` primitive (research/widget-registry.md §2): concentric
 * progress rings (≤4 categories), each a stroke sweep of its percent, with a
 * legend of colored dots + mono percents. Rings never mirror in RTL (rotation
 * is direction-neutral, §7.4) — only the legend flips via flex + logical CSS.
 * Colors are tokens only; geometry is pure (04 §7.1).
 */
import type { ReactNode } from 'react';

import { radialBarRings } from '../geometry/radialBar.js';
import type { RadialBarInput } from '../geometry/radialBar.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

export interface RadialBarChartProps {
  data: readonly RadialBarInput[];
  labels: ChartLabels;
  /** Ring diameter in px (default 168). */
  size?: number;
  thickness?: number;
  showLegend?: boolean;
  format?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const defaultFormat = (value: number): string => `${Math.round(value)}%`;

export function RadialBar({
  data,
  labels,
  size = 168,
  thickness = 12,
  showLegend = true,
  format = defaultFormat,
  dir,
  a11yFallback,
  className,
}: RadialBarChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const rings = radialBarRings(data, { size, thickness });

  return (
    <div
      className={className === undefined ? 'adm-donut' : `adm-donut ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
      data-export-node=""
    >
      <svg role="img" aria-label={labels.label} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {labels.description !== undefined && <desc>{labels.description}</desc>}
        <g transform={`translate(${size / 2}, ${size / 2})`}>
          {rings.map((ring, i) => (
            <g key={ring.label} data-ring={ring.label}>
              <path d={ring.trackPath} fill="var(--border)" opacity={0.4} />
              {ring.valuePath !== '' && (
                <path
                  className="adm-chart-fade"
                  style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 90}ms` }}
                  d={ring.valuePath}
                  fill={ring.colorVar}
                  data-value=""
                />
              )}
            </g>
          ))}
        </g>
      </svg>

      {showLegend && (
        <ul className="adm-donut-legend">
          {rings.map((ring) => (
            <li key={ring.label} className="adm-donut-legend-row">
              <span className="adm-donut-legend-dot" style={{ '--adm-dot': ring.colorVar }} aria-hidden="true" />
              <span>{ring.label}</span>
              <span className="adm-donut-legend-value">{format(ring.value)}</span>
            </li>
          ))}
        </ul>
      )}

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
