// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-waterfall` primitive (research/widget-registry.md §2): a floating-bar
 * bridge (Start / New / Expansion / Churn / Net) with +/− colored steps and
 * total anchors, plus connector segments riding the running level. Composed
 * from ChartSurface + pure `layoutWaterfall` geometry. Token-only colors
 * (pos/danger/accent-ramp), categorical x mirrors in RTL, mount fade.
 */
import type { ReactNode } from 'react';

import { layoutWaterfall } from '../geometry/waterfall.js';
import type { WaterfallInput, WaterfallStepType } from '../geometry/waterfall.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface WaterfallChartProps {
  data: readonly WaterfallInput[];
  labels: ChartLabels;
  height?: number;
  showAxis?: boolean;
  formatValue?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

function typeColor(type: WaterfallStepType): string {
  if (type === 'up') return 'var(--pos)';
  if (type === 'down') return 'var(--danger)';
  return 'var(--viz-ramp-4)';
}

/**
 * Value-label color. The design colors the number like its step, so the bridge
 * reads without tracing each bar; totals stay neutral because `typeColor`'s
 * ramp fill is a background tint and unreadable as text on the card.
 */
function valueColor(type: WaterfallStepType): string {
  return type === 'total' ? 'var(--fg-muted)' : typeColor(type);
}

function signedText(type: WaterfallStepType, value: number, format: (v: number) => string): string {
  if (type === 'up') return `+${format(value)}`;
  if (type === 'down') return `−${format(value)}`;
  return format(value);
}

export function WaterfallChart({
  data,
  labels,
  height = 260,
  showAxis = true,
  formatValue = formatCompact,
  dir,
  a11yFallback,
  className,
}: WaterfallChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 18, bottom: 22, left: showAxis ? 36 : 6, right: 8 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
        const layout = layoutWaterfall(data, { width: innerWidth, height: innerHeight, rtl });
        const valueEdge = rtl ? innerWidth + 6 : -6;

        return (
          <g>
            {showAxis &&
              layout.yTicks.map((tick) => (
                <g key={tick}>
                  <line
                    className="adm-chart-gridline"
                    x1={0}
                    x2={innerWidth}
                    y1={layout.yFor(tick)}
                    y2={layout.yFor(tick)}
                  />
                  <text
                    className="adm-chart-axis-label adm-chart-num"
                    x={valueEdge}
                    y={layout.yFor(tick) + 3}
                    textAnchor={rtl ? 'start' : 'end'}
                  >
                    {formatValue(tick)}
                  </text>
                </g>
              ))}

            {/* Connectors between adjacent steps. */}
            {layout.connectors.map((connector) => (
              <line
                key={connector.fromIndex}
                x1={connector.x1}
                x2={connector.x2}
                y1={connector.y}
                y2={connector.y}
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="3 3"
                data-connector={connector.fromIndex}
              />
            ))}

            {/* Floating step bars. */}
            <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
              {layout.bars.map((bar) => (
                <g key={bar.label} data-step={bar.index} data-type={bar.type}>
                  <rect
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={Math.max(1, bar.height)}
                    rx={2}
                    fill={typeColor(bar.type)}
                  />
                  <text
                    className="adm-chart-num"
                    x={bar.centerX}
                    y={bar.y - 5}
                    textAnchor="middle"
                    fontSize={9.5}
                    fontWeight={700}
                    fill={valueColor(bar.type)}
                  >
                    {signedText(bar.type, bar.value, formatValue)}
                  </text>
                  <text
                    className="adm-chart-axis-label"
                    x={bar.centerX}
                    y={innerHeight + 15}
                    textAnchor="middle"
                  >
                    {bar.label}
                  </text>
                </g>
              ))}
            </g>
          </g>
        );
      }}
    </ChartSurface>
  );
}
