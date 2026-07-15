/**
 * Pure waterfall / bridge layout (`chart-waterfall`, research/widget-registry.md
 * §2): floating bars for signed steps plus total anchors, with connector
 * segments riding the running level. DOM-free. Categorical x mirrors in RTL
 * (band-scale flip); connectors bridge adjacent bars on the correct logical
 * side so they read left→right in LTR and right→left in RTL.
 */
import { categoricalBandScale } from './scales.js';
import { niceTicks } from '../utils/stats.js';

export type WaterfallStepType = 'up' | 'down' | 'total';

export interface WaterfallInput {
  label: string;
  /** Magnitude (non-negative). Sign is implied by `type`. */
  value: number;
  type: WaterfallStepType;
}

export interface WaterfallBar {
  index: number;
  label: string;
  value: number;
  type: WaterfallStepType;
  /** Running level after this step (the connector level to the next bar). */
  exitLevel: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
}

export interface WaterfallConnector {
  fromIndex: number;
  x1: number;
  x2: number;
  y: number;
}

export interface WaterfallLayout {
  bars: WaterfallBar[];
  connectors: WaterfallConnector[];
  yTicks: number[];
  yFor: (value: number) => number;
}

export interface WaterfallLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  tickCount?: number;
}

export function layoutWaterfall(items: readonly WaterfallInput[], options: WaterfallLayoutOptions): WaterfallLayout {
  const { width, height, rtl, tickCount = 3 } = options;
  if (items.length === 0 || width <= 0 || height <= 0) {
    return { bars: [], connectors: [], yTicks: [], yFor: () => 0 };
  }

  // First pass in value-space: resolve each bar's low/high band and exit level.
  let running = 0;
  const spans = items.map((item) => {
    const magnitude = Math.max(0, item.value);
    let low: number;
    let high: number;
    if (item.type === 'total') {
      running = item.value;
      low = Math.min(0, item.value);
      high = Math.max(0, item.value);
    } else if (item.type === 'down') {
      high = running;
      running -= magnitude;
      low = running;
    } else {
      low = running;
      running += magnitude;
      high = running;
    }
    return { low, high, exitLevel: running };
  });

  const highest = spans.reduce((m, s) => Math.max(m, s.high), 0);
  const lowest = spans.reduce((m, s) => Math.min(m, s.low), 0);
  const ticks = niceTicks(Math.min(0, lowest), Math.max(1, highest), tickCount);
  const domainLo = ticks[0] ?? Math.min(0, lowest);
  const domainHi = ticks.at(-1) ?? Math.max(1, highest);
  const span = domainHi - domainLo || 1;
  const yFor = (value: number): number => height - ((value - domainLo) / span) * height;

  const band = categoricalBandScale(
    items.map((item) => item.label),
    width,
    rtl,
    { paddingInner: 0.34, paddingOuter: 0.18 },
  );
  const bandwidth = band.bandwidth();

  const bars: WaterfallBar[] = items.map((item, index) => {
    const s = spans[index] ?? { low: 0, high: 0, exitLevel: 0 };
    const x = band(item.label) ?? 0;
    const yHigh = yFor(s.high);
    const yLow = yFor(s.low);
    return {
      index,
      label: item.label,
      value: item.value,
      type: item.type,
      exitLevel: s.exitLevel,
      x,
      y: Math.min(yHigh, yLow),
      width: bandwidth,
      height: Math.max(0, Math.abs(yLow - yHigh)),
      centerX: x + bandwidth / 2,
    };
  });

  const connectors: WaterfallConnector[] = [];
  for (let i = 0; i < bars.length - 1; i += 1) {
    const a = bars[i];
    const b = bars[i + 1];
    if (a === undefined || b === undefined) continue;
    connectors.push({
      fromIndex: i,
      x1: rtl ? a.x : a.x + a.width,
      x2: rtl ? b.x + b.width : b.x,
      y: yFor(a.exitLevel),
    });
  }

  return { bars, connectors, yTicks: ticks, yFor };
}
