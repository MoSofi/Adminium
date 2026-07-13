/**
 * Snapshot diff engine — 05-introspection-engine.md §9 `diffModels`.
 *
 * Pure structural diff between two `DatabaseModel`s. All output arrays are
 * sorted (tables/relations by id, columns by name) so the diff itself is
 * canonical and safe to hash/golden-test.
 *
 * NOT IMPLEMENTED HERE (deliberately, per 05 §9): rename detection.
 * `rename-detect.ts` is a separate M3-follow-up — a removed+added column
 * pair with identical logicalType+nullability and (same ordinal or
 * Levenshtein ≤ 2 or snake/camel variant) becomes a `renamedColumns`
 * suggestion at confidence 0.7, never auto-applied. Until it lands,
 * `renamedColumns` is always `[]` and a drop+add reads as exactly that.
 */
import { z } from 'zod';

import {
  logicalTypeSchema,
  relationSchema,
  type DatabaseModel,
  type LogicalType,
  type Relation,
  type TableModel,
} from '../schema-model.js';

// ---------------------------------------------------------------------------
// Diff shape (§9) — Zod schema so the §11 diff route can validate responses
// ---------------------------------------------------------------------------

export const changedTableSchema = z.strictObject({
  addedColumns: z.array(z.string()),
  removedColumns: z.array(z.string()),
  typeChanged: z.array(
    z.strictObject({ column: z.string(), from: logicalTypeSchema, to: logicalTypeSchema }),
  ),
  nullabilityChanged: z.array(z.strictObject({ column: z.string(), nowNullable: z.boolean() })),
  enumValuesChanged: z.array(
    z.strictObject({ enumId: z.string(), added: z.array(z.string()), removed: z.array(z.string()) }),
  ),
  pkChanged: z.boolean(),
  /** Suggestions only; always [] until rename-detect.ts lands (see header). */
  renamedColumns: z.array(
    z.strictObject({ from: z.string(), to: z.string(), confidence: z.number().min(0).max(1) }),
  ),
});
export type ChangedTable = z.infer<typeof changedTableSchema>;

export const schemaDiffSchema = z.strictObject({
  addedTables: z.array(z.string()),
  removedTables: z.array(z.string()),
  changedTables: z.record(z.string(), changedTableSchema),
  relationChanges: z.strictObject({
    added: z.array(relationSchema),
    removed: z.array(relationSchema),
  }),
  /** Any removal/typeChange referenced by current pages/overrides (§9). */
  breaking: z.boolean(),
});
export type SchemaDiff = z.infer<typeof schemaDiffSchema>;

export interface DiffOptions {
  /**
   * Is this target path (`schema.table` or `schema.table.column`) referenced
   * by current pages/overrides? `breaking` is only set for referenced
   * removals/type changes. Callers without page knowledge (the engine in
   * isolation) get the conservative default: everything is referenced.
   */
  isReferenced?: (targetPath: string) => boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const sortStrings = (values: string[]) => [...values].sort((a, b) => a.localeCompare(b));
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

function diffTable(
  a: TableModel,
  b: TableModel,
  modelA: DatabaseModel,
  modelB: DatabaseModel,
): ChangedTable | null {
  const aColumns = new Map(a.columns.map((c) => [c.name, c]));
  const bColumns = new Map(b.columns.map((c) => [c.name, c]));

  const addedColumns = sortStrings([...bColumns.keys()].filter((name) => !aColumns.has(name)));
  const removedColumns = sortStrings([...aColumns.keys()].filter((name) => !bColumns.has(name)));

  const typeChanged: { column: string; from: LogicalType; to: LogicalType }[] = [];
  const nullabilityChanged: { column: string; nowNullable: boolean }[] = [];
  const enumValuesChanged: ChangedTable['enumValuesChanged'] = [];

  const enumsA = new Map(modelA.enums.map((e) => [e.id, e]));
  const enumsB = new Map(modelB.enums.map((e) => [e.id, e]));
  const seenEnumIds = new Set<string>();

  for (const name of sortStrings([...aColumns.keys()].filter((n) => bColumns.has(n)))) {
    const before = aColumns.get(name)!;
    const after = bColumns.get(name)!;
    if (before.logicalType !== after.logicalType) {
      typeChanged.push({ column: name, from: before.logicalType, to: after.logicalType });
    }
    if (before.nullable !== after.nullable) {
      nullabilityChanged.push({ column: name, nowNullable: after.nullable });
    }
    // Enum drift is reported on the table(s) whose columns reference the enum.
    const enumId = after.enumRef ?? before.enumRef;
    if (enumId !== null && !seenEnumIds.has(enumId)) {
      seenEnumIds.add(enumId);
      const valuesA = enumsA.get(before.enumRef ?? enumId)?.values ?? [];
      const valuesB = enumsB.get(after.enumRef ?? enumId)?.values ?? [];
      const setA = new Set(valuesA);
      const setB = new Set(valuesB);
      const added = sortStrings(valuesB.filter((v) => !setA.has(v)));
      const removed = sortStrings(valuesA.filter((v) => !setB.has(v)));
      if (added.length > 0 || removed.length > 0) {
        enumValuesChanged.push({ enumId, added, removed });
      }
    }
  }
  enumValuesChanged.sort((x, y) => x.enumId.localeCompare(y.enumId));

  const pkChanged =
    a.primaryKey.length !== b.primaryKey.length ||
    a.primaryKey.some((column, i) => column !== b.primaryKey[i]);

  if (
    addedColumns.length === 0 &&
    removedColumns.length === 0 &&
    typeChanged.length === 0 &&
    nullabilityChanged.length === 0 &&
    enumValuesChanged.length === 0 &&
    !pkChanged
  ) {
    return null;
  }

  return {
    addedColumns,
    removedColumns,
    typeChanged,
    nullabilityChanged,
    enumValuesChanged,
    pkChanged,
    renamedColumns: [], // rename detection deferred — see module header
  };
}

/**
 * §9 `diffModels(a, b)`: what changed going FROM `a` TO `b`. Pure; stable
 * ordering throughout; empty diff = `{ addedTables: [], … breaking: false }`.
 */
export function diffModels(
  a: DatabaseModel,
  b: DatabaseModel,
  options: DiffOptions = {},
): SchemaDiff {
  const isReferenced = options.isReferenced ?? (() => true);

  const tablesA = new Map(a.tables.map((t) => [t.id, t]));
  const tablesB = new Map(b.tables.map((t) => [t.id, t]));

  const addedTables = sortStrings([...tablesB.keys()].filter((id) => !tablesA.has(id)));
  const removedTables = sortStrings([...tablesA.keys()].filter((id) => !tablesB.has(id)));

  const changedTables: Record<string, ChangedTable> = {};
  for (const id of sortStrings([...tablesA.keys()].filter((tid) => tablesB.has(tid)))) {
    const changed = diffTable(tablesA.get(id)!, tablesB.get(id)!, a, b);
    if (changed !== null) changedTables[id] = changed;
  }

  const relationsA = new Map(a.relations.map((r) => [r.id, r]));
  const relationsB = new Map(b.relations.map((r) => [r.id, r]));
  const added: Relation[] = [...relationsB.values()].filter((r) => !relationsA.has(r.id)).sort(byId);
  const removed: Relation[] = [...relationsA.values()]
    .filter((r) => !relationsB.has(r.id))
    .sort(byId);

  let breaking = removedTables.some((id) => isReferenced(id));
  if (!breaking) {
    for (const [id, changed] of Object.entries(changedTables)) {
      if (
        changed.removedColumns.some((column) => isReferenced(`${id}.${column}`)) ||
        changed.typeChanged.some((change) => isReferenced(`${id}.${change.column}`)) ||
        (changed.pkChanged && isReferenced(id))
      ) {
        breaking = true;
        break;
      }
    }
  }

  return {
    addedTables,
    removedTables,
    changedTables,
    relationChanges: { added, removed },
    breaking,
  };
}

/** True when the diff carries no change at all. */
export function isEmptyDiff(diff: SchemaDiff): boolean {
  return (
    diff.addedTables.length === 0 &&
    diff.removedTables.length === 0 &&
    Object.keys(diff.changedTables).length === 0 &&
    diff.relationChanges.added.length === 0 &&
    diff.relationChanges.removed.length === 0
  );
}
