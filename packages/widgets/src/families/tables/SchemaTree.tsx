import { getFormatters } from '@adminium/i18n';
import { EmptyState, Tag } from '@adminium/ui';
import { ChevronRight, Columns3, Database, Eye, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SchemaTreeConfig } from './tables-track-f-config.js';
import type { SchemaNode, SchemaNodeKind } from './tables-track-f-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `schema-tree` (annex §3) — an introspected hierarchy explorer:
 * schema → tables (row counts, view badge) → columns with PK/FK/UQ badges and
 * pg types. Binds to the `hierarchy/tree` shape from introspection metadata.
 */

// Config schema + deterministic demo payload live in the pure
// `tables-track-f-config` module, and the node shape in
// `tables-track-f-types`, so the registry metadata graph never reaches this
// component file (04 §2.3). Re-exported here to keep existing import points
// stable.
export { schemaTreeConfigSchema, schemaTreeDemoData } from './tables-track-f-config.js';
export type { SchemaTreeConfig } from './tables-track-f-config.js';
export type { SchemaNode, SchemaNodeKind } from './tables-track-f-types.js';

const KIND_ICON: Record<SchemaNodeKind, ReactNode> = {
  schema: <Database className="size-3.5 text-fg-subtle" />,
  table: <Table2 className="size-3.5 text-accent" />,
  view: <Eye className="size-3.5 text-info" />,
  column: <Columns3 className="size-3.5 text-fg-subtle" />,
};

function collectOpen(nodes: readonly SchemaNode[], depth: number, maxDepth: number, acc: Set<string>): void {
  if (depth > maxDepth) return;
  for (const node of nodes) {
    if (node.children !== undefined && node.children.length > 0) {
      acc.add(node.id);
      collectOpen(node.children, depth + 1, maxDepth, acc);
    }
  }
}

export interface SchemaTreeProps {
  roots: readonly SchemaNode[];
  expandDepth?: number | undefined;
  showTypes?: boolean | undefined;
  emptyTitle?: string | undefined;
  locale?: string | undefined;
  onSelect?: ((node: SchemaNode) => void) | undefined;
  testId?: string | undefined;
}

export function SchemaTree({
  roots,
  expandDepth = 1,
  showTypes = true,
  emptyTitle,
  locale,
  onSelect,
  testId,
}: SchemaTreeProps) {
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    collectOpen(roots, 0, expandDepth, set);
    return set;
  }, [roots, expandDepth]);
  const [open, setOpen] = useState<ReadonlySet<string>>(initialOpen);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const numbers = getFormatters(locale ?? 'en-US');

  if (roots.length === 0) {
    return <EmptyState compact preset="no-data" title={emptyTitle ?? 'No schema introspected'} />;
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (node: SchemaNode, depth: number): ReactNode => {
    const hasChildren = node.children !== undefined && node.children.length > 0;
    const isOpen = open.has(node.id);
    const isSelected = selected === node.id;
    return (
      <li key={node.id} role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isSelected}>
        <div
          tabIndex={0}
          data-selected={isSelected}
          onClick={() => {
            setSelected(node.id);
            onSelect?.(node);
            if (hasChildren) toggle(node.id);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelected(node.id);
              onSelect?.(node);
              if (hasChildren) toggle(node.id);
            }
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-md py-1 pe-2 text-body-sm data-[selected=true]:bg-accent-soft/60 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ps-[calc(var(--adm-depth)*0.75rem+0.25rem)]"
          style={{ '--adm-depth': String(depth) }}
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3 shrink-0 rtl:-scale-x-100 ${hasChildren ? 'text-fg-subtle' : 'invisible'} ${isOpen ? 'rotate-90 rtl:-rotate-90' : ''}`}
          />
          {KIND_ICON[node.kind]}
          <span className={`truncate ${node.kind === 'column' ? 'text-fg-muted' : 'font-medium text-fg'}`}>{node.label}</span>
          {node.pk === true && <Tag tone="accent" mono>PK</Tag>}
          {node.fk === true && <Tag tone="info" mono>FK</Tag>}
          {node.unique === true && <Tag tone="neutral" mono>UQ</Tag>}
          {node.kind === 'view' && <Tag tone="info">view</Tag>}
          {showTypes && node.pgType !== undefined && <Tag tone="neutral" mono className="ms-auto">{node.pgType}</Tag>}
          {node.rowCount !== undefined && (
            <span className="ms-auto font-mono text-caption tabular-nums text-fg-subtle">{numbers.number(node.rowCount)}</span>
          )}
        </div>
        {hasChildren && isOpen && (
          <ul role="group">{node.children?.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <ul role="tree" aria-label="Schema" data-widget="schema-tree" data-testid={testId} className="h-full overflow-auto px-1.5 py-1.5">
      {roots.map((node) => renderNode(node, 0))}
    </ul>
  );
}

function rootsOf(data: unknown): SchemaNode[] {
  if (typeof data === 'object' && data !== null && Array.isArray((data as { roots?: unknown }).roots)) {
    return (data as { roots: SchemaNode[] }).roots;
  }
  if (Array.isArray(data)) return data as SchemaNode[];
  return [];
}

export function SchemaTreeWidget({ config, data, onEvent }: WidgetProps<SchemaTreeConfig>) {
  return (
    <SchemaTree
      roots={rootsOf(data)}
      expandDepth={config.expandDepth}
      showTypes={config.showTypes}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      onSelect={(node) => {
        if (node.kind === 'table' || node.kind === 'view') {
          onEvent({ type: 'drill-through', href: `#/schema/${node.id}` });
        }
      }}
    />
  );
}
