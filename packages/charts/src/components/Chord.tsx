// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-chord` primitive (research/widget-registry.md §2): nodes on a ring
 * sized by total pairwise volume, connected by quadratic-bezier ribbons whose
 * opacity encodes pair weight, plus a legend of node dots. Node order steps
 * clockwise (LTR) / CCW (RTL) to mirror per §7.4. Colors are tokens only;
 * geometry is pure (04 §7.1).
 */
import type { ReactNode } from 'react';

import { adjacencyMatrix, chordLayout } from '../geometry/chord.js';
import type { ChordNodeInput } from '../geometry/chord.js';
import { useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import type { ChartLabels } from './ChartSurface.js';

export interface ChordLink {
  from: string;
  to: string;
  weight: number;
}

export interface ChordChartProps {
  nodes: readonly ChordNodeInput[];
  links: readonly ChordLink[];
  labels: ChartLabels;
  /** Ring diameter in px (default 220). */
  size?: number;
  thickness?: number;
  showLegend?: boolean;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function Chord({
  nodes,
  links,
  labels,
  size = 220,
  thickness = 12,
  showLegend = true,
  dir,
  a11yFallback,
  className,
}: ChordChartProps) {
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();
  const rtl = resolvedDir === 'rtl';
  const matrix = adjacencyMatrix(
    nodes.map((n) => n.id),
    links,
  );
  const layout = chordLayout(nodes, matrix, { size, thickness, rtl });
  const maxWeight = layout.ribbons.reduce((m, r) => Math.max(m, r.weight), 0);

  return (
    <div
      className={className === undefined ? 'adm-donut' : `adm-donut ${className}`}
      {...(dir !== undefined ? { dir: resolvedDir } : {})}
      data-export-node=""
    >
      <svg role="img" aria-label={labels.label} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {labels.description !== undefined && <desc>{labels.description}</desc>}
        <g data-chord="">
          {layout.ribbons.map((ribbon, i) => (
            <path
              key={`${ribbon.from}-${ribbon.to}`}
              className="adm-chart-fade"
              style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 60}ms` }}
              d={ribbon.path}
              fill="none"
              stroke={ribbon.colorVar}
              strokeWidth={maxWeight > 0 ? 1.5 + (ribbon.weight / maxWeight) * 5 : 2}
              strokeOpacity={0.45}
              strokeLinecap="round"
              data-ribbon={`${ribbon.from}-${ribbon.to}`}
            />
          ))}
          {layout.arcs.map((arc) => (
            <path key={arc.id} d={arc.path} fill={arc.colorVar} data-node={arc.id} transform={`translate(${layout.center.x}, ${layout.center.y})`} />
          ))}
        </g>
      </svg>

      {showLegend && (
        <ul className="adm-donut-legend">
          {layout.arcs.map((arc) => (
            <li key={arc.id} className="adm-donut-legend-row">
              <span className="adm-donut-legend-dot" style={{ '--adm-dot': arc.colorVar }} aria-hidden="true" />
              <span>{arc.label}</span>
              <span className="adm-donut-legend-value">{Math.round(arc.total)}</span>
            </li>
          ))}
        </ul>
      )}

      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
