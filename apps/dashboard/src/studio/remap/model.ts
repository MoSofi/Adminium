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
  // `label` is the engine column's own (an effective rename).
  hidden?: boolean;
  /** Resolved mask state (overrides > classifier default). */
  masked?: boolean;
  enumLabels?: Record<string, string>;
  enumTones?: Record<string, string>;
  /*
   * The four column RULES (plan 50 phase C). Mirrored from the server's
   * `EffectiveColumn` like every other field here. Unlike the rest they do not
   * change what a reader sees: they are what the write path enforces, on every
   * caller, which is why the inspector says so where it edits them.
   */
  fill?: {
    kind: 'now' | 'uuid' | 'literal' | 'current-user' | 'database' | 'none';
    text?: string;
    userField?: 'id' | 'name';
    onUpdate?: boolean;
  };
  options?:
    | { list: string }
    | { values: { value: string; label?: string; tone?: string; description?: string }[] };
  requiredByRule?: boolean;
  validation?: {
    format?: 'email' | 'url' | 'phone';
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
  /** Decided by Adminium on every write: copied from a linked row. */
  copy?: { via: string; from: string; mode?: 'default' | 'always' };
  /** Decided by Adminium: the next number in the column's own counter. */
  sequence?: { start?: number };
  /** Decided by Adminium: a short random code. */
  code?: { prefix?: string; length: number };
  /** Decided by Adminium: the total of the child rows linking here. */
  rollup?: { from: string; via: string; sum: string; times?: string; unlessSet?: string };
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
  /**
   * Whether this connection's schema can be authored, and why not.
   *
   * Optional on the client because a server one release behind does not send
   * it. Absent is treated as authorable — the routes refuse what they refuse
   * either way, and hiding Design on an OLD server because a new field is
   * missing would break a working install to satisfy a new one.
   */
  schemaAuthoring?: {
    authorable: boolean;
    reason: 'NO_LIVE_DATABASE' | 'READ_ONLY_ROLE' | 'NO_DDL_PRIVILEGE' | 'READ_ONLY_INTENT' | null;
  };
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

/**
 * Ordered values of the enum a column references ([] when it has none).
 *
 * `enumRef` is the whole question. It used to also demand
 * `logicalType === 'enum'`, which is true of a NATIVE postgres enum and of
 * nothing else: on all three engines an Adminium choice column is
 * `varchar(64)` plus a CHECK (D32), and MySQL's own `enum()` and a
 * hand-written `CHECK … IN` are the same shape. So the values were hidden for
 * every choice column the product itself creates — the enum-label editor never
 * appeared for one, and the schema designer opened it with an empty list.
 * Found by the sqlite e2e leg.
 */
export function enumValuesFor(model: EffectiveModel, column: EffectiveColumn): string[] {
  if (column.enumRef === null) return [];
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
