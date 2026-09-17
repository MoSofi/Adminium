// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI kit's data pieces: `DataTable` and `Stat`. `DataTable` is the
 * dashboard's own grid, so a project table sorts, aligns and formats values
 * the way generated pages do; a column's `render` goes through the grid's
 * host-drawn cells (`CustomCellProvider`).
 */

import { createElement, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Card as UiCard, DeltaPill, EmptyState as UiEmptyState, IconTile, Skeleton } from '@adminium/ui';
import {
  CustomCellProvider,
  DataGrid,
  gridColumnSpecSchema,
  type CustomCellRenderer,
  type GridColumnSpec,
  type GridRow,
} from '@adminium/widgets';
import type { AnyRecord, DataTableColumn, DataTableProps, StatProps } from '@adminium/server/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';
import { InProjectCardContext } from './surface.js';

/** A kit column as the grid's column spec. */
export function toColumnSpec(column: DataTableColumn): GridColumnSpec {
  const type = column.type ?? 'text';
  const numeric = type === 'number' || type === 'money' || type === 'percent';
  return gridColumnSpecSchema.parse({
    name: column.key,
    label: column.label,
    logicalType:
      type === 'number' || type === 'money' || type === 'percent'
        ? 'decimal'
        : type === 'datetime'
          ? 'timestamptz'
          : type === 'date' || type === 'boolean'
            ? type
            : 'text',
    ...(type === 'money' ? { semantic: 'money' } : {}),
    ...(type === 'percent' ? { display: { kind: 'percent', percentScale: 'unit' } } : {}),
    ...(column.currency === undefined ? {} : { currency: column.currency }),
    ...(column.align !== undefined ? { align: column.align } : numeric ? { align: 'end' } : {}),
    sortable: column.sortable ?? true,
  });
}

export function DataTable<R extends AnyRecord = AnyRecord>({
  columns,
  rows,
  rowKey = 'id',
  onRowClick,
  loading = false,
  empty,
  density = 'comfortable',
}: DataTableProps<R>): ReactNode {
  const specs = useMemo(() => columns.map((column) => toColumnSpec(column as DataTableColumn)), [columns]);
  const renderers = useMemo(() => {
    const out = new Map<string, (record: R) => ReactNode>();
    for (const column of columns) if (column.render !== undefined) out.set(column.key, column.render);
    return out;
  }, [columns]);
  const renderCell = useCallback<CustomCellRenderer>(
    (column, row) => {
      const render = renderers.get(column.name);
      // `undefined` would mean "draw it as usual" to the grid.
      return render === undefined ? undefined : (render(row as R) ?? null);
    },
    [renderers],
  );
  const rowId = useCallback(
    (row: GridRow): string => {
      if (typeof rowKey === 'function') return rowKey(row as R);
      const value = row[rowKey];
      return value === undefined || value === null ? JSON.stringify(row) : String(value);
    },
    [rowKey],
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-testid="project-table-loading">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} height={36} />
        ))}
      </div>
    );
  }
  if (rows === undefined || rows.length === 0) {
    return empty ?? <UiEmptyState compact title={t('project:table.empty', 'No records')} />;
  }
  return (
    <CustomCellProvider render={renderCell}>
      <DataGrid
        columns={specs}
        rows={rows as readonly GridRow[]}
        rowId={rowId}
        density={density}
        {...(onRowClick === undefined ? {} : { onRowOpen: (row: GridRow) => onRowClick(row as R) })}
      />
    </CustomCellProvider>
  );
}

export function Stat({ label, value, delta, invertDelta = false, hint, icon }: StatProps): ReactNode {
  const inCard = useContext(InProjectCardContext);
  const locale = getI18nInstance()?.language;
  const trend = delta === undefined || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  const formatted =
    delta === undefined
      ? null
      : `${delta > 0 ? '+' : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(delta)}%`;
  const body = (
    <div className="flex items-start justify-between gap-3" data-testid="project-stat">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body-sm text-fg-muted">{label}</span>
        <span className="text-title font-semibold tabular-nums text-fg">{value}</span>
        {formatted === null && hint === undefined ? null : (
          <span className="flex flex-wrap items-center gap-2">
            {formatted === null ? null : (
              <DeltaPill trend={trend} invertGood={invertDelta}>
                {formatted}
              </DeltaPill>
            )}
            {hint === undefined ? null : <span className="text-caption text-fg-subtle">{hint}</span>}
          </span>
        )}
      </div>
      {icon === undefined ? null : (
        <IconTile tone="accent" icon={createElement(lucideByName(icon), { 'aria-hidden': true })} />
      )}
    </div>
  );
  return inCard ? body : <UiCard>{body}</UiCard>;
}
