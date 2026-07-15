/**
 * `chart-sankey` primitive (research/widget-registry.md §2): SVG bezier ribbons
 * between layered node rects, source→target flows weighted by volume, per-flow
 * tooltips. Responsive via ChartSurface. Token-only colors, mount fade with
 * reduced-motion fallback, `data-export-node` raster marker (inherited from
 * ChartSurface). Renders as an LTR island — the flow never mirrors in RTL
 * (04 §7.4).
 */
import type { ReactNode } from 'react';

import { sankeyLayout } from '../geometry/sankey.js';
import type { SankeyLinkInput, SankeyNodeInput } from '../geometry/sankey.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface SankeyChartProps {
  nodes: readonly SankeyNodeInput[];
  links: readonly SankeyLinkInput[];
  labels: ChartLabels;
  height?: number;
  nodeWidth?: number;
  nodePad?: number;
  /** Show node labels beside each column (default true). */
  showLabels?: boolean;
  /** Format a link weight for its tooltip (default `${w}`). */
  format?: (weight: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function SankeyChart({
  nodes,
  links,
  labels,
  height = 300,
  nodeWidth = 14,
  nodePad = 12,
  showLabels = true,
  format = String,
  dir,
  a11yFallback,
  className,
}: SankeyChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 10, bottom: 10, left: 6, right: 6 }}
    >
      {({ innerWidth, innerHeight, mounted }) => {
        if (nodes.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = sankeyLayout(nodes, links, {
          width: innerWidth,
          height: innerHeight,
          nodeWidth,
          nodePad,
        });
        const nodeById = new Map(layout.nodes.map((n) => [n.id, n] as const));

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {/* Ribbons under nodes. */}
            {layout.links.map((link, i) => (
              <path
                key={`${link.from}-${link.to}-${i}`}
                d={link.path}
                fill={link.sourceColorVar}
                fillOpacity={0.4}
                data-sankey-link=""
              >
                <title>{`${nodeById.get(link.from)?.label ?? link.from} → ${
                  nodeById.get(link.to)?.label ?? link.to
                }: ${format(link.weight)}`}</title>
              </path>
            ))}

            {layout.nodes.map((node) => {
              const isLastLayer = node.layer === layout.layers - 1;
              return (
                <g key={node.id}>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    rx={2}
                    fill={node.colorVar}
                    data-sankey-node={node.id}
                  >
                    <title>{`${node.label}: ${format(node.value)}`}</title>
                  </rect>
                  {showLabels && (
                    <text
                      className="adm-chart-axis-label"
                      x={isLastLayer ? node.x - 6 : node.x + node.w + 6}
                      y={node.y + node.h / 2 + 3}
                      textAnchor={isLastLayer ? 'end' : 'start'}
                    >
                      {node.label}
                    </text>
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
