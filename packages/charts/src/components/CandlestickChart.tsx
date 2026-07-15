/**
 * `chart-candlestick` primitive (research/widget-registry.md §2): OHLC candles
 * colored pos/danger, a dashed last-price line and an optional "live" pill.
 * The price axis is an LTR island — candles never mirror and the price scale
 * sits at the inline-end regardless of page direction (04 §7.4 exceptions).
 * Colors from the pos/danger tokens and neutrals only.
 */
import type { ReactNode } from 'react';

import { layoutCandles } from '../geometry/candles.js';
import type { Candle } from '../geometry/candles.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface CandlestickChartProps {
  candles: readonly Candle[];
  labels: ChartLabels;
  height?: number;
  showAxis?: boolean;
  /** Render the "live" pill in the corner (default false). */
  livePill?: boolean;
  livePillLabel?: string;
  formatPrice?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function CandlestickChart({
  candles,
  labels,
  height = 260,
  showAxis = true,
  livePill = false,
  livePillLabel = 'Live',
  formatPrice = formatCompact,
  dir,
  a11yFallback,
  className,
}: CandlestickChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      // Price axis pinned to the right (LTR-island convention), so pad right.
      padding={{ top: 10, bottom: 8, left: 6, right: showAxis ? 44 : 8 }}
    >
      {({ innerWidth, innerHeight, mounted }) => {
        if (candles.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

        const layout = layoutCandles(candles, innerWidth, innerHeight);
        const last = candles.at(-1)!;
        const lastY = layout.yFor(last.c);
        const lastUp = last.c >= last.o;

        return (
          <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
            {showAxis &&
              layout.yTicks.map((tick) => (
                <g key={tick}>
                  <line className="adm-chart-gridline" x1={0} x2={innerWidth} y1={layout.yFor(tick)} y2={layout.yFor(tick)} />
                  <text
                    className="adm-chart-axis-label adm-chart-num"
                    x={innerWidth + 6}
                    y={layout.yFor(tick) + 3}
                    textAnchor="start"
                  >
                    {formatPrice(tick)}
                  </text>
                </g>
              ))}

            {layout.rects.map((rect) => {
              const tone = rect.up ? 'var(--pos)' : 'var(--danger)';
              return (
                <g key={rect.index} data-candle={rect.index} data-dir={rect.up ? 'up' : 'down'}>
                  <line x1={rect.centerX} x2={rect.centerX} y1={rect.highY} y2={rect.lowY} stroke={tone} strokeWidth={1.25} />
                  <rect
                    x={rect.x}
                    y={rect.bodyY}
                    width={rect.width}
                    height={rect.bodyHeight}
                    fill={tone}
                    data-body=""
                  />
                </g>
              );
            })}

            {/* Last-price marker line + tag. */}
            <line
              x1={0}
              x2={innerWidth}
              y1={lastY}
              y2={lastY}
              stroke={lastUp ? 'var(--pos)' : 'var(--danger)'}
              strokeWidth={1}
              strokeDasharray="3 3"
              data-last-price=""
            />
            {showAxis && (
              <text
                x={innerWidth + 6}
                y={lastY + 3}
                textAnchor="start"
                fontSize={10}
                fontWeight={700}
                fill={lastUp ? 'var(--pos)' : 'var(--danger)'}
                data-last-price-label=""
              >
                {formatPrice(last.c)}
              </text>
            )}

            {livePill && (
              <g data-live-pill="" transform="translate(4, 2)">
                <rect x={0} y={0} width={44} height={16} rx={8} fill="var(--pos-soft)" />
                <circle cx={11} cy={8} r={3} fill="var(--pos)" />
                <text x={19} y={11} fontSize={9} fontWeight={700} fill="var(--pos)">
                  {livePillLabel}
                </text>
              </g>
            )}
          </g>
        );
      }}
    </ChartSurface>
  );
}
