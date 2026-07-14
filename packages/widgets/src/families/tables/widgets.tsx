import { z } from 'zod';

import { BulkActionToolbar } from './BulkActionToolbar.js';
import { DataGrid } from './DataGrid.js';
import { DetailKeyValue } from './DetailKeyValue.js';
import { MiniTable } from './MiniTable.js';
import { PaginationFooter } from './PaginationFooter.js';
import { gridColumnSpecSchema } from './column-spec.js';
import type { GridColumnSpec, GridRow } from './column-spec.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * Registry-facing widget components for the `tables` family — thin adapters
 * binding `WidgetProps` (config + data + onEvent) onto the standalone
 * components, which the `page-crud` template also composes directly with
 * richer host wiring. One module so Vite emits a single family chunk
 * (04 §2.3); `definitions.ts` lazy-imports it per widget.
 */

// --- config schemas (exported for definitions.ts) ---------------------------

export const dataGridConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.array(gridColumnSpecSchema).default([]),
  sortable: z.boolean().default(true),
  selectable: z.boolean().default(false),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  rowAction: z.enum(['detail', 'link', 'none']).default('detail'),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export type DataGridConfig = z.infer<typeof dataGridConfigSchema>;

export const paginationFooterConfigSchema = widgetSharedConfigSchema.extend({
  pageSize: z.number().int().min(1).max(200).default(50),
  style: z.enum(['numbered', 'cursor']).default('cursor'),
});
export type PaginationFooterConfig = z.infer<typeof paginationFooterConfigSchema>;

export const bulkActionToolbarConfigSchema = widgetSharedConfigSchema.extend({
  actions: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        danger: z.boolean().optional(),
        permission: z.string().optional(),
      }),
    )
    .default([]),
});
export type BulkActionToolbarConfig = z.infer<typeof bulkActionToolbarConfigSchema>;

export const detailKeyValueConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.array(gridColumnSpecSchema).default([]),
  showTypeTags: z.boolean().default(false),
});
export type DetailKeyValueConfig = z.infer<typeof detailKeyValueConfigSchema>;

export const miniTableConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.array(gridColumnSpecSchema).default([]),
  limit: z.number().int().min(1).max(6).default(5),
  viewAllHref: z.string().optional(),
});
export type MiniTableConfig = z.infer<typeof miniTableConfigSchema>;

// --- data narrowing ---------------------------------------------------------

/** Rows from a `record-list` payload (CRUD list envelope or bare array). */
function rowsOf(data: unknown): GridRow[] {
  if (Array.isArray(data)) return data as GridRow[];
  if (typeof data === 'object' && data !== null && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: GridRow[] }).data;
  }
  return [];
}

/**
 * Column specs: instance config wins; demo payloads embed their own
 * `columns` so palette/storybook rendering works with default config.
 */
function columnsOf(config: { columns: GridColumnSpec[] }, data: unknown): readonly GridColumnSpec[] {
  if (config.columns.length > 0) return config.columns;
  if (typeof data === 'object' && data !== null && Array.isArray((data as { columns?: unknown }).columns)) {
    return (data as { columns: GridColumnSpec[] }).columns;
  }
  return [];
}

function recordOf(data: unknown): GridRow {
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { data?: unknown };
    if (typeof envelope.data === 'object' && envelope.data !== null && !Array.isArray(envelope.data)) {
      return envelope.data as GridRow;
    }
    if (!Array.isArray(data)) return data as GridRow;
  }
  return {};
}

function formatContext(config: { format?: { locale?: string | undefined; currency?: string | undefined } | undefined }) {
  return { locale: config.format?.locale, currency: config.format?.currency };
}

/** Qualified table name from a shared-config binding (query descriptor §5.1). */
function bindingTable(config: {
  binding?: { connectionId: string; source: { schema?: string | undefined; name: string } } | undefined;
}): { table: string; connectionId: string } | undefined {
  const binding = config.binding;
  if (binding === undefined) return undefined;
  const { schema, name } = binding.source;
  return { table: schema === undefined ? name : `${schema}.${name}`, connectionId: binding.connectionId };
}

// --- widget components -------------------------------------------------------

export function DataGridWidget({ config, data, onEvent }: WidgetProps<DataGridConfig>) {
  const columns: readonly GridColumnSpec[] = columnsOf(config, data);
  const source = bindingTable(config);
  return (
    <DataGrid
      columns={columns}
      rows={rowsOf(data)}
      selectable={config.selectable}
      density={config.density}
      cellContext={{ onEvent, connectionId: source?.connectionId, ...formatContext(config) }}
      {...(config.rowAction === 'none'
        ? {}
        : {
            onRowOpen: (row: GridRow) => {
              if (config.rowAction === 'link' && config.href !== undefined) {
                onEvent({ type: 'drill-through', href: config.href });
                return;
              }
              const pk = columns.find((column) => column.primaryKey);
              if (pk !== undefined && source !== undefined) {
                onEvent({
                  type: 'record-open',
                  connectionId: source.connectionId,
                  table: source.table,
                  recordId: row[pk.name] as string | number,
                });
              }
            },
          })}
    />
  );
}

export function PaginationFooterWidget({ config, data }: WidgetProps<PaginationFooterConfig>) {
  const rows = rowsOf(data);
  const page = (typeof data === 'object' && data !== null
    ? (data as { page?: { limit: number; offset: number; total: number | null } }).page
    : undefined) ?? { limit: config.pageSize, offset: 0, total: null };
  return (
    <PaginationFooter
      rangeStart={rows.length === 0 ? 0 : page.offset + 1}
      rangeEnd={page.offset + rows.length}
      total={page.total}
      hasPrev={page.offset > 0}
      hasNext={page.total !== null && page.offset + rows.length < page.total}
      onPrev={() => {}}
      onNext={() => {}}
      pageSize={config.pageSize}
      onPageSizeChange={() => {}}
    />
  );
}

export function BulkActionToolbarWidget({ config, data, onEvent }: WidgetProps<BulkActionToolbarConfig>) {
  const selectedIds = Array.isArray(data) ? (data as unknown[]).map(String) : [];
  const source = bindingTable(config);
  return (
    <BulkActionToolbar
      selectedIds={selectedIds}
      actions={config.actions}
      onAction={(key, ids) => {
        if (key === 'delete' && source !== undefined) {
          for (const id of ids) {
            onEvent({
              type: 'mutate',
              intent: 'delete',
              connectionId: source.connectionId,
              table: source.table,
              recordId: id,
            });
          }
        }
      }}
      onClear={() => {}}
    />
  );
}

export function DetailKeyValueWidget({ config, data, onEvent }: WidgetProps<DetailKeyValueConfig>) {
  return (
    <DetailKeyValue
      columns={columnsOf(config, data)}
      record={recordOf(data)}
      showTypeTags={config.showTypeTags}
      cellContext={{ onEvent, ...formatContext(config) }}
    />
  );
}

export function MiniTableWidget({ config, data, onEvent }: WidgetProps<MiniTableConfig>) {
  const columns: readonly GridColumnSpec[] = columnsOf(config, data);
  const source = bindingTable(config);
  return (
    <MiniTable
      columns={columns}
      rows={rowsOf(data)}
      limit={config.limit}
      onEvent={onEvent}
      cellContext={{ onEvent, connectionId: source?.connectionId, ...formatContext(config) }}
      {...(config.viewAllHref !== undefined ? { viewAllHref: config.viewAllHref } : {})}
      {...(source === undefined
        ? {}
        : {
            onRowOpen: (row: GridRow) => {
              const pk = columns.find((column) => column.primaryKey);
              if (pk !== undefined) {
                onEvent({
                  type: 'record-open',
                  connectionId: source.connectionId,
                  table: source.table,
                  recordId: row[pk.name] as string | number,
                });
              }
            },
          })}
    />
  );
}
