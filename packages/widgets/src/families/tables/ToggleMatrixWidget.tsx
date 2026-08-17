// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { EmptyState, ToggleMatrix } from '@adminium/ui';
import type { ToggleMatrixCellState, ToggleMatrixColumn, ToggleMatrixGroup } from '@adminium/ui';
import { useMemo, useState } from 'react';

import type { ToggleCellMode, ToggleMatrixConfig } from './tables-track-f-config.js';
import type { MatrixData, MatrixRow } from './tables-track-f-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `toggle-matrix` (annex §3) — an interactive boolean grid (rows =
 * permissions/events, columns = roles/channels/tables) built on the ui
 * `ToggleMatrix` primitive: tri-state cells, locked columns, grouped iconized
 * sections, and dirty diff dots. Powers RBAC, RLS, and notification matrices.
 * Binds to the `matrix` shape; edits emit a mutation intent against
 * `persistTarget`.
 */

// Config schema + deterministic demo payload live in the pure
// `tables-track-f-config` module, and the matrix shapes in
// `tables-track-f-types`, so the registry metadata graph never reaches this
// component file (04 §2.3). Re-exported here to keep existing import points
// stable.
export { toggleMatrixConfigSchema, toggleMatrixDemoData } from './tables-track-f-config.js';
export type { ToggleMatrixConfig } from './tables-track-f-config.js';
export type { MatrixColumn, MatrixData, MatrixRow } from './tables-track-f-types.js';

const cellKey = (rowId: string, colId: string): string => `${rowId}\u0000${colId}`;

export interface ToggleMatrixGridProps {
  data: MatrixData;
  cellMode?: ToggleCellMode;
  rowHeader?: string | undefined;
  matrixLabel?: string | undefined;
  emptyTitle?: string | undefined;
  onToggle?: ((rowId: string, colId: string, next: boolean) => void) | undefined;
  testId?: string | undefined;
}

export function ToggleMatrixGrid({
  data,
  cellMode: mode = 'toggle',
  rowHeader,
  matrixLabel,
  emptyTitle,
  onToggle,
  testId,
}: ToggleMatrixGridProps) {
  const t = useMaybeT();
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());

  const groups = useMemo<ToggleMatrixGroup[]>(() => {
    const order: string[] = [];
    const byGroup = new Map<string, MatrixRow[]>();
    for (const row of data.rows) {
      const key = row.group ?? '__ungrouped__';
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)?.push(row);
    }
    return order.map((key) => ({
      id: key,
      ...(key === '__ungrouped__' ? {} : { label: key }),
      rows: (byGroup.get(key) ?? []).map((row) => ({ id: row.id, label: row.label })),
    }));
  }, [data.rows]);

  const columns = useMemo<ToggleMatrixColumn[]>(
    () => data.columns.map((column) => ({ id: column.id, label: column.label, ...(column.locked === true ? { locked: true } : {}) })),
    [data.columns],
  );

  if (data.rows.length === 0 || data.columns.length === 0) {
    return <EmptyState compact preset="no-data" title={emptyTitle ?? t('ui:widgets.tables.toggleMatrix.emptyTitle', 'No matrix configured')} />;
  }

  const baseState = (rowId: string, colId: string): boolean => data.cells[rowId]?.[colId] === true;
  const isLocked = (rowId: string, colId: string): boolean => data.locked?.[rowId]?.[colId] === true;

  const getCellState = (rowId: string, colId: string): ToggleMatrixCellState => {
    if (isLocked(rowId, colId)) return 'locked';
    const override = overrides.get(cellKey(rowId, colId));
    const on = override ?? baseState(rowId, colId);
    return on ? 'on' : 'off';
  };
  const isDirty = (rowId: string, colId: string): boolean => {
    const override = overrides.get(cellKey(rowId, colId));
    return override !== undefined && override !== baseState(rowId, colId);
  };

  return (
    <div data-widget="toggle-matrix" data-testid={testId} className="h-full overflow-auto p-2">
      <ToggleMatrix
        label={matrixLabel ?? t('ui:widgets.tables.toggleMatrix.matrixLabel', 'Permissions matrix')}
        rowHeader={rowHeader ?? t('ui:widgets.tables.toggleMatrix.rowHeaderLabel', 'Permission')}
        columns={columns}
        groups={groups}
        getCellState={getCellState}
        isDirty={isDirty}
        disabled={mode === 'readonly'}
        {...(mode === 'readonly'
          ? {}
          : {
              onToggle: (rowId, colId, next) => {
                setOverrides((prev) => new Map(prev).set(cellKey(rowId, colId), next));
                onToggle?.(rowId, colId, next);
              },
            })}
      />
    </div>
  );
}

function matrixDataOf(data: unknown): MatrixData {
  const empty: MatrixData = { rowKeys: [], colKeys: [], columns: [], rows: [], cells: {} };
  if (typeof data !== 'object' || data === null) return empty;
  const envelope = data as Partial<MatrixData>;
  return {
    rowKeys: Array.isArray(envelope.rowKeys) ? envelope.rowKeys : [],
    colKeys: Array.isArray(envelope.colKeys) ? envelope.colKeys : [],
    columns: Array.isArray(envelope.columns) ? envelope.columns : [],
    rows: Array.isArray(envelope.rows) ? envelope.rows : [],
    cells: typeof envelope.cells === 'object' && envelope.cells !== null ? envelope.cells : {},
    ...(envelope.locked === undefined ? {} : { locked: envelope.locked }),
  };
}

export function ToggleMatrixWidget({ config, data, onEvent }: WidgetProps<ToggleMatrixConfig>) {
  const source = config.binding;
  const table =
    config.persistTarget ??
    (source === undefined ? undefined : source.source.schema === undefined ? source.source.name : `${source.source.schema}.${source.source.name}`);
  return (
    <ToggleMatrixGrid
      data={matrixDataOf(data)}
      cellMode={config.cellMode}
      {...(config.rowHeader === undefined ? {} : { rowHeader: config.rowHeader })}
      {...(config.matrixLabel === undefined ? {} : { matrixLabel: config.matrixLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      onToggle={(rowId, colId, next) => {
        if (table !== undefined) {
          onEvent({
            type: 'mutate',
            intent: 'update',
            ...(source === undefined ? {} : { connectionId: source.connectionId }),
            table,
            recordId: rowId,
            values: { [colId]: next },
          });
        }
      }}
    />
  );
}
