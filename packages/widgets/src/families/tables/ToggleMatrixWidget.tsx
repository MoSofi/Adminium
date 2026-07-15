import { EmptyState, ToggleMatrix } from '@adminium/ui';
import type { ToggleMatrixCellState, ToggleMatrixColumn, ToggleMatrixGroup } from '@adminium/ui';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `toggle-matrix` (annex §3) — an interactive boolean grid (rows =
 * permissions/events, columns = roles/channels/tables) built on the ui
 * `ToggleMatrix` primitive: tri-state cells, locked columns, grouped iconized
 * sections, and dirty diff dots. Powers RBAC, RLS, and notification matrices.
 * Binds to the `matrix` shape; edits emit a mutation intent against
 * `persistTarget`.
 */

const cellMode = z.enum(['toggle', 'readonly', 'read-write-pair']);

export const toggleMatrixConfigSchema = widgetSharedConfigSchema.extend({
  cellMode: cellMode.default('toggle'),
  /** Table/policy target for persisted edits (adminium_roles / policy tables). */
  persistTarget: z.string().optional(),
  rowHeader: z.string().optional(),
  matrixLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type ToggleMatrixConfig = z.infer<typeof toggleMatrixConfigSchema>;

export interface MatrixColumn {
  id: string;
  label: string;
  locked?: boolean | undefined;
}
export interface MatrixRow {
  id: string;
  label: string;
  group?: string | undefined;
  desc?: string | undefined;
}
export interface MatrixData {
  rowKeys: string[];
  colKeys: string[];
  columns: MatrixColumn[];
  rows: MatrixRow[];
  /** rowId → colId → boolean (granted). */
  cells: Record<string, Record<string, boolean>>;
  /** rowId → colId → true when the cell is immutable (granted + locked). */
  locked?: Record<string, Record<string, boolean>> | undefined;
}

const cellKey = (rowId: string, colId: string): string => `${rowId}\u0000${colId}`;

export interface ToggleMatrixGridProps {
  data: MatrixData;
  cellMode?: z.infer<typeof cellMode>;
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
    return <EmptyState compact preset="no-data" title={emptyTitle ?? 'No matrix configured'} />;
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
        label={matrixLabel ?? 'Permissions matrix'}
        rowHeader={rowHeader ?? 'Permission'}
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

const PERMISSIONS: { id: string; label: string; group: string }[] = [
  { id: 'view', label: 'View records', group: 'Records' },
  { id: 'create', label: 'Create records', group: 'Records' },
  { id: 'update', label: 'Edit records', group: 'Records' },
  { id: 'delete', label: 'Delete records', group: 'Records' },
  { id: 'export', label: 'Export data', group: 'Data' },
  { id: 'import', label: 'Import data', group: 'Data' },
  { id: 'manage_users', label: 'Manage users', group: 'Admin' },
  { id: 'manage_billing', label: 'Manage billing', group: 'Admin' },
];
const ROLES: MatrixColumn[] = [
  { id: 'owner', label: 'Owner', locked: true },
  { id: 'admin', label: 'Admin' },
  { id: 'editor', label: 'Editor' },
  { id: 'viewer', label: 'Viewer' },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic `matrix` payload — RBAC permissions × roles (04 §7.7). */
export function toggleMatrixDemoData(seed: number): MatrixData {
  const random = mulberry32(seed || 1);
  const cells: Record<string, Record<string, boolean>> = {};
  const locked: Record<string, Record<string, boolean>> = {};
  for (const permission of PERMISSIONS) {
    cells[permission.id] = {};
    locked[permission.id] = {};
    for (const role of ROLES) {
      // Owner is granted-and-locked on everything; others get seeded grants.
      if (role.id === 'owner') {
        cells[permission.id]![role.id] = true;
        locked[permission.id]![role.id] = true;
      } else if (role.id === 'viewer') {
        cells[permission.id]![role.id] = permission.id === 'view' || permission.id === 'export';
      } else if (role.id === 'admin') {
        cells[permission.id]![role.id] = permission.group !== 'Admin' ? true : random() > 0.3;
      } else {
        cells[permission.id]![role.id] = permission.group === 'Records' ? random() > 0.2 : random() > 0.6;
      }
    }
  }
  return {
    rowKeys: PERMISSIONS.map((permission) => permission.id),
    colKeys: ROLES.map((role) => role.id),
    columns: ROLES,
    rows: PERMISSIONS,
    cells,
    locked,
  };
}
