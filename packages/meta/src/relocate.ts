/**
 * Whole-store copy, for moving a meta store from one database to another
 * (07-meta-store.md §1; 01-architecture.md §3.1 meta placement).
 *
 * ── WHY THIS IS NOT `export-zip` / `import-zip` ─────────────────────────────
 * The export bundle carries CONFIGURATION — settings, roles, rolePermissions,
 * connections, snapshots, overrides, pages, views. Eight resources out of the
 * thirty-four tables in {@link META_TABLE_NAMES}. That is the right content for
 * "replay this instance's setup somewhere else", and exactly the wrong content
 * for "this instance is now living in a different database": it carries no
 * users, no sessions and no user_roles, so a relocation built on it would log
 * the operator out of the wizard they are standing in and strand the instance
 * with no accounts at all. Relocation is a MOVE, not a replay, and a move has
 * to be total.
 *
 * ── DIALECT PORTABILITY, AND WHY COERCION IS DRIVEN BY THE TARGET ───────────
 * `columns.ts` maps one logical type onto three physical ones — `bool` is a
 * postgres `boolean`, a mysql `tinyint(1)` and a sqlite `integer`; `json` is
 * `jsonb`, `json` and `text`. So a value read from one dialect is not always a
 * value the next dialect's driver will accept. SQLite hands back `0`/`1` where
 * postgres wants a boolean, and `pg` hands back a parsed object where
 * better-sqlite3 accepts only numbers, strings, bigints, buffers and null.
 *
 * Some of those mismatches happen to survive on their own — postgres will cast
 * the text `'1'` to `boolean`, so sqlite → postgres appears to work untouched.
 * Relying on that is how a copy engine ends up correct in exactly the direction
 * it was first tested in. The coercion below is therefore driven by what the
 * TARGET's columns actually are, read back with Kysely's introspection, so
 * every direction is handled by the same rule rather than by luck.
 *
 * `ts` columns need no handling at all, which removes the worst class of
 * cross-dialect bug before it starts: §2.1 pins every timestamp to epoch
 * milliseconds in an integer column, so nothing here ever touches a native
 * date.
 *
 * ── ATOMICITY ───────────────────────────────────────────────────────────────
 * The whole copy runs in ONE transaction on the target. A relocation that
 * failed halfway would otherwise leave a half-populated store that the next
 * boot cannot tell from a real one; rolling back means the target is either
 * fully written or untouched, and the caller can keep pointing at the source.
 */

import { sql, type Kysely, type Transaction } from 'kysely';

import type { MetaDb } from './connect.js';
import { assertMetaTable } from './prefix.js';
import { writeBool } from './repos/util.js';
import { META_TABLE_NAMES, type MetaDB } from './schema/tables.js';

/**
 * The migration ledger is never copied. The target builds its own by running
 * the migrations, and that ledger — not the source's — is the honest record of
 * what has been applied to THIS database. Copying the source's on top would at
 * best be a no-op and at worst re-assert checksums for DDL the target reached
 * by a different route.
 */
export const RELOCATE_SKIP_TABLES: readonly string[] = ['adminium_migrations'];

/**
 * Parameters per INSERT. PostgreSQL's wire protocol caps a statement at 65535
 * bound parameters; MySQL's practical limit is `max_allowed_packet` rather than
 * a count. 20000 clears both with room to spare and still keeps the number of
 * round-trips low.
 */
const MAX_BOUND_PARAMETERS = 20_000;

/**
 * Rows in a single table beyond which this refuses to run. Each table is read
 * whole — bounded by the LARGEST table, not by the store — which is right for
 * the wizard-time relocation this exists to serve, where the store is minutes
 * old. An instance with a year of `adminium_audit_log` behind it is a different
 * problem, and it deserves an error that says so rather than an OOM.
 */
const MAX_ROWS_PER_TABLE = 500_000;

/**
 * `name` is typed `string`, not narrowed to the literal, precisely so the
 * subclasses below (and the server's, which extend this across the package
 * boundary) can each declare their own — a literal here makes every `override
 * readonly name` in a subclass a type error.
 */
export class MetaRelocateError extends Error {
  override readonly name: string = 'MetaRelocateError';
}

/** The target already holds Adminium data — refuse rather than merge into it. */
export class MetaStoreNotEmptyError extends MetaRelocateError {
  override readonly name = 'MetaStoreNotEmptyError';
  constructor(readonly tables: readonly string[]) {
    super(
      `The target database already contains Adminium data (${tables.join(', ')}). ` +
        'Relocation copies a whole store and will not merge into an existing one — ' +
        'point it at a database with no adminium_ tables, or drop them first.',
    );
  }
}

/** A table came out the other side with a different number of rows. */
export class MetaCopyVerificationError extends MetaRelocateError {
  override readonly name = 'MetaCopyVerificationError';
  constructor(readonly table: string, readonly expected: number, readonly actual: number) {
    super(
      `Copy verification failed for ${table}: expected ${String(expected)} row(s), ` +
        `found ${String(actual)}. The target was rolled back and the source is unchanged.`,
    );
  }
}

/** The tables this copies, in FK-safe insert order. */
export function relocatableTables(): readonly string[] {
  return META_TABLE_NAMES.filter((name) => !RELOCATE_SKIP_TABLES.includes(name));
}

/**
 * Kysely's `CamelCasePlugin` maps COLUMN names, so every row this module reads
 * and writes is camelCase — but `introspection.getTables()` reports the
 * PHYSICAL names, which are snake_case. This is that bridge, and it matches the
 * plugin's own default transform: split on underscores, capitalize each
 * subsequent segment.
 */
export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

type Coercion = 'jsonEncode' | 'boolean' | 'passthrough';

/** What a physical column IS, before either side's needs are considered. */
type ColumnKind = 'json' | 'boolean' | 'other';

/**
 * Classify one physical column. Matched on the data type introspection reports
 * rather than on a dialect check, so a type this does not recognise falls
 * through untouched instead of being mangled.
 *
 * SQLite is invisible here by design: `columns.ts` stores its `bool` as
 * `integer` and its `json` as `text`, neither of which is distinguishable from
 * a genuine int or a genuine string. That is exactly why {@link planColumns}
 * merges BOTH sides — sqlite's shape is recovered from whatever the other end
 * declares.
 */
function kindOf(dataType: string): ColumnKind {
  const type = dataType.toLowerCase();
  if (type === 'json' || type === 'jsonb') return 'json';
  // postgres `bool`/`boolean`; mysql `tinyint`/`tinyint(1)`.
  if (type === 'bool' || type === 'boolean') return 'boolean';
  if (type.startsWith('tinyint')) return 'boolean';
  return 'other';
}

/**
 * One value, made acceptable to `to`'s driver.
 *
 * ── JSON IS CHECKED FIRST, AND THAT ORDER IS THE WHOLE BUG ──────────────────
 * A JSON column can legitimately hold a bare `false` — `settings.value` for
 * `telemetry.enabled` is exactly that. Postgres and MySQL decode it to a JS
 * boolean, so a boolean branch that ran first would hand it to `writeBool` and
 * insert `false`/`0` into a `jsonb` column, which postgres rejects outright
 * ("invalid input syntax for type json"). Payload shape wins over value shape.
 *
 * ── THE BOOLEAN BRANCH NEEDS BOTH ITS HALVES ────────────────────────────────
 * The two dialects fail in opposite directions and neither failure is
 * theoretical (`repos/util.ts`: "better-sqlite3 refuses to bind booleans; PG
 * refuses numbers for boolean columns"):
 *
 *  - sqlite → postgres. SQLite stores `bool` as `integer`, so the value is
 *    `0`/`1` and the target column is `bool`. Caught by the column kind.
 *  - postgres → sqlite. `pg` decodes `bool` to a JS boolean, and the target
 *    column is a plain `integer` indistinguishable from a real int column.
 *    Caught only by the value's own type.
 *
 * `writeBool` is reused rather than restated so the dialect rule has exactly
 * one definition in this package.
 */
function coerce(value: unknown, coercion: Coercion, to: MetaDb): unknown {
  if (value === null || value === undefined) return null;
  if (coercion === 'jsonEncode') {
    // The source column was json-NATIVE, so the driver already decoded it and
    // the characters have to be put back — including for strings, which is the
    // case that looks safe and is not. `repos/util.ts` spells out why: a stored
    // `"violet"` arrives as the JS string `violet`, which is not parseable
    // JSON. Passing it straight to a jsonb column is "invalid input syntax for
    // type json"; re-encoding it yields `"violet"` again.
    return JSON.stringify(value);
  }
  if (coercion === 'boolean' || typeof value === 'boolean') {
    return writeBool(to, truthy(value));
  }
  if (typeof value === 'object' && !isBinary(value)) {
    // An object reaching a non-json column means the two sides disagree about
    // that column's shape. Serializing is the only lossless option — buffers
    // are left alone, being the one non-plain object a driver legitimately
    // produces.
    return JSON.stringify(value);
  }
  return value;
}

/** Every shape the three drivers hand back for a boolean column. */
function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '' && value !== '0' && value !== 'false';
  return Boolean(value);
}

function isBinary(value: object): boolean {
  return value instanceof Uint8Array || ArrayBuffer.isView(value);
}

/** camelCase column name → the coercion that column needs. */
type ColumnPlan = ReadonlyMap<string, Coercion>;

async function introspectKinds(meta: MetaDb): Promise<Map<string, Map<string, ColumnKind>>> {
  const tables = await meta.db.introspection.getTables();
  const kinds = new Map<string, Map<string, ColumnKind>>();
  for (const table of tables) {
    if (!table.name.startsWith('adminium_')) continue;
    const columns = new Map<string, ColumnKind>();
    for (const column of table.columns) {
      columns.set(snakeToCamel(column.name), kindOf(column.dataType));
    }
    kinds.set(table.name, columns);
  }
  return kinds;
}

/**
 * Merge what each end declares into one coercion per column.
 *
 * BOTH ends are read because SQLite cannot describe itself: its `bool` is an
 * `integer` and its `json` is `text`, so a sqlite→sqlite copy learns nothing
 * from introspection (correctly — passthrough is right when both ends store the
 * same physical shape), while sqlite↔postgres recovers the logical type from
 * whichever end is not sqlite. A column is treated as JSON if EITHER side calls
 * it JSON, which is what stops a decoded payload being re-encoded as SQL.
 *
 * The target's column set is authoritative: a column the target does not have
 * is absent from the plan, and {@link writeTable} drops it.
 */
function planColumns(
  source: Map<string, Map<string, ColumnKind>>,
  target: Map<string, Map<string, ColumnKind>>,
): Map<string, ColumnPlan> {
  const plan = new Map<string, ColumnPlan>();
  for (const [table, targetColumns] of target) {
    const sourceColumns = source.get(table);
    const columns = new Map<string, Coercion>();
    for (const [column, targetKind] of targetColumns) {
      const sourceKind = sourceColumns?.get(column) ?? 'other';
      if (targetKind === 'json' || sourceKind === 'json') {
        // For a JSON column the SOURCE decides the work, not the target: a
        // json-native source hands back a decoded value that must be re-encoded,
        // while a sqlite `text` source hands back serialized characters that
        // every target accepts as-is (postgres and mysql both cast JSON text
        // into the column). What the target is only matters for spotting that
        // the column is JSON at all.
        columns.set(column, sourceKind === 'json' ? 'jsonEncode' : 'passthrough');
      } else if (targetKind === 'boolean') columns.set(column, 'boolean');
      // Not `sourceKind === 'boolean'`: a boolean arriving at a sqlite integer
      // column is caught by value in `coerce`, and asserting it here would also
      // catch the genuine ints that share that physical type.
      else columns.set(column, 'passthrough');
    }
    plan.set(table, columns);
  }
  return plan;
}

/** `count(*)` for one table, as a number on every dialect. */
async function countRows(db: Kysely<MetaDB>, table: string): Promise<number> {
  assertMetaTable(table);
  const row = await db
    .selectFrom(table as keyof MetaDB)
    .select(sql<number | string>`count(*)`.as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/**
 * Row counts for every relocatable table. Used both to size the copy up front
 * and to verify it afterwards.
 */
export async function countMetaRows(meta: MetaDb): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of relocatableTables()) {
    counts.set(table, await countRows(meta.db, table));
  }
  return counts;
}

/**
 * Throw unless the store holds no Adminium data. Called against the TARGET
 * before anything is written, so "already in use" is a refusal rather than a
 * primary-key collision halfway through the copy.
 */
export async function assertMetaStoreEmpty(meta: MetaDb): Promise<void> {
  const counts = await countMetaRows(meta);
  const occupied = [...counts.entries()].filter(([, count]) => count > 0).map(([table]) => table);
  if (occupied.length > 0) throw new MetaStoreNotEmptyError(occupied);
}

export interface CopyMetaStoreOptions {
  from: MetaDb;
  /** Must already be migrated — run `applyMigrations` before calling. */
  to: MetaDb;
  /** Per-table progress, for a CLI spinner or a wizard's status line. */
  onProgress?: ((table: string, rows: number) => void) | undefined;
}

export interface CopyMetaStoreResult {
  tables: { table: string; rows: number }[];
  totalRows: number;
}

/**
 * Copy every `adminium_*` table from `from` to `to`, in one transaction.
 *
 * The target must be migrated and empty ({@link assertMetaStoreEmpty}). Insert
 * order is {@link META_TABLE_NAMES}, which is declared in dependency-safe
 * creation order and is therefore also FK-safe for inserts — so this needs no
 * constraint juggling on any of the three dialects.
 */
export async function copyMetaStore(opts: CopyMetaStoreOptions): Promise<CopyMetaStoreResult> {
  const { from, to } = opts;
  const sourceCounts = await countMetaRows(from);

  for (const [table, count] of sourceCounts) {
    if (count > MAX_ROWS_PER_TABLE) {
      throw new MetaRelocateError(
        `${table} holds ${String(count)} rows, more than this can move in one pass ` +
          `(${String(MAX_ROWS_PER_TABLE)}). Relocate with the database's own dump/restore tools instead.`,
      );
    }
  }

  const plan = planColumns(await introspectKinds(from), await introspectKinds(to));
  const tables: { table: string; rows: number }[] = [];

  await to.db.transaction().execute(async (trx) => {
    for (const table of relocatableTables()) {
      const expected = sourceCounts.get(table) ?? 0;
      if (expected === 0) {
        tables.push({ table, rows: 0 });
        opts.onProgress?.(table, 0);
        continue;
      }
      const rows = await readTable(from, table);
      const written = await writeTable(trx, to, table, rows, plan.get(table));
      if (written !== expected) throw new MetaCopyVerificationError(table, expected, written);
      tables.push({ table, rows: written });
      opts.onProgress?.(table, written);
    }
  });

  // Verified OUTSIDE the transaction, against committed state: a count taken
  // inside it would be reading back this transaction's own uncommitted writes,
  // which proves nothing about what survived the commit.
  for (const { table, rows } of tables) {
    const actual = await countRows(to.db, table);
    if (actual !== rows) throw new MetaCopyVerificationError(table, rows, actual);
  }

  return { tables, totalRows: tables.reduce((sum, entry) => sum + entry.rows, 0) };
}

async function readTable(from: MetaDb, table: string): Promise<Record<string, unknown>[]> {
  assertMetaTable(table);
  const rows = await from.db
    .selectFrom(table as keyof MetaDB)
    .selectAll()
    .execute();
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Insert `rows` into `table`, chunked so no single statement outruns the
 * driver's bound-parameter ceiling. Columns the TARGET does not have are
 * dropped rather than sent — a source one migration ahead of the target would
 * otherwise fail on an unknown column instead of copying what does line up.
 */
async function writeTable(
  trx: Transaction<MetaDB>,
  to: MetaDb,
  table: string,
  rows: readonly Record<string, unknown>[],
  columnPlan: ColumnPlan | undefined,
): Promise<number> {
  assertMetaTable(table);
  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0] as Record<string, unknown>).filter(
    (column) => columnPlan === undefined || columnPlan.has(column),
  );
  if (columns.length === 0) {
    throw new MetaRelocateError(`No columns in common for ${table} — source and target disagree.`);
  }

  const perChunk = Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / columns.length));
  let written = 0;

  for (let offset = 0; offset < rows.length; offset += perChunk) {
    const chunk = rows.slice(offset, offset + perChunk).map((row) => {
      const out: Record<string, unknown> = {};
      for (const column of columns) {
        out[column] = coerce(row[column], columnPlan?.get(column) ?? 'passthrough', to);
      }
      return out;
    });
    await trx
      // The table name is a runtime value from META_TABLE_NAMES and the rows are
      // shaped by the target's own columns, so neither can be expressed in
      // Kysely's per-table row types. `assertMetaTable` above is the guard that
      // matters: nothing outside the adminium_ namespace is reachable from here.
      .insertInto(table as keyof MetaDB)
      .values(chunk as never)
      .execute();
    written += chunk.length;
  }

  return written;
}
