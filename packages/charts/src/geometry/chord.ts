// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure chord geometry (`chart-chord`, research/widget-registry.md §2): nodes on
 * a ring sized by total pairwise volume, connected by quadratic-bezier ribbons
 * whose thickness encodes pair weight. Built from a symmetric flows adjacency
 * matrix. DOM-free + deterministic — the same ribbon paths render in Node and
 * the browser (04 §7.1). Circular layouts step clockwise (LTR) or CCW (RTL) so
 * node order mirrors per §7.4.
 */
import { arc } from 'd3-shape';

const TAU = Math.PI * 2;

export interface ChordNodeInput {
  id: string;
  label: string;
}

export interface ChordArc {
  id: string;
  label: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  /** Total weight incident to this node. */
  total: number;
  path: string;
  colorVar: string;
}

export interface ChordRibbon {
  from: string;
  to: string;
  weight: number;
  path: string;
  colorVar: string;
}

export interface ChordLayout {
  arcs: ChordArc[];
  ribbons: ChordRibbon[];
  radius: number;
  center: { x: number; y: number };
}

export interface ChordOptions {
  size: number;
  /** Arc band thickness in px (default 12). */
  thickness?: number;
  /** Angular padding between node arcs, radians (default 0.04). */
  padAngle?: number;
  rtl?: boolean;
}

function vizColor(index: number): string {
  return `var(--viz-${(index % 8) + 1})`;
}

function pointOnCircle(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  // Angles measured from 12 o'clock, clockwise.
  return { x: cx + Math.sin(angle) * radius, y: cy - Math.cos(angle) * radius };
}

/**
 * Chord layout for `nodes` and a symmetric `weights` matrix
 * (weights[i][j] = volume between node i and node j; the diagonal is ignored).
 * Nodes with zero total weight still receive a minimal arc so the ring stays
 * stable. Returns empty layout for <2 nodes or a non-positive size.
 */
export function chordLayout(
  nodes: readonly ChordNodeInput[],
  weights: readonly (readonly number[])[],
  options: ChordOptions,
): ChordLayout {
  const { size, thickness = 12, padAngle = 0.04, rtl = false } = options;
  const n = nodes.length;
  const radius = Math.max(0, size / 2);
  const center = { x: radius, y: radius };
  if (n < 2 || radius <= 0) return { arcs: [], ribbons: [], radius, center };

  const innerRing = radius - thickness;
  const totals = nodes.map((_, i) => {
    let sum = 0;
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const w = weights[i]?.[j];
      if (Number.isFinite(w) && (w as number) > 0) sum += w as number;
    }
    return sum;
  });

  const grandTotal = totals.reduce((s, v) => s + v, 0);
  const totalPad = padAngle * n;
  const usable = Math.max(0, TAU - totalPad);
  // Equal split fallback when there is no weight at all.
  const share = (value: number): number => (grandTotal > 0 ? (value / grandTotal) * usable : usable / n);

  const arcGen = arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(innerRing)
    .outerRadius(radius);

  const arcs: ChordArc[] = [];
  let angle = 0;
  const direction = rtl ? -1 : 1;
  for (let i = 0; i < n; i += 1) {
    const span = share(totals[i] as number);
    const start = angle + padAngle / 2;
    const end = start + span;
    angle = end + padAngle / 2;
    const node = nodes[i] as ChordNodeInput;
    // d3 arc angles are clockwise from 12 o'clock; apply direction for RTL.
    const a0 = direction === 1 ? start : TAU - end;
    const a1 = direction === 1 ? end : TAU - start;
    arcs.push({
      id: node.id,
      label: node.label,
      startAngle: a0,
      endAngle: a1,
      midAngle: (a0 + a1) / 2,
      total: totals[i] as number,
      path: arcGen({ startAngle: a0, endAngle: a1 }) ?? '',
      colorVar: vizColor(i),
    });
  }

  const byId = new Map(arcs.map((a) => [a.id, a]));
  const ribbons: ChordRibbon[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const w = weights[i]?.[j];
      if (!Number.isFinite(w) || (w as number) <= 0) continue;
      const a = arcs[i] as ChordArc;
      const b = arcs[j] as ChordArc;
      const p1 = pointOnCircle(center.x, center.y, innerRing, a.midAngle);
      const p2 = pointOnCircle(center.x, center.y, innerRing, b.midAngle);
      // Quadratic bezier bowed toward the ring center.
      const path = `M${p1.x.toFixed(3)},${p1.y.toFixed(3)}Q${center.x.toFixed(3)},${center.y.toFixed(
        3,
      )} ${p2.x.toFixed(3)},${p2.y.toFixed(3)}`;
      ribbons.push({ from: (nodes[i] as ChordNodeInput).id, to: (nodes[j] as ChordNodeInput).id, weight: w as number, path, colorVar: (byId.get(a.id) as ChordArc).colorVar });
    }
  }

  return { arcs, ribbons, radius, center };
}

/** Build a symmetric adjacency matrix from flows links keyed by node id. */
export function adjacencyMatrix(
  nodeIds: readonly string[],
  links: readonly { from: string; to: string; weight: number }[],
): number[][] {
  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const matrix = nodeIds.map(() => nodeIds.map(() => 0));
  for (const link of links) {
    const i = index.get(link.from);
    const j = index.get(link.to);
    if (i === undefined || j === undefined || i === j) continue;
    const rowI = matrix[i];
    const rowJ = matrix[j];
    if (rowI === undefined || rowJ === undefined) continue;
    const w = Number.isFinite(link.weight) ? Math.max(0, link.weight) : 0;
    rowI[j] = (rowI[j] ?? 0) + w;
    rowJ[i] = (rowJ[i] ?? 0) + w;
  }
  return matrix;
}
