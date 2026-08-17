// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure bullet-graph layout (`chart-bullet`, research/widget-registry.md §2):
 * per row a stack of qualitative bands + a measure bar + a target tick. DOM-free.
 * The horizontal value axis mirrors in RTL (annex §7.4): bands/measure anchor at
 * inline-start (the right edge under `rtl`) and grow toward inline-end.
 */

export interface BulletInput {
  label: string;
  measure: number;
  target: number;
  /** Axis maximum; defaults to the largest of measure/target/cutoffs. */
  max?: number;
  /** Ascending band boundaries in value units, e.g. [40, 75] → 3 zones. */
  bandCutoffs?: readonly number[];
}

export interface BulletBand {
  index: number;
  /** Band inline-start x. */
  x: number;
  width: number;
  /** 0..1 intensity, lightest → strongest. */
  level: number;
}

export interface BulletRow {
  index: number;
  label: string;
  measure: number;
  target: number;
  max: number;
  rowY: number;
  /** Track (bands) rect. */
  trackY: number;
  trackHeight: number;
  bands: BulletBand[];
  /** Measure bar (inline-start anchored). */
  measureX: number;
  measureWidth: number;
  measureY: number;
  measureHeight: number;
  /** Target tick x. */
  targetX: number;
}

export interface BulletLayout {
  rows: BulletRow[];
  rowHeight: number;
}

export interface BulletLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
}

/** Map a value in [0, max] to an inline-start-anchored pixel length. */
function lengthFor(value: number, max: number, width: number): number {
  if (max <= 0) return 0;
  return (Math.max(0, Math.min(value, max)) / max) * width;
}

/** Map a value to a pixel x honoring the RTL axis flip. */
function xFor(value: number, max: number, width: number, rtl: boolean): number {
  const len = lengthFor(value, max, width);
  return rtl ? width - len : len;
}

export function layoutBullet(items: readonly BulletInput[], options: BulletLayoutOptions): BulletLayout {
  const { width, height, rtl } = options;
  const n = items.length;
  if (n === 0 || width <= 0 || height <= 0) return { rows: [], rowHeight: 0 };

  const rowHeight = height / n;
  const trackHeight = Math.max(6, rowHeight * 0.55);
  const measureHeight = Math.max(3, trackHeight * 0.34);

  const rows: BulletRow[] = items.map((item, index) => {
    const cutoffs = [...(item.bandCutoffs ?? [])].filter((c) => c > 0).sort((a, b) => a - b);
    const max = item.max ?? Math.max(item.measure, item.target, cutoffs.at(-1) ?? 0, 1);
    const rowY = index * rowHeight;
    const trackY = rowY + (rowHeight - trackHeight) / 2;

    // Band edges: 0, ...cutoffs, max → contiguous zones.
    const edges = [0, ...cutoffs.filter((c) => c < max), max];
    const zoneCount = edges.length - 1;
    const bands: BulletBand[] = [];
    for (let i = 0; i < zoneCount; i += 1) {
      const lo = edges[i] ?? 0;
      const hi = edges[i + 1] ?? max;
      const xLo = xFor(lo, max, width, rtl);
      const xHi = xFor(hi, max, width, rtl);
      bands.push({
        index: i,
        x: Math.min(xLo, xHi),
        width: Math.abs(xHi - xLo),
        level: zoneCount <= 1 ? 1 : i / (zoneCount - 1),
      });
    }

    const measureLen = lengthFor(item.measure, max, width);
    return {
      index,
      label: item.label,
      measure: item.measure,
      target: item.target,
      max,
      rowY,
      trackY,
      trackHeight,
      bands,
      measureX: rtl ? width - measureLen : 0,
      measureWidth: measureLen,
      measureY: rowY + (rowHeight - measureHeight) / 2,
      measureHeight,
      targetX: xFor(item.target, max, width, rtl),
    };
  });

  return { rows, rowHeight };
}
