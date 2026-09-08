// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text equivalent — 35-schema-authoring.md D16, 35-T24.
 *
 * ─── Why this is a real view and not `aria-hidden` on the canvas ───────────
 *
 * A pan-and-zoom canvas is invisible to a screen reader and unusable at 320 px.
 * The cheap way to make an a11y sweep pass is to hide it, which trades a
 * violation for a feature nobody can reach. This renders the SAME graph — the
 * same nodes, the same edges, from the same `buildGraph` output — as a
 * navigable list in DOM order, so the diagram's information is available
 * without the diagram.
 *
 * It is also the honest answer to what the page does on a phone.
 */
import { t } from '../../../i18n/t.js';
import type { DiagramGraph } from './graph.js';

export interface SchemaOutlineProps {
  graph: DiagramGraph;
  onOpenTable: (tableId: string) => void;
}

export function SchemaOutline({ graph, onOpenTable }: SchemaOutlineProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-fg-muted">
        {t(
          'studio:diagram.outline.intro',
          '{tables} tables and {relations} relations, as a list.',
          { tables: String(graph.nodes.length), relations: String(graph.edges.length) },
        )}
      </p>
      <ul className="flex flex-col gap-2">
        {graph.nodes.map((node) => {
          const outgoing = graph.edges.filter((edge) => edge.source === node.id);
          const incoming = graph.edges.filter((edge) => edge.target === node.id);
          return (
            <li key={node.id} className="rounded-lg border border-border bg-surface p-3">
              <h4 className="text-body font-medium text-fg">
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => onOpenTable(node.id)}
                >
                  {node.label}
                </button>
              </h4>
              <p className="text-body-sm text-fg-muted">
                {node.columns.map((column) => column.name).join(', ')}
                {node.hiddenColumns > 0
                  ? t('studio:diagram.outline.more', ' and {count} more', {
                      count: String(node.hiddenColumns),
                    })
                  : ''}
              </p>
              {outgoing.length > 0 ? (
                <p className="mt-1 text-body-sm text-fg">
                  {t('studio:diagram.outline.references', 'References: {list}', {
                    list: outgoing.map((edge) => edge.target).join(', '),
                  })}
                </p>
              ) : null}
              {incoming.length > 0 ? (
                <p className="text-body-sm text-fg">
                  {t('studio:diagram.outline.referencedBy', 'Referenced by: {list}', {
                    list: incoming.map((edge) => edge.source).join(', '),
                  })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
