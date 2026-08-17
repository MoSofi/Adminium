// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-timeline-lanes` primitive (research/widget-registry.md §2): horizontal
 * swimlanes with positioned pill events on a shared time axis (Deploys /
 * Incidents / Releases). A time axis renders as an LTR island (04 §7.4 — time
 * axes never mirror; gantt-like lanes stay LTR), so event positions and the
 * lane-label gutter are LTR regardless of page direction. Colors from the viz
 * palette and semantic tone tokens only.
 */
import type { ReactNode } from 'react';

import { layoutLanes } from '../geometry/timelineLanes.js';
import type { LaneEvent } from '../geometry/timelineLanes.js';
import { seriesColorVar } from '../geometry/multiLine.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface TimelineLanesChartProps {
  lanes: readonly string[];
  events: readonly LaneEvent[];
  labels: ChartLabels;
  /** Time-axis tick captions along the bottom (e.g. week buckets). */
  axisLabels?: readonly string[];
  height?: number;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

const GUTTER = 92;

/** Semantic tone → token color, else the lane's categorical viz color. */
function toneColor(tone: string | undefined, laneIndex: number): string {
  switch (tone) {
    case 'pos':
      return 'var(--pos)';
    case 'danger':
      return 'var(--danger)';
    case 'warn':
      return 'var(--warn)';
    case 'info':
      return 'var(--info)';
    default:
      return seriesColorVar(laneIndex);
  }
}

export function TimelineLanesChart({
  lanes,
  events,
  labels,
  axisLabels,
  height = 200,
  dir,
  a11yFallback,
  className,
}: TimelineLanesChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      // Lane-label gutter at the inline-start; time axis fills the rest (LTR island).
      padding={{ top: 8, bottom: axisLabels && axisLabels.length > 0 ? 22 : 10, left: GUTTER, right: 14 }}
    >
      {({ innerWidth, innerHeight, mounted }) => {
        if (lanes.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

        const rows = layoutLanes(lanes, events, innerWidth, innerHeight, { laneGap: 8 });

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {rows.map((row) => (
              <g key={row.lane} data-lane={row.lane}>
                {/* Lane track. */}
                <rect x={0} y={row.y} width={innerWidth} height={row.height} rx={6} fill="var(--surface-2)" />
                {/* Lane label in the gutter. */}
                <text
                  x={-10}
                  y={row.centerY + 3}
                  textAnchor="end"
                  fontSize={10.5}
                  fontWeight={600}
                  fill="var(--fg-muted)"
                  data-lane-label={row.lane}
                >
                  {row.lane}
                </text>
                {row.events.map((event, j) => {
                  const color = toneColor(event.tone, row.index);
                  const width = event.label.length * 5.6 + 22;
                  const pillX = Math.min(innerWidth - width, Math.max(0, event.x - width / 2));
                  return (
                    <g key={`${row.lane}-${j}`} data-event={event.label} transform={`translate(${pillX}, ${row.centerY - 9})`}>
                      <rect x={0} y={0} width={width} height={18} rx={9} fill="var(--surface-3)" stroke={color} strokeWidth={1} />
                      <circle cx={11} cy={9} r={3} fill={color} />
                      <text x={19} y={12} fontSize={9.5} fontWeight={600} fill="var(--fg)">
                        {event.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            ))}

            {axisLabels?.map((label, i) => {
              const count = axisLabels.length;
              const x = count > 1 ? (innerWidth / (count - 1)) * i : innerWidth / 2;
              const anchor = i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle';
              return (
                <text
                  key={`axis-${i}`}
                  className="adm-chart-axis-label"
                  x={x}
                  y={innerHeight + 15}
                  textAnchor={anchor}
                >
                  {label}
                </text>
              );
            })}
          </g>
        );
      }}
    </ChartSurface>
  );
}
