// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure multi-series polyline geometry (d3-shape only) — the core of
 * `chart-multiline` and `chart-bump` (research/widget-registry.md §2). DOM-free
 * so scheduled-report workers reuse it; identical path strings in Node and the
 * browser (04 §7.1, acceptance #10).
 */
import { curveLinear, curveMonotoneX, line } from 'd3-shape';

import type { XYPoint } from './lineArea.js';

export interface PixelSeries {
  key: string;
  label: string;
  /** Pixel-space points; gaps (null values) are pre-filtered by the caller. */
  points: XYPoint[];
}

export interface SeriesPath {
  key: string;
  label: string;
  path: string | null;
  /** Last plotted point — anchor for end dots + end labels. */
  end: XYPoint | null;
}

/** One SVG path string per series through its pixel points, plus the end anchor. */
export function multiSeriesPaths(series: readonly PixelSeries[], smooth = false): SeriesPath[] {
  const generator = line<XYPoint>()
    .x((d) => d.x)
    .y((d) => d.y)
    .curve(smooth ? curveMonotoneX : curveLinear);
  return series.map((s) => ({
    key: s.key,
    label: s.label,
    path: s.points.length > 0 ? generator([...s.points]) : null,
    end: s.points.at(-1) ?? null,
  }));
}

/** Categorical series color var: series i → `--viz-((i mod 8)+1)` (viz.css order). */
export function seriesColorVar(index: number): string {
  return `var(--viz-${(index % 8) + 1})`;
}
