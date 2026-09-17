// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `diffTableDefinitions` — the DEFINITION-level diff.
 *
 * ─── Why `diffModels` cannot be used for this ──────────────────────────────
 *
 * `snapshot/diff.ts` is the **page-breakage** diff, and it is exactly right at
 * that job: it answers "did anything change that a generated page or an
 * override might be pointing at?", which is why its `breaking` flag is gated
 * on an `isReferenced` callback. To answer that it compares `logicalType`,
 * nullability, added/removed columns, `pkChanged` as a BOOLEAN, and enum
 * values — and nothing else.
 *
 * A DDL planner needs the other half, and the gap is not marginal:
 *
 *   varchar(50) → varchar(100)   `logicalType` is `varchar` both sides → INVISIBLE
 *   decimal(10,2) → decimal(12,2)                                     → INVISIBLE
 *   default 0 → default 1                                             → INVISIBLE
 *   a unique constraint added or dropped                              → INVISIBLE
 *   an index added or dropped                                         → INVISIBLE
 *   a CHECK added or dropped                                          → INVISIBLE
 *   ON DELETE CASCADE → ON DELETE RESTRICT                            → INVISIBLE
 *   a comment changed                                                 → INVISIBLE
 *   WHICH columns the primary key moved between                       → a boolean
 *
 * Every one of those is a real `ALTER`. So the planner diffs definitions here
 * and reads `diffModels` beside it for the consequence analysis — two diffs,
 * two jobs, neither pretending to do the other's.
 *
 * Pure, canonical (every output array sorted), and Zod-schema'd so a plan
 * response validates like every other route payload.
 */
import { z } from 'zod';

import {
  fkActionSchema,
  logicalTypeSchema,
  type ColumnModel,
  type Relation,
  type TableModel,
} from '../schema-model.js';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * A column's type at DDL resolution — everything that changes the emitted type
 * string, not just the logical family.
 */
export const columnTypeShapeSchema = z.strictObject({
  logicalType: logicalTypeSchema,
  maxLength: z.number().int().nullable(),
  numericPrecision: z.number().int().nullable(),
  numericScale: z.number().int().nullable(),
});
export type ColumnTypeShape = z.infer<typeof columnTypeShapeSchema>;

export const columnDefinitionDiffSchema = z.strictObject({
  column: z.string().min(1),
  typeChanged: z
    .strictObject({ from: columnTypeShapeSchema, to: columnTypeShapeSchema })
    .nullable()
    .default(null),
  nullabilityChanged: z.strictObject({ nowNullable: z.boolean() }).nullable().default(null),
  /** Rendered defaults, compared structurally; `null` on either side is "no default". */
  defaultChanged: z
    .strictObject({ from: z.string().nullable(), to: z.string().nullable() })
    .nullable()
    .default(null),
  commentChanged: z
    .strictObject({ from: z.string().nullable(), to: z.string().nullable() })
    .nullable()
    .default(null),
});
export type ColumnDefinitionDiff = z.infer<typeof columnDefinitionDiffSchema>;

const namedConstraintSchema = z.strictObject({
  name: z.string().nullable(),
  columns: z.array(z.string()),
});

const fkShapeSchema = z.strictObject({
  /** The catalog's own name, when it gave one — what a DROP needs. */
  constraintName: z.string().nullable(),
  columns: z.array(z.string()),
  toTable: z.string(),
  toColumns: z.array(z.string()),
  onDelete: fkActionSchema.nullable(),
  onUpdate: fkActionSchema.nullable(),
});
export type FkShape = z.infer<typeof fkShapeSchema>;

export const tableDefinitionDiffSchema = z.strictObject({
  tableId: z.string().min(1),
  addedColumns: z.array(z.string()),
  removedColumns: z.array(z.string()),
  /** One entry per column with at least one changed facet. */
  changedColumns: z.array(columnDefinitionDiffSchema),
  /** `null` when unchanged; otherwise the old and new key, in order. */
  pkChanged: z
    .strictObject({ from: z.array(z.string()), to: z.array(z.string()) })
    .nullable()
    .default(null),
  uniquesAdded: z.array(namedConstraintSchema),
  uniquesRemoved: z.array(namedConstraintSchema),
  checksAdded: z.array(z.strictObject({ name: z.string().nullable(), expression: z.string() })),
  checksRemoved: z.array(z.strictObject({ name: z.string().nullable(), expression: z.string() })),
  indexesAdded: z.array(namedConstraintSchema.extend({ unique: z.boolean() })),
  indexesRemoved: z.array(namedConstraintSchema.extend({ unique: z.boolean() })),
  fksAdded: z.array(fkShapeSchema),
  fksRemoved: z.array(fkShapeSchema),
  /** Same endpoints, different referential action — an ALTER, not an add. */
  fksActionsChanged: z.array(z.strictObject({ from: fkShapeSchema, to: fkShapeSchema })),
  commentChanged: z
    .strictObject({ from: z.string().nullable(), to: z.string().nullable() })
    .nullable()
    .default(null),
});
export type TableDefinitionDiff = z.infer<typeof tableDefinitionDiffSchema>;

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function typeShape(column: ColumnModel): ColumnTypeShape {
  return {
    logicalType: column.logicalType,
    maxLength: column.maxLength,
    numericPrecision: column.numericPrecision,
    numericScale: column.numericScale,
  };
}

function sameTypeShape(a: ColumnTypeShape, b: ColumnTypeShape): boolean {
  return (
    a.logicalType === b.logicalType &&
    a.maxLength === b.maxLength &&
    a.numericPrecision === b.numericPrecision &&
    a.numericScale === b.numericScale
  );
}

/**
 * Render a default to a comparable string. Structural rather than textual:
 * `{kind:'now'}` and `{kind:'expression', text:'now()'}` are different things
 * to a planner even though a database would print both as `now()`.
 */
export function renderDefault(value: ColumnModel['default']): string | null {
  if (value === null) return null;
  return value.kind === 'literal' || value.kind === 'expression'
    ? `${value.kind}:${value.text}`
    : value.kind;
}

/** A constraint's identity for set comparison: its name if it has one, else its columns. */
function constraintKey(c: { name: string | null; columns: string[] }): string {
  return c.name ?? `cols:${c.columns.join(',')}`;
}

function fkShapeOf(relation: Relation): FkShape {
  return {
    constraintName: relation.constraintName,
    columns: [...relation.from.columns],
    toTable: relation.to.tableId,
    toColumns: [...relation.to.columns],
    onDelete: relation.onDelete,
    onUpdate: relation.onUpdate,
  };
}

/** Endpoint identity — what makes two FKs "the same constraint, changed". */
function fkEndpointKey(fk: FkShape): string {
  return `${fk.columns.join(',')}->${fk.toTable}(${fk.toColumns.join(',')})`;
}

export interface DefinitionDiffInput {
  /** Declared FKs on the FROM side of this table, both sides of the comparison. */
  actualFks?: readonly Relation[];
  desiredFks?: readonly Relation[];
}

/**
 * Diff two definitions of the same table. `actual` is the snapshot's copy,
 * `desired` the authored one (already converted to a `TableModel`).
 *
 * Foreign keys live on `DatabaseModel.relations`, not on `TableModel`, so they
 * are passed in rather than read off the table — which also lets the planner
 * hand in only the declared ones and never accidentally plan DDL for an
 * inferred or virtual relation.
 */
export function diffTableDefinitions(
  actual: TableModel,
  desired: TableModel,
  input: DefinitionDiffInput = {},
): TableDefinitionDiff {
  const actualColumns = new Map(actual.columns.map((c) => [c.name, c]));
  const desiredColumns = new Map(desired.columns.map((c) => [c.name, c]));

  const addedColumns = [...desiredColumns.keys()].filter((n) => !actualColumns.has(n)).sort();
  const removedColumns = [...actualColumns.keys()].filter((n) => !desiredColumns.has(n)).sort();

  const changedColumns: ColumnDefinitionDiff[] = [];
  for (const [name, before] of actualColumns) {
    const after = desiredColumns.get(name);
    if (after === undefined) continue;
    const beforeShape = typeShape(before);
    const afterShape = typeShape(after);
    const beforeDefault = renderDefault(before.default);
    const afterDefault = renderDefault(after.default);
    const entry: ColumnDefinitionDiff = {
      column: name,
      typeChanged: sameTypeShape(beforeShape, afterShape)
        ? null
        : { from: beforeShape, to: afterShape },
      nullabilityChanged:
        before.nullable === after.nullable ? null : { nowNullable: after.nullable },
      defaultChanged: beforeDefault === afterDefault ? null : { from: beforeDefault, to: afterDefault },
      commentChanged: before.comment === after.comment ? null : { from: before.comment, to: after.comment },
    };
    if (
      entry.typeChanged !== null ||
      entry.nullabilityChanged !== null ||
      entry.defaultChanged !== null ||
      entry.commentChanged !== null
    ) {
      changedColumns.push(entry);
    }
  }
  changedColumns.sort((a, b) => a.column.localeCompare(b.column));

  const pkSame =
    actual.primaryKey.length === desired.primaryKey.length &&
    actual.primaryKey.every((c, i) => c === desired.primaryKey[i]);

  const diffConstraints = <T extends { name: string | null; columns: string[] }>(
    before: readonly T[],
    after: readonly T[],
  ): { added: T[]; removed: T[] } => {
    const beforeKeys = new Set(before.map(constraintKey));
    const afterKeys = new Set(after.map(constraintKey));
    return {
      added: after.filter((c) => !beforeKeys.has(constraintKey(c))),
      removed: before.filter((c) => !afterKeys.has(constraintKey(c))),
    };
  };

  const uniques = diffConstraints(actual.uniques, desired.uniques);
  // Primary-key indexes are the PK's business, not the index list's.
  const indexes = diffConstraints(
    actual.indexes.filter((i) => !i.primary).map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
    desired.indexes.filter((i) => !i.primary).map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
  );

  const beforeChecks = new Set(actual.checks.map((c) => c.expression));
  const afterChecks = new Set(desired.checks.map((c) => c.expression));
  const checksAdded = desired.checks.filter((c) => !beforeChecks.has(c.expression));
  const checksRemoved = actual.checks.filter((c) => !afterChecks.has(c.expression));

  const actualFks = (input.actualFks ?? []).map(fkShapeOf);
  const desiredFks = (input.desiredFks ?? []).map(fkShapeOf);
  const actualByEndpoint = new Map(actualFks.map((f) => [fkEndpointKey(f), f]));
  const desiredByEndpoint = new Map(desiredFks.map((f) => [fkEndpointKey(f), f]));

  const fksAdded = desiredFks.filter((f) => !actualByEndpoint.has(fkEndpointKey(f)));
  const fksRemoved = actualFks.filter((f) => !desiredByEndpoint.has(fkEndpointKey(f)));
  const fksActionsChanged: { from: FkShape; to: FkShape }[] = [];
  for (const [key, before] of actualByEndpoint) {
    const after = desiredByEndpoint.get(key);
    if (after === undefined) continue;
    if (before.onDelete !== after.onDelete || before.onUpdate !== after.onUpdate) {
      fksActionsChanged.push({ from: before, to: after });
    }
  }

  const byName = (a: { name: string | null }, b: { name: string | null }) =>
    (a.name ?? '').localeCompare(b.name ?? '');

  return {
    tableId: actual.id,
    addedColumns,
    removedColumns,
    changedColumns,
    pkChanged: pkSame ? null : { from: [...actual.primaryKey], to: [...desired.primaryKey] },
    uniquesAdded: uniques.added.map((u) => ({ name: u.name, columns: u.columns })).sort(byName),
    uniquesRemoved: uniques.removed.map((u) => ({ name: u.name, columns: u.columns })).sort(byName),
    checksAdded: [...checksAdded].sort((a, b) => a.expression.localeCompare(b.expression)),
    checksRemoved: [...checksRemoved].sort((a, b) => a.expression.localeCompare(b.expression)),
    indexesAdded: [...indexes.added].sort(byName),
    indexesRemoved: [...indexes.removed].sort(byName),
    fksAdded: fksAdded.sort((a, b) => fkEndpointKey(a).localeCompare(fkEndpointKey(b))),
    fksRemoved: fksRemoved.sort((a, b) => fkEndpointKey(a).localeCompare(fkEndpointKey(b))),
    fksActionsChanged: fksActionsChanged.sort((a, b) =>
      fkEndpointKey(a.from).localeCompare(fkEndpointKey(b.from)),
    ),
    commentChanged: actual.comment === desired.comment ? null : { from: actual.comment, to: desired.comment },
  };
}

/** True when nothing about the definition changed. */
export function isEmptyDefinitionDiff(diff: TableDefinitionDiff): boolean {
  return (
    diff.addedColumns.length === 0 &&
    diff.removedColumns.length === 0 &&
    diff.changedColumns.length === 0 &&
    diff.pkChanged === null &&
    diff.uniquesAdded.length === 0 &&
    diff.uniquesRemoved.length === 0 &&
    diff.checksAdded.length === 0 &&
    diff.checksRemoved.length === 0 &&
    diff.indexesAdded.length === 0 &&
    diff.indexesRemoved.length === 0 &&
    diff.fksAdded.length === 0 &&
    diff.fksRemoved.length === 0 &&
    diff.fksActionsChanged.length === 0 &&
    diff.commentChanged === null
  );
}
