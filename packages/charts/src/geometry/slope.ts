// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure slope-chart layout (`chart-slope`, research/widget-registry.md §2): two
 * period axes (A → B) with one connecting line per record, colored by
 * direction, end labels. DOM-free. The two period columns are categorical, so
 * they mirror in RTL (A stays at inline-start — the right edge under `rtl`).
 */
import { linePath } from './lineArea.js';
import { extent } from '../utils/stats.js';

export interface SlopeInput {
  label: string;
  a: number;
  b: number;
}

export interface SlopeLine {
  index: number;
  label: string;
  a: number;
  b: number;
  xA: number;
  yA: number;
  xB: number;
  yB: number;
  /** b ≥ a → rising (pos tone); otherwise falling (danger tone). */
  rising: boolean;
  /** Two-point connector path. */
  path: string | null;
}

export interface SlopeLayout {
  lines: SlopeLine[];
  /** Inline-start axis x (period A). */
  xA: number;
  /** Inline-end axis x (period B). */
  xB: number;
  yFor: (value: number) => number;
}

export interface SlopeLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
}

export function layoutSlope(items: readonly SlopeInput[], options: SlopeLayoutOptions): SlopeLayout {
  const { width, height, rtl } = options;
  if (items.length === 0 || width <= 0 || height <= 0) {
    return { lines: [], xA: 0, xB: width, yFor: () => 0 };
  }

  const values = items.flatMap((item) => [item.a, item.b]);
  const [lo, hi] = extent(values) ?? [0, 1];
  const pad = (hi - lo) * 0.08 || 1;
  const domainLo = lo - pad;
  const domainHi = hi + pad;
  const span = domainHi - domainLo || 1;
  const yFor = (value: number): number => height - ((value - domainLo) / span) * height;

  const xA = rtl ? width : 0;
  const xB = rtl ? 0 : width;

  const lines: SlopeLine[] = items.map((item, index) => {
    const yA = yFor(item.a);
    const yB = yFor(item.b);
    return {
      index,
      label: item.label,
      a: item.a,
      b: item.b,
      xA,
      yA,
      xB,
      yB,
      rising: item.b >= item.a,
      path: linePath([
        { x: xA, y: yA },
        { x: xB, y: yB },
      ]),
    };
  });

  return { lines, xA, xB, yFor };
}
