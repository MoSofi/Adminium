// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reply/display types for the remap editor.
 *
 * `Effective*` mirrors the server's applied-overrides read shape
 * (`apps/server/src/connections/effective-schema.ts`): the engine
 * `DatabaseModel` with display-layer fields attached by
 * `GET /connections/:id/schema`. Engine types are imported (dashboard
 * legally depends on @adminium/engine); the display extensions are mirrored
 * because server code is not importable from the dashboard.
 */
import type { ColumnModel, DatabaseModel, Relation, TableModel } from '@adminium/engine';

export interface EffectiveColumn extends ColumnModel {
  label?: string;
  hidden?: boolean;
  /** Resolved mask state (overrides > classifier default). */
  masked?: boolean;
  enumLabels?: Record<string, string>;
  enumTones?: Record<string, string>;
}

export interface EffectiveTable extends Omit<TableModel, 'columns'> {
  columns: EffectiveColumn[];
  /** Widened to match engine `TableModel.label` (now carries the field) under exactOptionalPropertyTypes. */
  label?: string | undefined;
  labelPlural?: string;
  icon?: string;
  excluded?: boolean;
  keyField?: string;
}

export interface EffectiveRelation extends Relation {
  label?: string;
}

export interface EffectiveModel extends Omit<DatabaseModel, 'tables' | 'relations'> {
  tables: EffectiveTable[];
  relations: EffectiveRelation[];
}

/** `GET /connections/:id/schema` reply (server `schemaReply`). */
export interface SchemaReply {
  connectionId: string;
  snapshotId: string;
  checksum: string;
  createdAt: number;
  source: string;
  model: EffectiveModel;
  appliedOverrides: number;
}

/** `POST /connections/:id/generate` reply (server `generateReply`). */
export interface GenerateReply {
  pages: number;
  navGroups: string[];
  snapshotId: string;
  introspected: boolean;
  intent: string;
  result: { created: number; updated: number; unchanged: number; pruned: number };
  warnings: unknown[];
  durationMs: number;
}

// --- selection ----------------------------------------------------------------

export type RemapSelection =
  | { kind: 'table'; tableId: string }
  | { kind: 'column'; tableId: string; column: string };

// --- display helpers ------------------------------------------------------------

export function titleCase(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Server-applied display label (override already applied) or a derived one. */
export function tableDisplayLabel(table: EffectiveTable): string {
  return table.label ?? titleCase(table.name);
}

export function columnDisplayLabel(column: EffectiveColumn): string {
  return column.label ?? titleCase(column.name);
}

export function tableById(model: EffectiveModel, tableId: string): EffectiveTable | undefined {
  return model.tables.find((table) => table.id === tableId);
}

/** Ordered values of the enum a column references ([] when not an enum). */
export function enumValuesFor(model: EffectiveModel, column: EffectiveColumn): string[] {
  if (column.logicalType !== 'enum' || column.enumRef === null) return [];
  return model.enums.find((def) => def.id === column.enumRef)?.values ?? [];
}

export interface TableRelations {
  declared: EffectiveRelation[];
  inferred: EffectiveRelation[];
  overrides: EffectiveRelation[];
}

/** Relations touching a table, bucketed the way the Relations tab lists them. */
export function relationsForTable(model: EffectiveModel, tableId: string): TableRelations {
  const touching = model.relations.filter(
    (relation) => relation.from.tableId === tableId || relation.to.tableId === tableId,
  );
  return {
    declared: touching.filter((r) => r.kind === 'declared-fk' || r.kind === 'manifest'),
    inferred: touching.filter((r) => r.kind === 'inferred-name' || r.kind === 'inferred-join-table'),
    overrides: touching.filter((r) => r.kind === 'override'),
  };
}
