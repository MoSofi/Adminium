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
import { enumCheckColumn, type Relation, type TableModel } from '@adminium/engine';

import { AppError } from '../errors.js';
import { columnDefinition, fkAction, quoteIdent, quoteLiteral } from './compile.js';

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
  /**
   * The table's DESIRED foreign keys — the planner's `desiredRelations` for
   * this table, so a link the operator removed is absent and every other one
   * is carried through.
   *
   * They have to be passed in because the `TableModel` does not hold them:
   * links live in `DatabaseModel.relations`. Without this the new table was
   * created with no `REFERENCES` at all and every rebuild silently dropped
   * every link the table had.
   *
   * REQUIRED, and `[]` when the table has none: an optional field is how a
   * caller forgets it, and nothing downstream can tell a forgotten list from
   * an operator who removed every link. Step 12 cannot either — a
   * `TableModel` has no foreign keys to compare.
   */
  foreignKeys: readonly Relation[];
  /**
   * The table's own `CREATE TABLE` text, read in step 1. It shows a collation
   * or an `ON CONFLICT` the model cannot carry, which the rebuild then refuses
   * to lose (`refuseWhatCannotBeCarried`). Absent: not checked.
   */
  tableSql?: string | null | undefined;
}

/**
 * Whether an index is one SQLite created itself for a UNIQUE or PRIMARY KEY
 * constraint. SQLite reserves the prefix: `CREATE INDEX sqlite_autoindex_…`
 * fails with "object name reserved for internal use".
 */
export function isSqliteAutoIndex(name: string): boolean {
  return name.startsWith('sqlite_autoindex_');
}

/** One identifier as SQLite spells it: bare, or quoted any of its three ways. */
const IDENT = String.raw`(?:"(?:[^"]|"")+"|\x60[^\x60]+\x60|\[[^\]]+\]|[A-Za-z_][\w$]*)`;

function unquote(name: string): string {
  if (name.startsWith('"')) return name.slice(1, -1).replaceAll('""', '"');
  if (name.startsWith('`') || name.startsWith('[')) return name.slice(1, -1);
  return name;
}

/**
 * The columns of a stored `CREATE INDEX` that is nothing but a list of plain
 * columns — or null when it says more: a `WHERE`, an expression, an order, a
 * collation. Only the first kind can be written again from the model.
 */
export function plainIndexColumns(text: string): string[] | null {
  const match = new RegExp(
    String.raw`^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}(?:\s*\.\s*${IDENT})?\s+ON\s+${IDENT}\s*\(([^()]*)\)\s*;?\s*$`,
    'i',
  ).exec(text);
  if (match === null) return null;
  const columns: string[] = [];
  for (const part of match[1]!.split(',')) {
    const one = new RegExp(String.raw`^\s*(${IDENT})\s*$`).exec(part);
    if (one === null) return null;
    columns.push(unquote(one[1]!));
  }
  return columns;
}

/** Whether SQL text names a column, as a whole identifier in any spelling (SQLite ignores case). */
function namesIdentifier(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spellings = [`"${escaped.replaceAll('"', '""')}"`, `\`${escaped}\``, String.raw`\[${escaped}\]`, escaped];
  return new RegExp(String.raw`(^|[^\w$])(${spellings.join('|')})(?![\w$])`, 'i').test(text);
}

/**
 * SQL text with its string literals and everything inside parentheses blanked
 * to spaces, so what is left is what stands at the top of one definition.
 */
function topLevel(text: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length - 1 : end;
      out += ' '.repeat(stop - i + 1);
      i = stop;
      continue;
    }
    if (ch === '(') depth += 1;
    out += depth > 0 ? ' ' : ch;
    if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return out;
}

/** The definitions between a CREATE TABLE's outer parentheses, split at their top-level commas. */
function tableDefinitions(createSql: string): string[] {
  const open = createSql.indexOf('(');
  if (open === -1) return [];
  const parts: string[] = [];
  let depth = 0;
  let start = open + 1;
  let quote: string | null = null;
  for (let i = open + 1; i < createSql.length; i += 1) {
    const ch = createSql[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') quote = ']';
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) {
        parts.push(createSql.slice(start, i));
        break;
      }
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      parts.push(createSql.slice(start, i));
      start = i + 1;
    }
  }
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * Refuse a rebuild that would quietly change how the table compares or
 * resolves, because the model has no words for it: a column's collation other
 * than BINARY (`COLLATE NOCASE` makes "A" and "a" one value, and a unique on
 * that column says so), and an `ON CONFLICT` other than the default ABORT (a
 * unique that REPLACEs the row it clashes with). Written back from the model,
 * the table would compare case by case and fail where it used to replace —
 * and step 12 could not see it. Only columns the rebuild copies count: one it
 * drops takes its rules with it.
 */
export function refuseWhatCannotBeCarried(createSql: string, copied: ReadonlySet<string>): void {
  const constraintHead = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i;
  const collate = new RegExp(String.raw`\bCOLLATE\s+(${IDENT})`, 'gi');
  const conflict = /\bON\s+CONFLICT\s+(ROLLBACK|ABORT|FAIL|IGNORE|REPLACE)\b/i;
  const copiedAs = (name: string): string | undefined => [...copied].find((c) => c.toLowerCase() === name.toLowerCase());
  const refuse = (column: string, what: string, rebuilt: string): never => {
    throw new SqliteRebuildError(
      `the column "${column}" has ${what}, which this change cannot keep: SQLite makes the change by rebuilding the table, ` +
        `and rebuilt, ${rebuilt}. Change this table outside Adminium, or take the ${what.startsWith('COLLATE') ? 'collation' : 'clause'} off first.`,
      'SCHEMA_UNPARSEABLE',
      { column },
    );
  };
  const checkCollation = (column: string, text: string): void => {
    for (const found of text.matchAll(collate)) {
      const name = unquote(found[1]!).toUpperCase();
      if (name === 'BINARY') continue;
      refuse(
        column,
        `COLLATE ${name}`,
        `"${column}" would compare byte by byte instead` + (name === 'NOCASE' ? ': "A" and "a" would be two values, and a unique on it would let both in' : ''),
      );
    }
  };
  const checkConflict = (column: string, text: string): void => {
    const resolution = conflict.exec(text)?.[1]?.toUpperCase();
    if (resolution === undefined || resolution === 'ABORT') return;
    const was = resolution === 'REPLACE' ? 'replacing the row it clashes with' : resolution === 'IGNORE' ? 'being passed over' : `being handled by ${resolution}`;
    refuse(column, `ON CONFLICT ${resolution}`, `a row that clashes on "${column}" would be refused instead of ${was}`);
  };

  for (const definition of tableDefinitions(createSql)) {
    if (constraintHead.test(definition)) {
      // A table constraint: its columns are the ones in its own parentheses.
      const inner = /\(([^()]*)\)/.exec(definition)?.[1] ?? '';
      const column = inner
        .split(',')
        .map((part) => new RegExp(String.raw`^\s*(${IDENT})`).exec(part)?.[1])
        .filter((name): name is string => name !== undefined)
        .map((name) => copiedAs(unquote(name)))
        .find((name) => name !== undefined);
      if (column === undefined) continue;
      checkCollation(column, inner);
      checkConflict(column, topLevel(definition));
      continue;
    }
    const head = new RegExp(String.raw`^(${IDENT})`).exec(definition)?.[1];
    const column = head === undefined ? undefined : copiedAs(unquote(head));
    if (column === undefined) continue;
    const rest = topLevel(definition.slice(head!.length));
    checkCollation(column, rest);
    checkConflict(column, rest);
  }
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

/** SQL for the rest of step 1 — the table's own `CREATE TABLE` text. */
export function readTableSql(table: string, db: Db): CompiledQuery {
  return sql
    .raw(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${quoteLiteral(table, 'sqlite')}`)
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

  /*
   * The columns this rebuild copies under their own name. One it drops or
   * renames is one an index's stored text can no longer be trusted to name.
   */
  const kept = new Set(
    actual.columns.map((c) => c.name).filter((name) => columnMapping[name] === name),
  );
  if (input.tableSql !== undefined && input.tableSql !== null) {
    // Copied at all, under any name: its rows come across, its collation would not.
    const copiedFrom = new Set(Object.values(columnMapping).filter((from): from is string => from !== null));
    refuseWhatCannotBeCarried(input.tableSql, copiedFrom);
  }

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
  /*
   * `uniques` is the one source of a UNIQUE constraint. The index SQLite made
   * for one (`sqlite_autoindex_…`) is never read as one: the designer leaves
   * it in the index list when a unique is turned off, and a rebuild that made
   * the constraint back from it reported the change applied with the column
   * still unique.
   */
  for (const unique of desired.uniques) {
    tableConstraints.push(`UNIQUE (${unique.columns.map(q).join(', ')})`);
  }
  /*
   * The links, as table constraints. SQLite has no `ADD CONSTRAINT`, so the
   * CREATE in this step is the only place a foreign key can exist at all — one
   * left out here is gone for good.
   *
   * `CONSTRAINT <name>` only when the link has one: SQLite's catalog does not
   * report FK names, so an introspected link comes back `null`, and inventing
   * one would change the table's text for no reason. The target is the bare
   * name — SQLite resolves it within the same database, and a self-reference
   * to a renamed table already carries the NEW id from the renamed model.
   */
  for (const fk of input.foreignKeys) {
    if (fk.kind !== 'declared-fk') continue;
    const target = fk.to.tableId.slice(fk.to.tableId.lastIndexOf('.') + 1);
    tableConstraints.push(
      (fk.constraintName === null ? '' : `CONSTRAINT ${q(fk.constraintName)} `) +
        `FOREIGN KEY (${fk.from.columns.map(q).join(', ')}) ` +
        `REFERENCES ${q(target)} (${fk.to.columns.map(q).join(', ')})` +
        (fk.onDelete === null ? '' : ` ON DELETE ${fkAction(fk.onDelete)}`) +
        (fk.onUpdate === null ? '' : ` ON UPDATE ${fkAction(fk.onUpdate)}`),
    );
  }

  // Existing CHECKs pass through byte-identical (D30): a check already in the
  // snapshot is the database's own text, and re-deriving it would change it.
  for (const check of actual.checks) {
    /*
     * Which old CHECKs the desired enum lists REPLACE, and which are the
     * database's own business.
     *
     * `expression.includes(columnName)` was too generous in both directions: a
     * check on `status_id` was dropped because "status" is a substring of it,
     * and so was any unrelated rule that happened to mention an enum column
     * (`status <> 'void' OR amount > 0`) — silently, during a rebuild that
     * promised to carry existing checks through. The replacement asks the two
     * questions separately: does the check NAME one of the columns whose values
     * are being restated, and is it a membership test rather than some other
     * rule.
     */
    const named = enumCheckColumn(check.expression, Object.keys(input.enumValues ?? {}));
    const isMembership = /\bin\s*\(|=\s*any/i.test(check.expression);
    if (named === null || !isMembership) tableConstraints.push(`CHECK (${check.expression})`);
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
      // Re-made below, from the desired model: a column this rebuild renamed
      // would leave the stored text naming a column that is gone. Only an
      // index the model cannot describe is re-made from its text, and only
      // while that text still holds.
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
    // Made by the new table's own UNIQUE constraint in step 4, under a name
    // SQLite refuses to let anyone else create.
    if (isSqliteAutoIndex(index.name)) continue;
    /*
     * An index already there says in its stored text what the model cannot:
     * a `WHERE` (a unique only among the live rows), an expression
     * (`lower(email)`), an order or a collation. Introspection reads such an
     * index as its plain columns, or none, so one re-made from the model came
     * back covering every row — or could not be written at all. So it is
     * re-made from its own text while the text still holds: the table keeps
     * its name, and every column the text names is copied under its own. An
     * index that is nothing but plain columns is re-made from the model as
     * before, which follows a renamed column.
     */
    const stored = objects.find((o) => o.type === 'index' && o.name === index.name && o.sql !== null);
    if (stored !== undefined && plainIndexColumns(stored.sql!) === null) {
      const before = actual.indexes.find((i) => i.name === index.name);
      const unchanged =
        before !== undefined && before.unique === index.unique && before.columns.join('\u0000') === index.columns.join('\u0000');
      const touched = actual.columns.map((c) => c.name).find((name) => !kept.has(name) && namesIdentifier(stored.sql!, name));
      if (oldName !== newName || !unchanged || touched !== undefined) {
        throw new SqliteRebuildError(
          `the index "${index.name}" ${touched === undefined ? 'says more than a plain list of columns' : `reads "${touched}", which this change drops or renames, and says more than a plain list of columns`} ` +
            `(${stored.sql!.trim()}), so this rebuild cannot re-create it as it was. Drop the index, apply the change, and create it again.`,
          'SCHEMA_UNPARSEABLE',
          { object: index.name, ...(touched === undefined ? {} : { column: touched }) },
        );
      }
      statements.push(raw(stored.sql!));
      continue;
    }
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

  /*
   * SQLite's own indexes are compared as the constraints they stand for, from
   * `uniques` alone — never as index names, which SQLite numbers in the order
   * the constraints are written. A unique asked for must be there, as a unique
   * index on the same columns over every row (not a partial one); a unique
   * that was not asked for must not be — a unique turned off that came back is
   * a change that did not happen.
   */
  const gotIndexes = rebuilt.indexes.filter((i) => !i.primary);
  const sameColumns = (a: readonly string[], b: readonly string[]) => a.join('\u0000') === b.join('\u0000');
  for (const want of desired.indexes) {
    if (want.primary || isSqliteAutoIndex(want.name)) continue;
    if (!gotIndexes.some((got) => got.name === want.name)) differences.push(`index ${want.name} was not recreated`);
  }
  for (const want of desired.uniques) {
    const found = gotIndexes.some((got) => got.unique && !got.partial && sameColumns(got.columns, want.columns));
    if (!found) differences.push(`the unique on (${want.columns.join(', ')}) was not recreated`);
  }
  for (const got of rebuilt.uniques) {
    if (!desired.uniques.some((want) => sameColumns(want.columns, got.columns))) {
      differences.push(`a unique on (${got.columns.join(', ')}) is there, and was not asked for`);
    }
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
  /** The table's desired foreign keys — see {@link RebuildInput.foreignKeys}. */
  foreignKeys: readonly Relation[];
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
  // …and the table's own text, for what the model cannot say about it.
  const [table] = (await run(readTableSql(actual.name, db).sql)) as { sql: string | null }[];

  // Compiled before anything runs: a rebuild that refuses leaves the table untouched.
  const statements = compileSqliteRebuild({
    db,
    actual,
    desired,
    columnMapping: input.columnMapping,
    objects,
    enumValues: input.enumValues,
    foreignKeys: input.foreignKeys,
    tableSql: table?.sql ?? null,
  });

  // Steps 2 and 11 bracket the transaction — the pragma is inert inside one.
  await run(REBUILD_PRAGMAS.before);
  try {
    await run('BEGIN');
    try {
      for (const query of statements) {
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
