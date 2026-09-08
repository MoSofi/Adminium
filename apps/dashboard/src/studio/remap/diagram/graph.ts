// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The IR → graph mapping — 35-schema-authoring.md §3.7, D16, 35-T20/T21/T23.
 *
 * Pure: model in, nodes and edges out. No React, no xyflow, no layout. That is
 * what lets the semantics below — which edge is declared, which is a guess,
 * which is ours; which node is over the column threshold — be tested without
 * mounting a canvas, and it is also what makes the text-equivalent view (D16)
 * a rendering of the same data rather than a second derivation of it.
 */
import type { EffectiveModel, EffectiveRelation, EffectiveTable } from '../model.js';

/**
 * The three kinds of edge the diagram distinguishes, and the reason it must.
 *
 * A DECLARED foreign key is a row in the customer's catalog: the database
 * enforces it. An INFERRED relation is Adminium's guess from a name or a join
 * table, carrying a confidence. A VIRTUAL one is an override an operator
 * accepted or added by hand — real to Adminium, invisible to every other tool
 * pointed at the same database.
 *
 * Drawing all three the same way would tell an operator their schema has
 * referential integrity it does not have.
 */
export type EdgeKind = 'declared' | 'inferred' | 'virtual';

export interface DiagramColumn {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  nullable: boolean;
}

export interface DiagramNode {
  id: string;
  label: string;
  /** The table's own name, when the label is an override. */
  name: string;
  columns: DiagramColumn[];
  /** Columns beyond the collapse threshold, hidden but counted. */
  hiddenColumns: number;
  keyField: string | null;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** `<1` for inferred; null for declared and virtual. */
  confidence: number | null;
  label: string;
  sourceColumns: string[];
  targetColumns: string[];
}

export interface DiagramGraph {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Tables omitted because the model exceeds {@link DiagramOptions.nodeCeiling}. */
  omittedTables: number;
}

export interface DiagramOptions {
  /**
   * Columns shown per node before the rest collapse into a count. A 60-column
   * table drawn in full is a wall of text nobody reads and a node taller than
   * the viewport.
   */
  columnLimit?: number;
  /**
   * Above this many tables the diagram renders a filtered view rather than the
   * whole schema (D16). 400 unreadable boxes is not a picture of anything.
   *
   * This used to add "and the browser pays for every one", which the 200-table
   * measurement disproved: laying out all 200 costs 35 ms against 18 ms for 60
   * — less than double the time for more than triple the nodes — and the graph
   * build is 0.3 ms. **The ceiling is a readability decision, not a performance
   * one.** Left uncorrected, a reader who measures this and finds the cost
   * argument false has reason to distrust the readability one too.
   */
  nodeCeiling?: number;
  /** When the ceiling engages, keep the tables these names name. */
  focus?: readonly string[];
}

export const DEFAULT_COLUMN_LIMIT = 8;
export const DEFAULT_NODE_CEILING = 60;

function edgeKindOf(relation: EffectiveRelation): EdgeKind {
  if (relation.kind === 'declared-fk') return 'declared';
  if (relation.kind === 'override' || relation.kind === 'manifest') return 'virtual';
  return 'inferred';
}

/**
 * Build the graph.
 *
 * Reads the EFFECTIVE model (overrides applied), so a table an operator
 * relabelled shows its label and a relation they accepted shows as theirs —
 * the diagram is a picture of the schema Adminium works with, which is the one
 * the pages are generated from.
 */
export function buildGraph(model: EffectiveModel, options: DiagramOptions = {}): DiagramGraph {
  const columnLimit = options.columnLimit ?? DEFAULT_COLUMN_LIMIT;
  const nodeCeiling = options.nodeCeiling ?? DEFAULT_NODE_CEILING;

  // Excluded tables are not part of the app, so they are not part of its map.
  const visible = model.tables.filter((table) => table.excluded !== true);

  const focus = new Set(options.focus ?? []);
  let kept: EffectiveTable[] = visible;
  let omitted = 0;
  if (visible.length > nodeCeiling) {
    // Keep what the operator asked for, then fill to the ceiling by
    // connectedness: an isolated lookup table is the least useful thing on a
    // crowded map, and a hub is the most.
    const degree = new Map<string, number>();
    for (const relation of model.relations) {
      degree.set(relation.from.tableId, (degree.get(relation.from.tableId) ?? 0) + 1);
      degree.set(relation.to.tableId, (degree.get(relation.to.tableId) ?? 0) + 1);
    }
    const ranked = [...visible].sort((a, b) => {
      const focused = Number(focus.has(b.id)) - Number(focus.has(a.id));
      if (focused !== 0) return focused;
      return (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    });
    kept = ranked.slice(0, nodeCeiling);
    omitted = visible.length - kept.length;
  }

  const keptIds = new Set(kept.map((table) => table.id));

  const nodes: DiagramNode[] = kept.map((table) => {
    const fkColumns = new Set(
      model.relations
        .filter((relation) => relation.from.tableId === table.id)
        .flatMap((relation) => relation.from.columns),
    );
    const columns = table.columns.map((column) => ({
      name: column.label ?? column.name,
      type: column.logicalType,
      isPrimaryKey: column.isPrimaryKey,
      isForeignKey: fkColumns.has(column.name),
      nullable: column.nullable,
    }));
    // Keys and foreign keys are what a reader traces edges through, so they
    // survive the collapse even when they sit past the threshold.
    const important = columns.filter((c) => c.isPrimaryKey || c.isForeignKey);
    const rest = columns.filter((c) => !c.isPrimaryKey && !c.isForeignKey);
    const shown = [...important, ...rest].slice(0, Math.max(columnLimit, important.length));
    return {
      id: table.id,
      label: table.label ?? table.name,
      name: table.name,
      columns: shown,
      hiddenColumns: Math.max(0, columns.length - shown.length),
      keyField: table.keyField ?? null,
    };
  });

  const edges: DiagramEdge[] = model.relations
    .filter((relation) => keptIds.has(relation.from.tableId) && keptIds.has(relation.to.tableId))
    .map((relation) => {
      const kind = edgeKindOf(relation);
      return {
        id: relation.id,
        source: relation.from.tableId,
        target: relation.to.tableId,
        kind,
        confidence: kind === 'inferred' ? relation.confidence : null,
        label: relation.from.columns.join(', '),
        sourceColumns: [...relation.from.columns],
        targetColumns: [...relation.to.columns],
      };
    });

  return { nodes, edges, omittedTables: omitted };
}

/** Tables whose name or label matches — the search-to-focus predicate. */
/**
 * Tables in the WHOLE model matching `query` — including ones the ceiling hid.
 *
 * `matchNodes` searches the built graph, which is the ceilinged one, so on a
 * large schema it can only ever find what is already on screen. The ceiling's
 * own copy says *"search to bring one in"*, and with only that matcher the
 * product could not: typing the name of one of the 140 hidden tables changed
 * nothing at all. Verified on a generated 200-table connection.
 *
 * Feeding these ids back as {@link DiagramOptions.focus} is what makes the
 * sentence true — `buildGraph` ranks focused tables ahead of the hubs, so a
 * searched-for table survives the cut.
 */
export function matchTables(model: EffectiveModel, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return model.tables
    .filter((table) => table.excluded !== true)
    .filter(
      (table) =>
        table.name.toLowerCase().includes(needle) ||
        (table.label ?? '').toLowerCase().includes(needle) ||
        table.columns.some((column) =>
          (column.label ?? column.name).toLowerCase().includes(needle) ||
          column.name.toLowerCase().includes(needle),
        ),
    )
    .map((table) => table.id);
}

export function matchNodes(graph: DiagramGraph, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return graph.nodes
    .filter(
      (node) =>
        node.name.toLowerCase().includes(needle) ||
        node.label.toLowerCase().includes(needle) ||
        node.columns.some((column) => column.name.toLowerCase().includes(needle)),
    )
    .map((node) => node.id);
}
