/**
 * Pure sunburst geometry (`chart-sunburst`, research/widget-registry.md §2): two
 * nested rings from a 2-level hierarchy — inner ring = parents (angle ∝ subtree
 * total), outer ring = children (angle ∝ child value within the parent span).
 * Arcs sweep clockwise from 12 o'clock and do NOT mirror in RTL (rotation is
 * direction-neutral, §7.4). DOM-free + deterministic (04 §7.1).
 */
import { arc } from 'd3-shape';

const TAU = Math.PI * 2;

export interface SunburstChildInput {
  label: string;
  value: number;
}

export interface SunburstParentInput {
  label: string;
  children: readonly SunburstChildInput[];
}

export interface SunburstArc {
  label: string;
  parentLabel?: string;
  value: number;
  /** Fraction of the grand total, 0..1. */
  share: number;
  depth: 0 | 1;
  startAngle: number;
  endAngle: number;
  path: string;
  colorVar: string;
}

export interface SunburstLayout {
  arcs: SunburstArc[];
  total: number;
}

export interface SunburstOptions {
  size: number;
  /** Ring thickness in px (default derived from size). */
  ringThickness?: number;
  /** Radius of the empty center hole (default 0). */
  innerRadius?: number;
}

function vizColor(index: number): string {
  return `var(--viz-${(index % 8) + 1})`;
}

/** Blend a parent color toward the surface for its children (lighter band). */
function childColor(index: number): string {
  return `color-mix(in srgb, var(--viz-${(index % 8) + 1}) 62%, var(--surface))`;
}

/**
 * Two-ring sunburst arcs (parents then their children, in input order). Empty
 * parents (no positive children) are skipped; a non-positive total yields [].
 */
export function sunburstArcs(parents: readonly SunburstParentInput[], options: SunburstOptions): SunburstLayout {
  const { size } = options;
  const outer = Math.max(0, size / 2);
  const innerHole = options.innerRadius ?? 0;
  const band = options.ringThickness ?? (outer - innerHole) / 2;
  if (outer <= 0) return { arcs: [], total: 0 };

  const normalized = parents.map((p, i) => {
    const children = p.children
      .map((c) => ({ label: c.label, value: Number.isFinite(c.value) ? Math.max(0, c.value) : 0 }))
      .filter((c) => c.value > 0);
    const total = children.reduce((s, c) => s + c.value, 0);
    return { label: p.label, index: i, children, total };
  });

  const grandTotal = normalized.reduce((s, p) => s + p.total, 0);
  if (grandTotal <= 0) return { arcs: [], total: 0 };

  const innerArc = arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(innerHole)
    .outerRadius(innerHole + band);
  const outerArc = arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(innerHole + band)
    .outerRadius(outer);

  const arcs: SunburstArc[] = [];
  let angle = 0;
  for (const parent of normalized) {
    if (parent.total <= 0) continue;
    const parentSpan = (parent.total / grandTotal) * TAU;
    const parentStart = angle;
    const parentEnd = angle + parentSpan;
    arcs.push({
      label: parent.label,
      value: parent.total,
      share: parent.total / grandTotal,
      depth: 0,
      startAngle: parentStart,
      endAngle: parentEnd,
      path: innerArc({ startAngle: parentStart, endAngle: parentEnd }) ?? '',
      colorVar: vizColor(parent.index),
    });

    let childAngle = parentStart;
    for (const child of parent.children) {
      const childSpan = (child.value / grandTotal) * TAU;
      const cStart = childAngle;
      const cEnd = childAngle + childSpan;
      childAngle = cEnd;
      arcs.push({
        label: child.label,
        parentLabel: parent.label,
        value: child.value,
        share: child.value / grandTotal,
        depth: 1,
        startAngle: cStart,
        endAngle: cEnd,
        path: outerArc({ startAngle: cStart, endAngle: cEnd }) ?? '',
        colorVar: childColor(parent.index),
      });
    }
    angle = parentEnd;
  }

  return { arcs, total: grandTotal };
}
