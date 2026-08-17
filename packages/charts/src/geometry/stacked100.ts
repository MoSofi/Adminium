// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure 100%-stacked horizontal bar layout (`chart-stacked-bar-100`,
 * research/widget-registry.md §2): one bar split into shares with small gaps.
 * DOM-free. Segment order mirrors in RTL (first share at inline-start = the
 * right edge under `rtl`).
 */

export interface StackedInput {
  key: string;
  label: string;
  value: number;
}

export interface StackedSegment {
  index: number;
  key: string;
  label: string;
  value: number;
  /** Share of the total, 0..1. */
  share: number;
  x: number;
  width: number;
}

export interface StackedLayout {
  segments: StackedSegment[];
  total: number;
}

export interface StackedLayoutOptions {
  width: number;
  rtl: boolean;
  /** Gap between segments in px (default 2). */
  gap?: number;
}

export function layoutStacked100(items: readonly StackedInput[], options: StackedLayoutOptions): StackedLayout {
  const { width, rtl, gap = 2 } = options;
  const n = items.length;
  if (n === 0 || width <= 0) return { segments: [], total: 0 };

  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const totalGap = gap * Math.max(0, n - 1);
  const usableWidth = Math.max(0, width - totalGap);

  let cursor = 0;
  const segments: StackedSegment[] = items.map((item, index) => {
    const value = Math.max(0, item.value);
    const share = total > 0 ? value / total : 1 / n;
    const segWidth = usableWidth * share;
    const inlineStart = cursor;
    cursor += segWidth + gap;
    return {
      index,
      key: item.key,
      label: item.label,
      value: item.value,
      share,
      x: rtl ? width - inlineStart - segWidth : inlineStart,
      width: segWidth,
    };
  });

  return { segments, total };
}
