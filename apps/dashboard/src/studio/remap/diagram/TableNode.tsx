// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One table, as a diagram node — 35-schema-authoring.md §3.7, 35-T20.
 *
 * Token-only styling: no inline `style`, no raw hex (02's enforcement rule).
 * The node draws its own handles because xyflow needs an anchor per side; the
 * rest is ordinary markup, which is what keeps it inside the a11y sweep and
 * the RTL pass rather than being a canvas the tooling cannot see.
 */
import { Handle, Position } from '@xyflow/react';

import { t } from '../../../i18n/t.js';
import type { DiagramNode } from './graph.js';

export interface TableNodeData extends Record<string, unknown> {
  node: DiagramNode;
  selected: boolean;
}

export function TableNode({ data }: { data: TableNodeData }) {
  const { node } = data;
  return (
    <div
      className={[
        'min-w-60 rounded-lg border bg-surface text-body-sm shadow-sm',
        data.selected ? 'border-accent ring-2 ring-accent' : 'border-border',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!bg-fg-muted" />
      <header className="truncate rounded-t-lg border-b border-border bg-surface-2 px-2 py-1.5 font-medium text-fg">
        {node.label}
      </header>
      <ul className="flex flex-col">
        {node.columns.map((column) => (
          <li
            key={column.name}
            className="flex items-center justify-between gap-2 px-2 py-0.5 text-fg-muted"
          >
            <span className="truncate text-fg">
              {column.isPrimaryKey ? (
                <abbr
                  title={t('studio:diagram.node.primaryKey', 'Primary key')}
                  className="me-1 text-accent no-underline"
                >
                  PK
                </abbr>
              ) : null}
              {column.isForeignKey ? (
                <abbr
                  title={t('studio:diagram.node.foreignKey', 'Foreign key')}
                  className="me-1 text-fg-muted no-underline"
                >
                  FK
                </abbr>
              ) : null}
              {column.name}
            </span>
            <span className="shrink-0 font-mono text-caption">{column.type}</span>
          </li>
        ))}
        {node.hiddenColumns > 0 ? (
          <li className="px-2 py-0.5 text-caption text-fg-muted">
            {t('studio:diagram.node.more', '+{count} more', { count: String(node.hiddenColumns) })}
          </li>
        ) : null}
      </ul>
      <Handle type="source" position={Position.Right} className="!bg-fg-muted" />
    </div>
  );
}
