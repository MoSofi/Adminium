// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rename pre-application — 35-schema-authoring.md §3.1, 35-T03.
 *
 * ─── The problem this solves, stated once ──────────────────────────────────
 *
 * A structural diff cannot see a rename. `snapshot/diff.ts:9-15` says so in
 * its own header: rename detection is deliberately absent, `renamedColumns` is
 * always `[]`, and "a drop+add reads as exactly that". That is the right call
 * for drift detection — guessing that a dropped `email` and an added
 * `email_address` are the same column is how a diff invents a data migration
 * nobody asked for.
 *
 * For AUTHORING the answer is different and much simpler: the user knows. They
 * clicked rename. So intent travels explicitly in `SchemaEdit.renames`, and
 * this module applies it to the ACTUAL model before any diff runs. After that
 * the diff compares `customers` (renamed from `clients`) against the desired
 * `customers` and sees whatever really changed — not a table dropped and
 * another created, which would emit `DROP TABLE clients` and lose every row.
 *
 * The order matters and is the whole point: rename first, diff second. A diff
 * that runs first has already lost the information.
 */
import type { DatabaseModel, Relation, TableModel } from '../schema-model.js';

export interface RenameIntent {
  tables: readonly { from: string; to: string }[];
  columns: readonly { table: string; from: string; to: string }[];
}

/** Where a renamed table ended up, so the planner can emit the DDL step. */
export interface AppliedRename {
  kind: 'table' | 'column';
  /** Table id BEFORE the rename. */
  tableId: string;
  /** Table id AFTER the rename (same as `tableId` for a column rename). */
  newTableId: string;
  from: string;
  to: string;
}

export interface RenameApplication {
  model: DatabaseModel;
  applied: AppliedRename[];
}

const qualify = (schema: string, name: string): string => `${schema}.${name}`;

/**
 * Apply rename intent to `model`, returning a new model plus the list of
 * renames that actually resolved. A rename naming a table or column that does
 * not exist is silently skipped here — {@link validateSchemaEdit} has already
 * reported it as `UNKNOWN_TABLE`/`UNKNOWN_COLUMN`, and throwing a second time
 * from a pure transform would give the route two error shapes for one fault.
 *
 * Every reference is rewritten, not just the table's own name: relation
 * endpoints, `through` join tables, and the per-column `references` mirror.
 * Missing one leaves a model that parses and lies.
 */
export function applyRenames(model: DatabaseModel, renames: RenameIntent): RenameApplication {
  const applied: AppliedRename[] = [];

  // Resolve a caller's table reference (id or bare name) to a real table id.
  const resolve = (ref: string): TableModel | undefined =>
    model.tables.find((t) => t.id === ref) ?? model.tables.find((t) => t.name === ref);

  // --- table renames: old id → new id --------------------------------------
  const tableIdMap = new Map<string, string>();
  const tableRenames = new Map<string, string>();
  for (const r of renames.tables) {
    const table = resolve(r.from);
    if (table === undefined || table.name === r.to) continue;
    const newId = qualify(table.schema, r.to);
    tableIdMap.set(table.id, newId);
    tableRenames.set(table.id, r.to);
    applied.push({ kind: 'table', tableId: table.id, newTableId: newId, from: table.name, to: r.to });
  }

  // --- column renames, keyed by the table's ORIGINAL id ---------------------
  const columnRenames = new Map<string, Map<string, string>>();
  for (const r of renames.columns) {
    const table = resolve(r.table);
    if (table === undefined) continue;
    if (!table.columns.some((c) => c.name === r.from)) continue;
    if (r.from === r.to) continue;
    const perTable = columnRenames.get(table.id) ?? new Map<string, string>();
    perTable.set(r.from, r.to);
    columnRenames.set(table.id, perTable);
    applied.push({
      kind: 'column',
      tableId: table.id,
      newTableId: tableIdMap.get(table.id) ?? table.id,
      from: r.from,
      to: r.to,
    });
  }

  if (applied.length === 0) return { model, applied };

  const newIdOf = (id: string): string => tableIdMap.get(id) ?? id;
  const newColumnOf = (tableId: string, column: string): string =>
    columnRenames.get(tableId)?.get(column) ?? column;

  const tables: TableModel[] = model.tables.map((table) => {
    const renamedTo = tableRenames.get(table.id);
    const perColumn = columnRenames.get(table.id);
    if (renamedTo === undefined && perColumn === undefined) {
      // Even an untouched table may hold a `references` mirror at a renamed one.
      const columns = table.columns.map((c) =>
        c.references === null
          ? c
          : {
              ...c,
              references: {
                tableId: newIdOf(c.references.tableId),
                column: newColumnOf(c.references.tableId, c.references.column),
              },
            },
      );
      return { ...table, columns };
    }
    const rename = (column: string) => perColumn?.get(column) ?? column;
    return {
      ...table,
      id: newIdOf(table.id),
      name: renamedTo ?? table.name,
      columns: table.columns.map((c) => ({
        ...c,
        name: rename(c.name),
        enumRef:
          c.enumRef === null ? null : `${newIdOf(table.id)}.${rename(c.name)}`,
        references:
          c.references === null
            ? null
            : {
                tableId: newIdOf(c.references.tableId),
                column: newColumnOf(c.references.tableId, c.references.column),
              },
      })),
      primaryKey: table.primaryKey.map(rename),
      uniques: table.uniques.map((u) => ({ ...u, columns: u.columns.map(rename) })),
      indexes: table.indexes.map((i) => ({ ...i, columns: i.columns.map(rename) })),
      // A CHECK's expression is opaque text. A column rename inside one is a
      // rewrite the database performs itself (postgres and sqlite both update
      // the stored definition), so leaving it is correct — and rewriting it
      // here by string substitution would corrupt `status in ('ordered')`.
      checks: table.checks,
    };
  });

  const relations: Relation[] = model.relations.map((relation) => {
    const from = {
      tableId: newIdOf(relation.from.tableId),
      columns: relation.from.columns.map((c) => newColumnOf(relation.from.tableId, c)),
    };
    const to = {
      tableId: newIdOf(relation.to.tableId),
      columns: relation.to.columns.map((c) => newColumnOf(relation.to.tableId, c)),
    };
    const through =
      relation.through === null
        ? null
        : {
            tableId: newIdOf(relation.through.tableId),
            fromColumns: relation.through.fromColumns.map((c) =>
              newColumnOf(relation.through!.tableId, c),
            ),
            toColumns: relation.through.toColumns.map((c) =>
              newColumnOf(relation.through!.tableId, c),
            ),
          };
    return {
      ...relation,
      // The id is derived from the endpoints, so it must be re-derived or the
      // model carries an id that describes the pre-rename shape.
      id: `${relation.kind === 'declared-fk' ? 'fk' : relation.kind}:${from.tableId}(${from.columns.join(',')})->${to.tableId}(${to.columns.join(',')})`,
      from,
      to,
      through,
      selfReferential: from.tableId === to.tableId,
    };
  });

  const enums = model.enums.map((e) => {
    // pg native enum ids are `schema.typname` and are unaffected by a table
    // rename; check/column-typed enum ids are `tableId.column` and are not.
    const [maybeTableId, column] = [e.id.slice(0, e.id.lastIndexOf('.')), e.id.slice(e.id.lastIndexOf('.') + 1)];
    if (e.source === 'native' || !tableIdMap.has(maybeTableId)) {
      if (!columnRenames.has(maybeTableId)) return e;
    }
    const newTableId = newIdOf(maybeTableId);
    const newColumn = newColumnOf(maybeTableId, column);
    return { ...e, id: `${newTableId}.${newColumn}` };
  });

  return { model: { ...model, tables, relations, enums }, applied };
}
