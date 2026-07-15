import { getFormatters } from '@adminium/i18n';
import { EmptyState, Tag } from '@adminium/ui';
import { ChevronRight, Columns3, Database, Eye, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';

import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `schema-tree` (annex §3) — an introspected hierarchy explorer:
 * schema → tables (row counts, view badge) → columns with PK/FK/UQ badges and
 * pg types. Binds to the `hierarchy/tree` shape from introspection metadata.
 */

export const schemaTreeConfigSchema = widgetSharedConfigSchema.extend({
  expandDepth: z.number().int().min(0).max(4).default(1),
  showTypes: z.boolean().default(true),
  emptyTitle: z.string().optional(),
});
export type SchemaTreeConfig = z.infer<typeof schemaTreeConfigSchema>;

export type SchemaNodeKind = 'schema' | 'table' | 'view' | 'column';

export interface SchemaNode {
  id: string;
  kind: SchemaNodeKind;
  label: string;
  children?: SchemaNode[] | undefined;
  rowCount?: number | undefined;
  pgType?: string | undefined;
  pk?: boolean | undefined;
  fk?: boolean | undefined;
  unique?: boolean | undefined;
  nullable?: boolean | undefined;
}

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

const TABLES = [
  { name: 'customers', rows: 8402, cols: [['id', 'int8', { pk: true }], ['email', 'varchar', { unique: true }], ['owner_id', 'int8', { fk: true }], ['created_at', 'timestamptz', {}]] },
  { name: 'orders', rows: 51230, cols: [['id', 'int8', { pk: true }], ['customer_id', 'int8', { fk: true }], ['total', 'numeric', {}], ['status', 'text', {}]] },
  { name: 'invoices', rows: 12904, cols: [['id', 'uuid', { pk: true }], ['order_id', 'int8', { fk: true }], ['amount', 'numeric', {}]] },
] as const;
const VIEWS = [{ name: 'active_customers', rows: 6120, cols: [['id', 'int8', {}], ['email', 'varchar', {}]] }] as const;

/** Deterministic `hierarchy/tree` introspection payload — schema is fixed, so seed-independent (04 §7.7). */
export function schemaTreeDemoData(seed: number): { roots: SchemaNode[] } {
  void seed;
  const tableNodes: SchemaNode[] = TABLES.map((table) => ({
    id: `public.${table.name}`,
    kind: 'table',
    label: table.name,
    rowCount: table.rows,
    children: table.cols.map(([name, type, flags]) => ({
      id: `public.${table.name}.${name as string}`,
      kind: 'column',
      label: name as string,
      pgType: type as string,
      ...(flags as { pk?: boolean; fk?: boolean; unique?: boolean }),
    })),
  }));
  const viewNodes: SchemaNode[] = VIEWS.map((view) => ({
    id: `public.${view.name}`,
    kind: 'view',
    label: view.name,
    rowCount: view.rows,
    children: view.cols.map(([name, type]) => ({
      id: `public.${view.name}.${name as string}`,
      kind: 'column',
      label: name as string,
      pgType: type as string,
    })),
  }));
  return {
    roots: [
      {
        id: 'public',
        kind: 'schema',
        label: 'public',
        children: [...tableNodes, ...viewNodes],
      },
    ],
  };
}
