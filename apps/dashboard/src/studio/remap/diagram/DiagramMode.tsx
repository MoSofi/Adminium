// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ER diagram — 35-schema-authoring.md §3.7, D15, D16, D21, 35-T20..T25.
 *
 * ─── Lazily loaded, and that is load-bearing ───────────────────────────────
 *
 * `@xyflow/react` is ~59 KiB gz and **does not tree-shake** — 84 bytes between
 * a minimal and a full import (§8.1). So one static import anywhere reachable
 * from the entry puts the whole library in every user's first load, which is
 * exactly the failure `chunk-budget.json` records for `page-builder` and
 * `ImportWizardPage`. This module is imported through `React.lazy` by its
 * host, and nothing outside this directory imports it.
 *
 * ─── Three kinds of edge, drawn three ways (35-T21) ────────────────────────
 *
 * Declared, inferred and virtual are different claims about the customer's
 * database, and a diagram that draws them identically asserts referential
 * integrity the database may not have. The legend says which is which.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Badge, Button, SearchInput } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { EffectiveModel } from '../model.js';
import { saveDiagramLayout } from './api.js';
import { buildGraph, matchNodes, matchTables, type DiagramEdge, type EdgeKind } from './graph.js';
import { layoutGraph, type Point } from './layout.js';
import { SchemaOutline } from './SchemaOutline.js';
import { TableNode, type TableNodeData } from './TableNode.js';

const nodeTypes = { table: TableNode };

/** 35-T21: the three claims, drawn apart. */
function edgeStyle(kind: EdgeKind): Partial<Edge> {
  switch (kind) {
    case 'declared':
      return { animated: false, className: 'adminium-edge-declared' };
    case 'inferred':
      // Dashed: Adminium's guess, not the database's rule.
      return { animated: false, className: 'adminium-edge-inferred' };
    case 'virtual':
      return { animated: false, className: 'adminium-edge-virtual' };
  }
}

function edgeLabel(edge: DiagramEdge): string {
  if (edge.kind === 'inferred' && edge.confidence !== null) {
    return `${edge.label} · ${Math.round(edge.confidence * 100)}%`;
  }
  return edge.label;
}

export interface DiagramModeProps {
  connectionId: string;
  model: EffectiveModel;
  /** Positions persisted for this connection (D21). */
  savedPositions: Record<string, Point>;
  /** Open a table in Design mode (35-T25). */
  onOpenTable: (tableId: string) => void;
  /** Whether this principal may save a layout (`schema.remap`). */
  canSaveLayout: boolean;
}

export function DiagramMode({
  connectionId,
  model,
  savedPositions,
  onOpenTable,
  canSaveLayout,
}: DiagramModeProps) {
  const [query, setQuery] = useState('');
  const [asList, setAsList] = useState(false);
  const [positions, setPositions] = useState<Record<string, Point>>(savedPositions);
  const [dirty, setDirty] = useState(false);

  /*
   * Search feeds the ceiling, which is what makes its copy true.
   *
   * `buildGraph(model)` was called with no options, so `focus` — the whole
   * mechanism for keeping a named table when the ceiling engages — was never
   * passed anything. And `matchNodes` searches the BUILT graph, which is the
   * ceilinged one, so on a large schema it could only ever find what was
   * already on screen. The line under the toolbar says "140 more are hidden —
   * search to bring one in"; typing one of those 140 names did nothing at all.
   * Found on a generated 200-table connection.
   *
   * `matchTables` searches the whole model, and its hits become `focus`, which
   * `buildGraph` ranks ahead of the hubs. `matchNodes` still drives the
   * HIGHLIGHT, and now finds the node that was just brought in.
   */
  const focus = useMemo(() => matchTables(model, query), [model, query]);

  const graph = useMemo(() => buildGraph(model, { focus }), [model, focus]);
  const matches = useMemo(() => new Set(matchNodes(graph, query)), [graph, query]);

  const laid = useMemo(
    () => layoutGraph(graph, { manual: positions }),
    [graph, positions],
  );

  const nodes: Node<TableNodeData>[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'table',
        position: laid[node.id] ?? { x: 0, y: 0 },
        data: { node, selected: matches.has(node.id) },
        /*
         * The node's accessible NAME.
         *
         * React Flow gives every node `role="group"`,
         * `aria-roledescription="node"` and a generic `aria-describedby`, and no
         * name at all — so a keyboard user tabbing the canvas hears "node,
         * group" sixty times and has to enter each group to learn which table
         * they are standing on. Its EDGES get "Edge from x to y" for free;
         * nodes get nothing. Measured on a 200-table connection: 60 tabbable
         * nodes, none of them named.
         *
         * Naming the columns too, because the column list is the reason to stop
         * on a node, and a screen-reader user cannot see it at a glance.
         */
        ariaLabel: `${node.label} (${node.name}), ${String(node.columns.length)} column${
          node.columns.length === 1 ? '' : 's'
        }${node.hiddenColumns > 0 ? ` and ${String(node.hiddenColumns)} more hidden` : ''}`,
      })),
    [graph.nodes, laid, matches],
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edgeLabel(edge),
        ...edgeStyle(edge.kind),
      })),
    [graph.edges],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let moved = false;
    setPositions((prev) => {
      const next = { ...prev };
      for (const change of changes) {
        if (change.type === 'position' && change.position !== undefined) {
          next[change.id] = change.position;
          moved = true;
        }
      }
      return moved ? next : prev;
    });
    if (moved) setDirty(true);
  }, []);

  useEffect(() => {
    setPositions(savedPositions);
    setDirty(false);
  }, [savedPositions]);

  const handleSave = async (): Promise<void> => {
    await saveDiagramLayout(connectionId, positions);
    setDirty(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('studio:diagram.search', 'Find a table or column')}
          aria-label={t('studio:diagram.search', 'Find a table or column')}
        />
        <Button variant="ghost" onClick={() => setAsList((value) => !value)}>
          {asList
            ? t('studio:diagram.showDiagram', 'Show diagram')
            : t('studio:diagram.showList', 'Show as list')}
        </Button>
        {canSaveLayout && dirty ? (
          <Button onClick={() => void handleSave()}>
            {t('studio:diagram.saveLayout', 'Save layout')}
          </Button>
        ) : null}

        <span className="ms-auto flex flex-wrap items-center gap-2" aria-label={t('studio:diagram.legendLabel', 'Legend')}>
          <Badge tone="neutral">{t('studio:diagram.legend.declared', 'Foreign key')}</Badge>
          <Badge tone="info">{t('studio:diagram.legend.inferred', 'Inferred')}</Badge>
          <Badge tone="accent">{t('studio:diagram.legend.virtual', 'Added in Adminium')}</Badge>
        </span>
      </div>

      {graph.omittedTables > 0 ? (
        <p className="text-body-sm text-fg-muted" role="status">
          {t(
            'studio:diagram.ceiling',
            'Showing the {shown} most connected tables. {omitted} more are hidden — search to bring one in.',
            { shown: String(graph.nodes.length), omitted: String(graph.omittedTables) },
          )}
        </p>
      ) : null}

      {asList ? (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface p-3">
          <SchemaOutline graph={graph} onOpenTable={onOpenTable} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 rounded-lg border border-border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDoubleClick={(_event, node) => onOpenTable(node.id)}
            nodesFocusable
            edgesFocusable
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background />
            <Controls />
            {graph.nodes.length > 20 ? <MiniMap pannable zoomable /> : null}
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
