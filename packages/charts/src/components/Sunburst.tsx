/**
 * `chart-sunburst` primitive (research/widget-registry.md §2): two nested rings
 * from a 2-level hierarchy (inner = parents, outer = children), with a legend of
 * the parent categories. Arcs sweep clockwise and do NOT mirror in RTL (§7.4).
 * Colors are tokens only; geometry is pure (04 §7.1).
 */
import type { ReactNode } from 'react';

import { sunburstArcs } from '../geometry/sunburst.js';
import type { SunburstParentInput } from '../geometry/sunburst.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

export interface SunburstChartProps {
  data: readonly SunburstParentInput[];
  labels: ChartLabels;
  /** Diameter in px (default 200). */
  size?: number;
  /** Radius of the empty center hole (default 0.28 × radius). */
  innerRadiusRatio?: number;
  showLegend?: boolean;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function Sunburst({
  data,
  labels,
  size = 200,
  innerRadiusRatio = 0.28,
  showLegend = true,
  dir,
  a11yFallback,
  className,
}: SunburstChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const innerRadius = (size / 2) * innerRadiusRatio;
  const { arcs } = sunburstArcs(data, { size, innerRadius });
  const parents = arcs.filter((a) => a.depth === 0);

  return (
    <div
      className={className === undefined ? 'adm-donut' : `adm-donut ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
      data-export-node=""
    >
      <svg role="img" aria-label={labels.label} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {labels.description !== undefined && <desc>{labels.description}</desc>}
        <g transform={`translate(${size / 2}, ${size / 2})`} data-sunburst="">
          {arcs.map((arc, i) => (
            <path
              key={`${arc.parentLabel ?? 'root'}-${arc.label}-${arc.depth}`}
              className="adm-chart-fade"
              style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 55}ms` }}
              d={arc.path}
              fill={arc.colorVar}
              stroke="var(--surface)"
              strokeWidth={1}
              data-arc={arc.label}
              data-depth={arc.depth}
            />
          ))}
        </g>
      </svg>

      {showLegend && (
        <ul className="adm-donut-legend">
          {parents.map((arc) => (
            <li key={arc.label} className="adm-donut-legend-row">
              <span className="adm-donut-legend-dot" style={{ '--adm-dot': arc.colorVar }} aria-hidden="true" />
              <span>{arc.label}</span>
              <span className="adm-donut-legend-value">{`${Math.round(arc.share * 100)}%`}</span>
            </li>
          ))}
        </ul>
      )}

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
