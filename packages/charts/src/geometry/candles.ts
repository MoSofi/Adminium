// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OHLC candlestick geometry (`chart-candlestick`, research/widget-registry.md
 * §2). Pure + DOM-free. The price axis is a fixed LTR-island convention
 * (04 §7.4 exceptions: candlestick price axis never mirrors), so this layout
 * takes no `rtl` flag — candles are index-ordered left→right regardless of
 * page direction.
 */
import { extent, niceTicks } from '../utils/stats.js';

export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface CandleRect {
  index: number;
  /** Candle center x (wick line). */
  centerX: number;
  /** Body rect. */
  x: number;
  width: number;
  bodyY: number;
  bodyHeight: number;
  /** Wick endpoints (pixel y). */
  highY: number;
  lowY: number;
  /** Close ≥ open → rising (pos tone); else falling (danger tone). */
  up: boolean;
}

export interface CandleLayout {
  rects: CandleRect[];
  /** Value → pixel y (price axis). */
  yFor: (value: number) => number;
  /** Nice price ticks (ascending). */
  yTicks: number[];
}

export interface CandleLayoutOptions {
  /** Fraction of each slot the body occupies (0–1, default 0.6). */
  bodyRatio?: number;
  tickCount?: number;
  /** Minimum body height so doji candles stay visible (px, default 1). */
  minBody?: number;
}

/** Index-ordered candle rects + a shared price y-scale over [low…high]. */
export function layoutCandles(
  candles: readonly Candle[],
  width: number,
  height: number,
  options: CandleLayoutOptions = {},
): CandleLayout {
  const { bodyRatio = 0.6, tickCount = 4, minBody = 1 } = options;
  const prices = candles.flatMap((candle) => [candle.h, candle.l, candle.o, candle.c]);
  const [minPrice, maxPrice] = extent(prices) ?? [0, 1];
  const yTicks = minPrice === maxPrice ? [minPrice, minPrice + 1] : niceTicks(minPrice, maxPrice, tickCount);
  const domainLo = yTicks[0] ?? minPrice;
  const domainHi = yTicks.at(-1) ?? maxPrice;
  const span = domainHi - domainLo || 1;
  const yFor = (value: number) => height - ((value - domainLo) / span) * height;

  const slot = candles.length > 0 ? width / candles.length : width;
  const bodyWidth = Math.max(1, slot * bodyRatio);

  const rects: CandleRect[] = candles.map((candle, index) => {
    const centerX = slot * (index + 0.5);
    const openY = yFor(candle.o);
    const closeY = yFor(candle.c);
    const up = candle.c >= candle.o;
    const top = Math.min(openY, closeY);
    const bodyHeight = Math.max(minBody, Math.abs(closeY - openY));
    return {
      index,
      centerX,
      x: centerX - bodyWidth / 2,
      width: bodyWidth,
      bodyY: top,
      bodyHeight,
      highY: yFor(candle.h),
      lowY: yFor(candle.l),
      up,
    };
  });

  return { rects, yFor, yTicks };
}
