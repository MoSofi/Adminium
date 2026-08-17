// SPDX-License-Identifier: AGPL-3.0-only
/** Pure donut geometry — d3-shape pie/arc, maxSlices + "other" bucketing. */
import { arc, pie } from 'd3-shape';

export interface DonutSliceInput {
  label: string;
  value: number;
}

export interface DonutArcDatum {
  label: string;
  value: number;
  /** Fraction of total, 0..1. */
  share: number;
  /** SVG path centered on (0,0). */
  path: string;
  /** CSS color expression — `var(--viz-N)` cycling; the other bucket is neutral. */
  colorVar: string;
  isOther: boolean;
}

/** Aggregate slices beyond `maxSlices` into a trailing "other" bucket. */
export function bucketSlices(
  slices: readonly DonutSliceInput[],
  maxSlices: number,
  otherLabel = 'Other',
): { slices: DonutSliceInput[]; otherIndex: number } {
  if (maxSlices <= 0 || slices.length <= maxSlices) {
    return { slices: [...slices], otherIndex: -1 };
  }
  const kept = slices.slice(0, maxSlices);
  const rest = slices.slice(maxSlices).reduce((sum, s) => sum + s.value, 0);
  return { slices: [...kept, { label: otherLabel, value: rest }], otherIndex: maxSlices };
}

export interface DonutArcsOptions {
  outerRadius: number;
  /** Ring thickness in px. */
  thickness: number;
  padAngle?: number;
  cornerRadius?: number;
  maxSlices?: number;
  otherLabel?: string;
}

/**
 * Donut arcs in input order (no value sort — legend order matches data).
 * Rotation is always clockwise from 12 o'clock; per the RTL rules
 * (10-i18n-theming.md §5.5) rotation direction does NOT change in RTL — only
 * the surrounding legend/center layout mirrors, which is plain flex/logical CSS.
 */
export function donutArcs(slices: readonly DonutSliceInput[], options: DonutArcsOptions): DonutArcDatum[] {
  const { outerRadius, thickness, padAngle = 0.02, cornerRadius = 2, maxSlices = Infinity, otherLabel } = options;
  const bucketed = Number.isFinite(maxSlices)
    ? bucketSlices(slices, maxSlices, otherLabel)
    : { slices: [...slices], otherIndex: -1 };
  const total = bucketed.slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) return [];

  const pieLayout = pie<DonutSliceInput>()
    .value((d) => Math.max(0, d.value))
    .sort(null)
    .padAngle(padAngle);
  const arcGenerator = arc<{ startAngle: number; endAngle: number; padAngle: number }>()
    .innerRadius(Math.max(0, outerRadius - thickness))
    .outerRadius(outerRadius)
    .cornerRadius(cornerRadius);

  return pieLayout(bucketed.slices).map((piece, i) => {
    const isOther = i === bucketed.otherIndex;
    return {
      label: piece.data.label,
      value: piece.data.value,
      share: Math.max(0, piece.data.value) / total,
      path: arcGenerator(piece) ?? '',
      colorVar: isOther ? 'var(--fg-subtle)' : `var(--viz-${(i % 8) + 1})`,
      isOther,
    };
  });
}
