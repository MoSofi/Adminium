// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SQLite 12-step table rebuild.
 *
 * ─── Why a whole module for one dialect ────────────────────────────────────
 *
 * SQLite's `ALTER TABLE` supports exactly four things: `RENAME TO`,
 * `RENAME COLUMN`, `ADD COLUMN` and `DROP COLUMN`. Everything else — a type
 * change, a nullability change, a primary-key change, and **any** added or
 * dropped constraint — has no ALTER form at all. The official answer is a
 * twelve-step procedure that creates a new table, copies every row, drops the
 * old one and puts the indexes and triggers back.
 *
 * This is not a rare path. SQLite is the desktop engine, so on `@adminium/desktop`
 * it is the ONLY path for most edits.
 *
 * ─── The four steps that get skipped, and what each one costs ──────────────
 *
 * A naive implementation writes create → copy → drop → rename and stops. Each
 * omission below is silent, and each destroys something the operator had:
 *
 *   step 1  read the indexes and triggers   → they are gone after the rebuild
 *   step 8  recreate them                   → same
 *   step 9  `PRAGMA foreign_key_check`      → referential integrity is broken
 *                                             and nothing said so
 *   step 12 re-introspect and compare       → the new table silently differs
 *                                             from what the plan promised
 *
 * ─── Two ordering rules that are not interchangeable ───────────────────────
 *
 * **The pragma precedes the transaction.** `PRAGMA foreign_keys` is a NO-OP
 * inside one — SQLite's own docs say so — so a rebuild written as
 * `BEGIN; PRAGMA foreign_keys=off; …` leaves enforcement ON and the `DROP
 * TABLE` in step 6 cascades or fails.
 *
 * **Create-new-then-rename, never rename-old-first.** SQLite's documentation
 * explicitly warns that renaming the old table first "does not always work,
 * especially with the enhanced rename-table capabilities added by 3.25.0 and
 * 3.26.0": the rename rewrites foreign-key references in OTHER tables to point
 * at the temporary name, and they stay pointing there.
 *
 * ─── One route deliberately not taken ──────────────────────────────────────
 *
 * `PRAGMA writable_schema=ON` plus an `UPDATE` on `sqlite_schema` performs
 * many of these changes instantly. SQLite's own documentation describes it and
 * warns twice that it can render the database corrupt and unreadable. It is
 * faster. It is not an option.
 */
import { sql, type CompiledQuery, type Kysely } from 'kysely';
import type { TableModel } from '@adminium/engine';

import { AppError } from '../errors.js';
import { columnDefinition, quoteIdent, quoteLiteral } from './compile.js';

type Db = Kysely<Record<string, Record<string, unknown>>>;

/** The rebuild found the schema in a state it will not touch. */
export class SqliteRebuildError extends AppError {
  override readonly name = 'SqliteRebuildError';

  constructor(
    message: string,
    code: 'SCHEMA_UNPARSEABLE' | 'FK_VIOLATION' | 'REBUILD_MISMATCH' = 'SCHEMA_UNPARSEABLE',
    details?: unknown,
  ) {
    super(409, code, message, details);
  }
}

/** An index or trigger read out of `sqlite_master` in step 1. */
export interface SqliteSchemaObject {
  type: 'index' | 'trigger' | 'view';
  name: string;
  /** The original `CREATE …` text; null for auto-created indexes. */
  sql: string | null;
}

export interface RebuildInput {
  db: Db;
  /** The table as it is now. */
  actual: TableModel;
  /** The table as it should be. */
  desired: TableModel;
  /**
   * `desiredColumn → actualColumn`, for the `INSERT … SELECT`. Computed by the
   * PLANNER, not here: a type change's cast and a rename's mapping are plan
   * decisions, and recomputing them in the executor is how the two drift.
   * A desired column absent from the map is filled with its default.
   */
  columnMapping: Readonly<Record<string, string | null>>;
  /** Indexes and triggers read in step 1. */
  objects: readonly SqliteSchemaObject[];
  /** Enum value lists, for the D32 CHECK. */
  enumValues?: Readonly<Record<string, readonly string[]>> | undefined;
}

/** The temporary table name. Prefixed so a crashed rebuild is identifiable. */
export function rebuildTempName(table: string): string {
  return `adminium_rebuild_${table}`;
}

/**
 * SQL for step 1 — read every index, trigger and view attached to the table.
 *
 * Auto-created indexes (`sqlite_autoindex_*`) have a null `sql` and must NOT
 * be recreated: they are the implementation of a UNIQUE or PRIMARY KEY
 * constraint, and the new table's own constraints recreate them.
 */
export function readSchemaObjectsSql(table: string, db: Db): CompiledQuery {
  return sql
    .raw(
      `SELECT type, name, sql FROM sqlite_master ` +
        `WHERE tbl_name = ${quoteLiteral(table, 'sqlite')} ` +
        `AND type IN ('index', 'trigger', 'view') AND sql IS NOT NULL`,
    )
    .compile(db);
}

/**
 * Build the whole procedure as an ordered statement list.
 *
 * Steps 2 and 10 (`BEGIN`/`COMMIT`) are the caller's — the apply job owns the
 * transaction so it can roll the whole plan back on SQLite, which is one of
 * the two dialects that can. Steps 1 and 12 are also the caller's, because
 * both are reads whose RESULTS this function needs: step 1 is passed in as
 * `objects`, and step 12 is a re-introspection the executor performs and
 * compares.
 *
 * So what is returned here is steps 3–9 and 11: the write half, in order.
 */
export function compileSqliteRebuild(input: RebuildInput): CompiledQuery[] {
  const { db, actual, desired, columnMapping, objects } = input;
  const dialect = 'sqlite' as const;
  const raw = (text: string): CompiledQuery => sql.raw(text).compile(db);

  const oldName = actual.name;
  const newName = desired.name;
  const tempName = rebuildTempName(newName);
  const q = (n: string) => quoteIdent(n, dialect);

  const statements: CompiledQuery[] = [];

  // --- step 4: CREATE TABLE new_x (…) in the desired shape -----------------
  const columnDefs = desired.columns.map((column) => {
    const parts = [columnDefinition(column, desired, dialect)];
    const values = input.enumValues?.[column.name];
    if (values !== undefined && values.length > 0) {
      parts.push(
        `CHECK (${q(column.name)} IN (${values.map((v) => quoteLiteral(v, dialect)).join(', ')}))`,
      );
    }
    return parts.join(' ');
  });

  const tableConstraints: string[] = [];
  // SQLite's `INTEGER PRIMARY KEY` is emitted inline by `columnDefinition`;
  // any other key is a table-level constraint.
  const inlineKey =
    desired.primaryKey.length === 1 &&
    desired.columns.some(
      (c) => c.name === desired.primaryKey[0] && c.default?.kind === 'autoincrement',
    );
  if (desired.primaryKey.length > 0 && !inlineKey) {
    tableConstraints.push(`PRIMARY KEY (${desired.primaryKey.map(q).join(', ')})`);
  }
  for (const unique of desired.uniques) {
    tableConstraints.push(`UNIQUE (${unique.columns.map(q).join(', ')})`);
  }
  // Existing CHECKs pass through byte-identical (D30): a check already in the
  // snapshot is the database's own text, and re-deriving it would change it.
  for (const check of actual.checks) {
    const isEnumCheck = Object.keys(input.enumValues ?? {}).some((c) =>
      check.expression.includes(c),
    );
    if (!isEnumCheck) tableConstraints.push(`CHECK (${check.expression})`);
  }

  statements.push(
    raw(`CREATE TABLE ${q(tempName)} (\n  ${[...columnDefs, ...tableConstraints].join(',\n  ')}\n)`),
  );

  // --- step 5: INSERT INTO new_x SELECT … FROM x ---------------------------
  // Only columns that have a source are copied; a genuinely new column takes
  // its DEFAULT, which is what the plan told the operator would happen.
  const copied = desired.columns
    .map((c) => ({ to: c.name, from: columnMapping[c.name] ?? null }))
    .filter((m): m is { to: string; from: string } => m.from !== null);
  if (copied.length > 0) {
    statements.push(
      raw(
        `INSERT INTO ${q(tempName)} (${copied.map((m) => q(m.to)).join(', ')}) ` +
          `SELECT ${copied.map((m) => q(m.from)).join(', ')} FROM ${q(oldName)}`,
      ),
    );
  }

  // --- step 6: DROP TABLE x ------------------------------------------------
  statements.push(raw(`DROP TABLE ${q(oldName)}`));

  // --- step 7: ALTER TABLE new_x RENAME TO x -------------------------------
  statements.push(raw(`ALTER TABLE ${q(tempName)} RENAME TO ${q(newName)}`));

  // --- step 8: recreate indexes, triggers and views ------------------------
  // The stored `sql` text names the OLD table. After step 7 the table has its
  // final name, so a definition that referenced `oldName` is re-pointed —
  // by rebuilding the statement from the desired model where we can (indexes),
  // and by textual re-pointing only for triggers and views, whose bodies the
  // IR does not model at all.
  for (const object of objects) {
    if (object.sql === null) continue;
    if (object.type === 'index') {
      // Rebuild from the model rather than the text: a column this rebuild
      // renamed would leave the stored text naming a column that is gone.
      continue;
    }
    if (oldName !== newName && object.sql.includes(oldName)) {
      throw new SqliteRebuildError(
        `the ${object.type} "${object.name}" references ${oldName} in its body, which this ` +
          'rebuild cannot rewrite safely. Drop it, apply the change, and recreate it.',
        'SCHEMA_UNPARSEABLE',
        { object: object.name },
      );
    }
    statements.push(raw(object.sql));
  }
  for (const index of desired.indexes) {
    if (index.primary) continue;
    if (index.expression !== null) {
      // An expression index's text is not in the IR beyond the expression
      // itself; emit it as stored rather than inventing one.
      statements.push(
        raw(
          `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${q(index.name)} ` +
            `ON ${q(newName)} (${index.expression})`,
        ),
      );
      continue;
    }
    statements.push(
      raw(
        `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${q(index.name)} ` +
          `ON ${q(newName)} (${index.columns.map(q).join(', ')})`,
      ),
    );
  }

  // --- step 9: PRAGMA foreign_key_check ------------------------------------
  // Any row returned means the rebuild broke referential integrity. The caller
  // inspects the result and aborts the transaction; a rebuild that skips this
  // leaves a database that looks fine and is not.
  statements.push(raw('PRAGMA foreign_key_check'));

  return statements;
}

/**
 * The pragma statements that bracket the transaction (steps 1–2 and 11).
 * Separate from {@link compileSqliteRebuild} because they MUST run outside it —
 * see the header. The caller runs `before` outside any transaction, then
 * `BEGIN`, then the rebuild, then `COMMIT`, then `after`.
 */
export const REBUILD_PRAGMAS = {
  before: 'PRAGMA foreign_keys = off',
  after: 'PRAGMA foreign_keys = on',
} as const;

/**
 * Compare the rebuilt table against what was asked for — step 12, and the one
 * that turns "it ran" into "it is what the plan promised".
 *
 * This is the assertion shape `sqlite-ddl.ts:13-14` established for its emitter
 * (emit → apply → introspect → compare); applying it to the rebuild is what
 * makes a silently-lost index or constraint a failure rather than a surprise
 * three weeks later.
 */
export function assertRebuildMatches(rebuilt: TableModel, desired: TableModel): void {
  const differences: string[] = [];

  const rebuiltColumns = new Map(rebuilt.columns.map((c) => [c.name, c]));
  for (const want of desired.columns) {
    const got = rebuiltColumns.get(want.name);
    if (got === undefined) {
      differences.push(`column ${want.name} is missing`);
      continue;
    }
    if (got.logicalType !== want.logicalType) {
      differences.push(`column ${want.name} is ${got.logicalType}, expected ${want.logicalType}`);
    }
    if (got.nullable !== want.nullable) {
      differences.push(
        `column ${want.name} is ${got.nullable ? 'nullable' : 'NOT NULL'}, expected the opposite`,
      );
    }
  }
  for (const got of rebuilt.columns) {
    if (!desired.columns.some((c) => c.name === got.name)) {
      differences.push(`column ${got.name} should not exist`);
    }
  }

  const wantKey = desired.primaryKey.join(',');
  const gotKey = rebuilt.primaryKey.join(',');
  if (wantKey !== gotKey) {
    differences.push(`primary key is (${gotKey}), expected (${wantKey})`);
  }

  const wantIndexes = new Set(desired.indexes.filter((i) => !i.primary).map((i) => i.name));
  const gotIndexes = new Set(rebuilt.indexes.filter((i) => !i.primary).map((i) => i.name));
  for (const name of wantIndexes) {
    if (!gotIndexes.has(name)) differences.push(`index ${name} was not recreated`);
  }

  if (differences.length > 0) {
    throw new SqliteRebuildError(
      `the rebuilt table does not match the plan: ${differences.join('; ')}`,
      'REBUILD_MISMATCH',
      { differences },
    );
  }
}

/**
 * Turn `PRAGMA foreign_key_check`'s rows into a refusal.
 *
 * The pragma returns one row per violating row: `(table, rowid, parent,
 * fkid)`. An empty result is the only acceptable outcome.
 */
export function assertNoForeignKeyViolations(rows: readonly unknown[]): void {
  if (rows.length === 0) return;
  throw new SqliteRebuildError(
    `the rebuild would leave ${rows.length} row${rows.length === 1 ? '' : 's'} violating a ` +
      'foreign key, so it was rolled back',
    'FK_VIOLATION',
    { violations: rows.length },
  );
}

// ---------------------------------------------------------------------------
// Running the procedure
// ---------------------------------------------------------------------------

/**
 * Execute the twelve-step rebuild.
 *
 * ─── Why this function had to exist ────────────────────────────────────────
 *
 * Everything above was written, tested and never called. The planner emitted
 * `rebuild-table`, `compileStep` threw for that kind on purpose ("compiled by
 * the SQLite rebuild module, not here"), and the plan service caught the throw
 * and returned NO statements. The apply loop then iterated an empty statement
 * list and recorded the step as **succeeded**.
 *
 * So on SQLite — the desktop engine, where nearly every change that is not
 * "add a column" is a rebuild — a type change, a nullability change, a primary
 * key change or any added constraint reported success and did nothing at all.
 * A silent no-op reported as applied is the worst failure this wave can have,
 * and it passed every test because each half was tested in isolation.
 *
 * ─── The transaction boundary is the caller's, and it is not negotiable ────
 *
 * `PRAGMA foreign_keys` is a no-op inside a transaction, so it brackets the
 * transaction rather than living in it. The order below is the documented one
 * and the comments in `compileSqliteRebuild` say why each step is where it is.
 */
export interface RunRebuildInput {
  db: Db;
  actual: TableModel;
  desired: TableModel;
  columnMapping: Readonly<Record<string, string | null>>;
  enumValues?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Re-introspect the rebuilt table for step 12; skipped when absent. */
  reintrospect?: ((tableId: string) => Promise<TableModel | null>) | undefined;
}

export async function runSqliteRebuild(input: RunRebuildInput): Promise<void> {
  const { db, actual, desired } = input;
  const run = async (text: string): Promise<readonly unknown[]> => {
    const result = await db.executeQuery(
      { sql: text, parameters: [], query: { kind: 'RawNode' } } as never,
    );
    return (result as { rows?: readonly unknown[] }).rows ?? [];
  };

  // Step 1: the indexes and triggers that must come back afterwards. Skipping
  // this is how a rebuild silently drops them.
  const objects = (await run(readSchemaObjectsSql(actual.name, db).sql)) as SqliteSchemaObject[];

  // Steps 2 and 11 bracket the transaction — the pragma is inert inside one.
  await run(REBUILD_PRAGMAS.before);
  try {
    await run('BEGIN');
    try {
      for (const query of compileSqliteRebuild({
        db,
        actual,
        desired,
        columnMapping: input.columnMapping,
        objects,
        enumValues: input.enumValues,
      })) {
        const rows = await run(query.sql);
        // Step 9's result is the point of step 9. `PRAGMA foreign_key_check`
        // returns one row per violating row and an empty result is the only
        // acceptable outcome; ignoring it leaves a database that looks fine.
        if (query.sql === 'PRAGMA foreign_key_check') assertNoForeignKeyViolations(rows);
      }
      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await run(REBUILD_PRAGMAS.after).catch(() => undefined);
  }

  // Step 12: what came out must be what the plan promised.
  if (input.reintrospect !== undefined) {
    const rebuilt = await input.reintrospect(desired.id);
    if (rebuilt !== null) assertRebuildMatches(rebuilt, desired);
  }
}

/**
 * `desiredColumn → actualColumn` for the `INSERT … SELECT`.
 *
 * Computed from the two models plus the rename map: a column present on both
 * sides copies from itself, a renamed one copies from its old name, and a
 * genuinely new column is absent from the map so it takes its default. The
 * PLANNER owns this rather than the executor — a type change's cast is a plan
 * decision, and recomputing it on the other side is how the two drift.
 */
export function rebuildColumnMapping(
  actual: TableModel,
  desired: TableModel,
  renames: Readonly<Record<string, string>> = {},
): Record<string, string | null> {
  const actualNames = new Set(actual.columns.map((c) => c.name));
  const oldNameOf = new Map(Object.entries(renames).map(([from, to]) => [to, from]));
  const mapping: Record<string, string | null> = {};
  for (const column of desired.columns) {
    const source = oldNameOf.get(column.name) ?? column.name;
    mapping[column.name] = actualNames.has(source) ? source : null;
  }
  return mapping;
}
