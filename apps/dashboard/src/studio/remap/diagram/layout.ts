// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auto-layout.
 *
 * ─── Why dagre and not the alternative ─────────────────────────────────────
 *
 * Measured: `elkjs` lays out better and costs 439,626 B gz — seven times
 * the entire diagram library it would serve — and is licensed
 * `EPL-2.0 OR GPL-3.0-or-later`, the only copyleft candidate in the sweep.
 * `@dagrejs/dagre` is 16,838 B gz and MIT. `entitree-flex` is smaller still,
 * appears in React Flow's own documentation, and has **no licence at all**.
 *
 * ─── Manual positions win ──────────────────────────────────────────────────
 *
 * D21 persists positions per CONNECTION, because the diagram is a shared map
 * of the workspace rather than one person's arrangement. So a node the
 * operator has moved keeps its place and auto-layout fills in around it: a
 * layout pass that discarded manual placement would make the feature useless
 * the second time anybody used it.
 */
import dagre from '@dagrejs/dagre';

import type { DiagramGraph } from './graph.js';

export interface Point {
  x: number;
  y: number;
}

/** Node box, in the units xyflow positions with. */
export const NODE_WIDTH = 240;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 22;

export function nodeHeight(columnCount: number, hasHiddenNote: boolean): number {
  return HEADER_HEIGHT + columnCount * ROW_HEIGHT + (hasHiddenNote ? ROW_HEIGHT : 0);
}

export interface LayoutOptions {
  /** Positions the operator moved by hand; these are never recomputed. */
  manual?: Readonly<Record<string, Point>>;
  /** `LR` reads like a schema diagram; `TB` suits deep hierarchies. */
  direction?: 'LR' | 'TB';
}

/**
 * Position every node. Returns a complete map, so a caller never has to decide
 * what an absent position means.
 */
export function layoutGraph(graph: DiagramGraph, options: LayoutOptions = {}): Record<string, Point> {
  const manual = options.manual ?? {};
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: options.direction ?? 'LR',
    // Generous, because these nodes are tall: a schema diagram that overlaps
    // is harder to read than one that needs scrolling.
    nodesep: 48,
    ranksep: 96,
    marginx: 24,
    marginy: 24,
  });

  for (const node of graph.nodes) {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: nodeHeight(node.columns.length, node.hiddenColumns > 0),
    });
  }
  for (const edge of graph.edges) {
    // Self-references are legal and dagre cannot rank them; the edge still
    // renders, it just does not influence placement.
    if (edge.source === edge.target) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions: Record<string, Point> = {};
  for (const node of graph.nodes) {
    const placed = manual[node.id];
    if (placed !== undefined) {
      positions[node.id] = placed;
      continue;
    }
    const laid = g.node(node.id) as { x?: number; y?: number } | undefined;
    // dagre positions by CENTRE; xyflow positions by top-left corner.
    positions[node.id] =
      laid?.x === undefined || laid.y === undefined
        ? { x: 0, y: 0 }
        : {
            x: laid.x - NODE_WIDTH / 2,
            y: laid.y - nodeHeight(node.columns.length, node.hiddenColumns > 0) / 2,
          };
  }
  return positions;
}
