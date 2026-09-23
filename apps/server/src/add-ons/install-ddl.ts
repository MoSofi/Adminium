// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `applyInstall` — turning an add-on's `requiredSchema` into real
 * tables.
 *
 * ─── Why this is here and not in `@adminium/manifest` ──────────────────────
 *
 * `planInstall` and `applyInstall` are listed side by side, but they belong in
 * different packages. Planning is a PURE diff and lives in the manifest package
 * where the schema does. Applying needs a live connection, so it lives here —
 * `packages/manifest` may import only `add-on-contracts` and zod (the
 * dep-cruiser import matrix), and reaching for Kysely there would be the wrong
 * kind of shortcut.
 *
 * ─── There is no SQL in this file, and that is the whole trick ─────────────
 *
 * The plan, and the investigation that priced it, both assumed a
 * `requiredSchema` → DDL emitter written per dialect — which is what
 * `routes/desktop-local-db/sqlite-ddl.ts` is, and why this looked like a week.
 * It is not needed: `ConnectionManager.data()` hands back a real
 * `Kysely<SourceDatabase>`, and Kysely's schema builder already compiles
 * `createTable` correctly for postgres, mysql and sqlite. What was actually
 * missing is the part below — a map from the manifest's fifteen abstract column
 * types to a column type per dialect, and the ordering rules.
 *
 * ─── MySQL HAS NO TRANSACTIONAL DDL, so this is re-runnable instead ────────
 *
 * A multi-table install cannot be one transaction: MySQL commits each DDL
 * statement implicitly, so a failure halfway leaves the earlier tables in place
 * with nothing to roll back. The meta-store migrator solved this years ago and
 * the answer is copied wholesale — `ifNotExists` on every create, dependency
 * order so a target exists before its referent, and no statement that is unsafe
 * to run twice. A retry after a partial failure completes the install rather
 * than colliding with it, which is a better property than a rollback that only
 * two of the three dialects can offer.
 *
 * ─── What it will NOT do ───────────────────────────────────────────────────
 *
 * It creates tables. It does not ALTER one that already exists to add a missing
 * column, and `planInstall` reports that case as a partial match rather than
 * something to fix: adding a column to a table an operator owns is a different
 * conversation from creating one an add-on asked for, and it is theirs to have.
 */

import type { Dialect } from '@adminium/engine';
import type { InstallPlan, RequiredColumn, RequiredTable } from '@adminium/manifest';
import { sql, type CreateTableBuilder, type Kysely } from 'kysely';

import { AppError } from '../errors.js';
import { renderDefault } from '../schema-ddl/compile.js';

/** Every way applying a plan can be refused. */
export type ApplyRefusal =
  | 'UNSUPPORTED_COLUMN_TYPE'
  | 'UNRESOLVED_FK_TARGET'
  | 'NO_PRIMARY_KEY'
  | 'DDL_FAILED';

/**
 * An AppError, so the operator reads what went wrong. It was a
 * plain Error, which the error handler turns into a 500 whose message is hidden
 * in production — so a failed CREATE TABLE said "Internal Server Error" and
 * nothing else. 422: every reason is about THIS schema on THIS database.
 */
export class AddOnInstallError extends AppError {
  override readonly name = 'AddOnInstallError';
  readonly reason: ApplyRefusal;
  readonly table: string | undefined;

  constructor(reason: ApplyRefusal, message: string, table?: string) {
    super(422, reason, message, table === undefined ? { reason } : { reason, table });
    this.reason = reason;
    this.table = table;
  }
}

/**
 * The manifest's fifteen abstract column types, per dialect.
 *
 * Mirrors `packages/meta/src/columns.ts` in shape and in most of its rulings,
 * because they are the same problem twice — and where it differs, it differs
 * for a reason worth reading:
 *
 *  - **`id` is `varchar(36)` on postgres**, never `char`: bpchar blank-pads to
 *    36 on write and hands the padding back on every read, which breaks any id
 *    shorter than the column. That lesson is the meta store's, paid for once.
 *  - **`timestamptz` is a REAL timestamp here**, not the epoch-milliseconds
 *    integer the meta store uses. The meta store owns its own rows and can
 *    choose; an add-on's tables sit in the OPERATOR's database beside their own
 *    data, and a column called `created_at` holding `1750000000000` would be
 *    unreadable to every other tool they point at it.
 *  - **`money` is `decimal(19,4)`**, not a float. Four decimal places is what
 *    every accounting system settled on, and binary floating point cannot
 *    represent a tenth of a cent.
 */
function columnTypeFor(type: RequiredColumn['type'], dialect: Dialect, keyed = false): string {
  switch (type) {
    case 'id':
      return dialect === 'postgres' ? 'varchar(36)' : dialect === 'mysql' ? 'varchar(36)' : 'text';
    case 'fk':
      // Never reached for a real column: an FK takes its TARGET's key type,
      // resolved by `keyTarget` below. Kept for exhaustiveness only.
      return dialect === 'postgres' ? 'varchar(36)' : dialect === 'mysql' ? 'varchar(36)' : 'text';
    case 'text':
      // MySQL cannot index a TEXT column without a prefix length, so a text
      // primary key — or a foreign key pointing at one — is refused outright
      // ("BLOB/TEXT column used in key specification"). 255 utf8mb4 characters
      // is 1020 bytes, inside InnoDB's 3072-byte key limit.
      return dialect === 'mysql' && keyed ? 'varchar(255)' : 'text';
    case 'uuid':
      return dialect === 'postgres' ? 'uuid' : dialect === 'mysql' ? 'char(36)' : 'text';
    case 'int':
      return 'integer';
    case 'bigint':
      return dialect === 'sqlite' ? 'integer' : 'bigint';
    case 'decimal':
      return dialect === 'sqlite' ? 'real' : 'decimal(19,4)';
    case 'money':
      return dialect === 'sqlite' ? 'real' : 'decimal(19,4)';
    case 'float':
      return dialect === 'sqlite' ? 'real' : 'double precision';
    case 'bool':
      return dialect === 'postgres' ? 'boolean' : dialect === 'mysql' ? 'tinyint(1)' : 'integer';
    case 'json':
      return dialect === 'postgres' ? 'jsonb' : dialect === 'mysql' ? 'json' : 'text';
    case 'date':
      return 'date';
    case 'timestamptz':
      // SQLite has no date/time storage class, but it keeps the DECLARED type,
      // and that is what the introspector reads: `@adminium/adapter-sqlite`'s
      // `hintFor` recognises a declared type containing TIMESTAMP or DATETIME,
      // and lets `TEXT` fall through to `text`. This used to emit `text` under
      // a comment claiming the introspector recognised it — so every date an
      // app created on SQLite read back as a string, and an app's own calendar
      // page (its date column the only candidate) could never compose. Storage
      // is unchanged: `timestamp` has NUMERIC affinity, which keeps an ISO
      // string as TEXT.
      return dialect === 'postgres'
        ? 'timestamptz'
        : dialect === 'mysql'
          ? 'datetime'
          : 'timestamp';
    case 'enum':
      // A CHECK constraint rather than a native enum type: postgres would need
      // a CREATE TYPE (a second object to own and drop), and the introspector
      // already lifts `CHECK … IN (…)` back into an enum on read — which is how
      // the generated app gets a select instead of a free-text box.
      return dialect === 'postgres' ? 'varchar(64)' : dialect === 'mysql' ? 'varchar(64)' : 'text';
    case 'blob':
      return dialect === 'postgres' ? 'bytea' : dialect === 'mysql' ? 'blob' : 'blob';
    default: {
      // Exhaustiveness: a new member of COLUMN_TYPES fails to compile here
      // rather than silently becoming `text` in somebody's database.
      const unreachable: never = type;
      throw new AddOnInstallError(
        'UNSUPPORTED_COLUMN_TYPE',
        `no column type is mapped for ${String(unreachable)}`,
      );
    }
  }
}

/** What the caller must supply about the tables that already exist. */
export interface ExistingTable {
  ref: string;
  columns: readonly {
    ref: string;
    isPrimaryKey?: boolean;
    /** The native type verbatim, as the database reports it. A foreign key
     * pointing at this column must be created with exactly this type. */
    dbType?: string;
    /** What the planner needs to tell a same-named foreign table apart. */
    nullable?: boolean;
    hasDefault?: boolean;
    isGenerated?: boolean;
    /** The engine's logical type, which the planner's type check reads. */
    logicalType?: string;
    /** A `varchar`'s width, when it has one. */
    maxLength?: number | null;
    /** A key the database numbers itself. */
    isIdentity?: boolean;
    /** The values an enum column admits. */
    enumValues?: readonly string[];
  }[];
}

export interface ApplyInstallInput {
  plan: InstallPlan;
  /** The manifest's declared tables, in declaration order. */
  tables: readonly RequiredTable[];
  /** Structurally `SourceDatabase` — spelled out so this file needs no import
   * from the connection layer, which it must stay ignorant of. */
  db: Kysely<Record<string, Record<string, unknown>>>;
  dialect: Dialect;
  existing: readonly ExistingTable[];
  /**
   * Called after each table is created, before the next — so a caller keeping
   * a record knows exactly what exists when a later create fails.
   */
  onCreated?: ((ref: string) => Promise<void>) | undefined;
}

export interface ApplyInstallResult {
  created: string[];
  /** Tables the plan reuses; untouched, listed so a caller can report them. */
  reused: string[];
}

/** The column an FK points at, and the type the FK column must be created with. */
interface KeyTarget {
  column: string;
  type: string;
}

/**
 * Resolves the column an FK points at, and the type the FK column must have.
 *
 * `references` names a TABLE, never a column (the manifest schema has no field
 * for one), so the target's primary key has to be found. For a table this
 * install is creating that is the column marked `role: 'pk'`; for a HOST table
 * it comes from the live schema. A target with no single primary key is
 * refused rather than guessed at — a composite key cannot be pointed at by one
 * column, and inventing `id` would create a constraint against a column that
 * may not exist.
 *
 * The TYPE matters as much as the column. Postgres and MySQL both refuse a
 * foreign key whose column type differs from the key it references ("cannot be
 * implemented" / "are incompatible"), so an FK is never a fixed type: it is
 * whatever its target's key is. A fixed `varchar(36)` served every add-on,
 * whose keys are all `id`, and failed every app, whose keys are `int` and
 * `text`. SQLite enforces no such rule, which is how it went unnoticed.
 */
function keyTarget(
  target: string,
  tables: readonly RequiredTable[],
  existing: readonly ExistingTable[],
  dialect: Dialect,
  seen: ReadonlySet<string> = new Set(),
): KeyTarget {
  // The LIVE schema first, and the manifest only as a fallback. A table can be
  // in both — that is exactly the reuse case, where an add-on declares a table
  // the host already has — and there the database is the truth. Reading the
  // manifest's declaration instead would point a foreign key at whatever column
  // the AUTHOR called the key, in somebody else's table, where it may be named
  // something else or not exist.
  const host = existing.find((table) => table.ref === target);
  if (host !== undefined) {
    const keys = host.columns.filter((column) => column.isPrimaryKey === true);
    if (keys.length !== 1) {
      throw new AddOnInstallError(
        'NO_PRIMARY_KEY',
        `"${target}" has ${keys.length === 0 ? 'no primary key' : 'a composite primary key'}, ` +
          'so a single foreign-key column cannot point at it.',
        target,
      );
    }
    const key = keys[0]!;
    // Verbatim, because the database wrote it: postgres's `format_type` quotes
    // any identifier that needs it and MySQL's COLUMN_TYPE escapes its enum
    // literals, so the string is already valid SQL for this engine. A caller
    // that knows no type (an old snapshot) keeps the historical `id` mapping.
    return { column: key.ref, type: key.dbType ?? columnTypeFor('id', dialect, true) };
  }

  const declared = tables.find((table) => table.ref === target);
  if (declared === undefined) {
    throw new AddOnInstallError(
      'UNRESOLVED_FK_TARGET',
      `"${target}" exists neither in this add-on nor in the database.`,
      target,
    );
  }
  const pk = declared.columns.filter((column) => column.role === 'pk');
  if (pk.length !== 1) {
    throw new AddOnInstallError(
      'NO_PRIMARY_KEY',
      `"${target}" does not declare exactly one primary key, so a foreign key cannot point at it.`,
      target,
    );
  }
  const key = pk[0]!;
  return { column: key.ref, type: declaredTypeOf(key, declared, tables, existing, dialect, seen) };
}

/**
 * An enum column's declared type: a `varchar` just wide enough, on every
 * dialect.
 *
 * WIDTH IS WHAT THE CLASSIFIER READS. `r07-status-workflow` accepts a text
 * enum only at `maxLength <= 32` — its guard against tagging free text — and
 * this used to declare `varchar(64)` (postgres, mysql) or unbounded `text`
 * (sqlite). So no app's status column was EVER a workflow status once
 * installed, on any dialect, and a board over an app's own table could never
 * compose: the manifest said "status: booked | completed | cancelled" and the
 * installed column read as a plain category. Values that fit in 32 characters
 * get 32; anything longer keeps 64 (and is not workflow vocabulary anyway).
 *
 * The engine's `modelFromRequiredSchema` mirrors this rule, so an app's CI
 * checks its pages against the table the installer really creates.
 */
export function enumTypeFor(values: readonly string[]): string {
  return `varchar(${String(enumWidthFor(values))})`;
}

/** The width half of {@link enumTypeFor}, for a caller that authors a `DesiredColumn`. */
export function enumWidthFor(values: readonly string[]): 32 | 64 {
  return values.every((value) => value.length <= 32) ? 32 : 64;
}

/**
 * The type a DECLARED column is created with. Only an `fk` needs more than the
 * map: it borrows its target's key type, and that key may itself be an FK (a
 * one-to-one extension table keyed by its parent's id), so this follows the
 * chain — and refuses a chain that loops back on itself rather than recursing
 * forever.
 */
function declaredTypeOf(
  column: RequiredColumn,
  table: RequiredTable,
  tables: readonly RequiredTable[],
  existing: readonly ExistingTable[],
  dialect: Dialect,
  seen: ReadonlySet<string> = new Set(),
): string {
  if (column.type === 'enum' && column.enum !== undefined) return enumTypeFor(column.enum);
  // Short text is a `varchar(n)` on every dialect: what a form, a unique index
  // and MySQL's key limit all want. SQLite keeps the declared type and does
  // not enforce it, which is harmless.
  if (column.type === 'text' && column.maxLength !== undefined) return `varchar(${String(column.maxLength)})`;
  // A code is unique, and MySQL cannot index an unbounded TEXT: a code column
  // is exactly as wide as its codes.
  const code = column.rules?.code;
  if (column.type === 'text' && code !== undefined) return `varchar(${String((code.prefix ?? '').length + code.length)})`;
  if (column.type !== 'fk' || column.references === undefined) {
    return columnTypeFor(column.type, dialect, column.role === 'pk');
  }
  const link = `${table.ref}.${column.ref}`;
  if (seen.has(link)) {
    throw new AddOnInstallError(
      'UNRESOLVED_FK_TARGET',
      `"${link}" is a primary key that references itself through a chain of foreign keys, ` +
        'so it has no type to take.',
      table.ref,
    );
  }
  return keyTarget(column.references, tables, existing, dialect, new Set([...seen, link])).type;
}

/**
 * Orders the tables to create so a foreign key's target exists first.
 *
 * A stable topological sort over the internal references only — a reference to
 * a HOST table needs no ordering, because that table is already there. A cycle
 * is not an error: two tables referencing each other is legal in every dialect
 * that supports post-hoc constraints, and refusing it here would refuse a
 * schema the operator could write by hand. The walk breaks a cycle by emitting
 * a table before one it references; {@link closesCycle} names those foreign
 * keys, and `applyInstall` adds them once both tables exist.
 */
function creationOrder(tables: readonly RequiredTable[]): RequiredTable[] {
  const byRef = new Map(tables.map((table) => [table.ref, table]));
  const emitted = new Set<string>();
  const order: RequiredTable[] = [];

  const visit = (table: RequiredTable, seen: Set<string>): void => {
    if (emitted.has(table.ref) || seen.has(table.ref)) return;
    seen.add(table.ref);
    for (const column of table.columns) {
      if (column.type !== 'fk' || column.references === undefined) continue;
      const target = byRef.get(column.references);
      if (target !== undefined) visit(target, seen);
    }
    if (emitted.has(table.ref)) return;
    emitted.add(table.ref);
    order.push(table);
  };

  for (const table of tables) visit(table, new Set());
  return order;
}

/**
 * Whether a foreign key points at a table that comes LATER in `order` — the
 * edge the walk broke to order a cycle (`tickets.reservation_id →
 * reservations`, `reservations.ticket_id → tickets`).
 *
 * It used to be created inline like every other, which SQLite accepts (it
 * checks the target only when a row is written) and Postgres and MySQL refuse
 * ("relation … does not exist", "Failed to open the referenced table"): the
 * install stopped half way on both, with the earlier tables made. A reference
 * to the table itself is not one: its target exists by the time the CREATE
 * finishes, on every engine.
 */
function closesCycle(position: ReadonlyMap<string, number>, table: string, column: RequiredColumn): boolean {
  if (column.type !== 'fk' || column.references === undefined) return false;
  const target = position.get(column.references);
  return target !== undefined && target > position.get(table)!;
}

/**
 * Whether the constraint is already there — so the ALTER that closes a cycle
 * is as safe to run twice as the `ifNotExists` creates around it.
 */
async function hasConstraint(
  db: ApplyInstallInput['db'],
  dialect: Dialect,
  table: string,
  name: string,
): Promise<boolean> {
  const schema = dialect === 'mysql' ? sql`database()` : sql`current_schema()`;
  const found = await sql<{ one: number }>`
    select 1 as one from information_schema.table_constraints
    where table_schema = ${schema} and table_name = ${table} and constraint_name = ${name}
  `.execute(db);
  return found.rows.length > 0;
}

/**
 * Creates the tables a plan says to create.
 *
 * Refuses to run a plan that is not installable — the caller has already been
 * told why, and applying half of a refused plan is the failure mode this whole
 * design is shaped against.
 */
export async function applyInstall(input: ApplyInstallInput): Promise<ApplyInstallResult> {
  const { plan, tables, db, dialect, existing } = input;
  if (!plan.installable) {
    throw new AddOnInstallError(
      'DDL_FAILED',
      'this plan was refused; it must not be applied',
    );
  }

  const toCreate = new Set(plan.create.map((table) => table.ref));
  const created: string[] = [];
  const order = creationOrder(tables);
  const position = new Map(order.map((table, at) => [table.ref, at]));
  // SQLite keeps every FK inline: it accepts a target that does not exist yet,
  // and it has no ALTER TABLE … ADD CONSTRAINT to do it later with.
  const postHoc = dialect !== 'sqlite';

  for (const table of order) {
    if (!toCreate.has(table.ref)) continue;

    // `ifNotExists` on every create — see the header. A retry after a partial
    // failure must complete the install, not collide with it.
    // Annotated rather than inferred: `createTable` tracks the columns added so
    // far in a type parameter, and a `let` reassigned in a loop pins that to the
    // empty set — which makes `addForeignKeyConstraint`'s column list `never[]`.
    let builder: CreateTableBuilder<string, string> = db.schema
      .createTable(table.ref)
      .ifNotExists();

    for (const column of table.columns) {
      const type = declaredTypeOf(column, table, tables, existing, dialect);
      const numbered = isNumberedKey(column);
      builder = builder.addColumn(column.ref, sql.raw(type), (col) => {
        let built = col;
        if (column.role === 'pk') built = built.primaryKey();
        // A key that numbers itself. On SQLite `integer PRIMARY KEY` IS
        // the rowid alias, so the type above already did it.
        if (numbered && dialect === 'postgres') built = built.generatedByDefaultAsIdentity();
        if (numbered && dialect === 'mysql') built = built.autoIncrement();
        // Nullable unless the manifest says otherwise, and a primary key is
        // never nullable whatever it says.
        if (column.nullable !== true && column.role !== 'pk') built = built.notNull();
        const fill = defaultSqlFor(column, dialect);
        if (fill !== null) built = built.defaultTo(sql.raw(fill));
        if (column.type === 'enum' && column.enum !== undefined) {
          // The CHECK the introspector reads back as an enum.
          const values = column.enum.map((value) => literal(value, dialect)).join(', ');
          built = built.check(sql.raw(`${quote(column.ref, dialect)} in (${values})`));
        }
        return built;
      });
    }

    for (const column of table.columns) {
      if (column.type !== 'fk' || column.references === undefined) continue;
      // Its target is not made yet; added below, once it is.
      if (postHoc && closesCycle(position, table.ref, column)) continue;
      const { column: targetColumn } = keyTarget(column.references, tables, existing, dialect);
      // NAMED and table-level, never an inline column-level `references`: MySQL
      // parses the inline form and silently discards it, which is the 2026-07-20
      // lesson the meta migrations already carry.
      builder = builder.addForeignKeyConstraint(
        `fk_${table.ref}_${column.ref}`,
        [column.ref],
        column.references,
        [targetColumn],
      );
    }

    // A code's uniqueness is the database's to keep: the write path makes a
    // fresh code when this refuses one.
    for (const column of table.columns) {
      if (column.rules?.code === undefined) continue;
      builder = builder.addUniqueConstraint(`uq_${table.ref}_${column.ref}`, [column.ref]);
    }

    try {
      await builder.execute();
      created.push(table.ref);
    } catch (error) {
      throw new AddOnInstallError(
        'DDL_FAILED',
        `creating "${table.ref}" failed: ${String(error)}`,
        table.ref,
      );
    }
    await input.onCreated?.(table.ref);
  }

  if (postHoc) await closeCycles({ ...input, order, position, toCreate });

  return { created, reused: plan.reuse.map((table) => table.ref) };
}

/**
 * The foreign keys `applyInstall` held back, added now that every table exists.
 *
 * On the tables it just created — and on a table an EARLIER, interrupted run of
 * this install created (`own-leftover`, not adopted), because that run may have
 * stopped between its CREATE and this ALTER. A resume re-plans such a table as
 * reused and creates nothing, so without this it would finish without the
 * constraint while claiming to have finished. Each constraint is looked up
 * first, so a finished install's constraints are left as they are; a column
 * the live table lacks (an update adds it afterwards) is left alone.
 */
async function closeCycles(
  input: ApplyInstallInput & {
    order: readonly RequiredTable[];
    position: ReadonlyMap<string, number>;
    toCreate: ReadonlySet<string>;
  },
): Promise<void> {
  const { plan, tables, db, dialect, existing, order, position, toCreate } = input;
  const ownLeftover = new Set(
    (plan.tables ?? [])
      .filter((t) => t.class === 'own-leftover' && t.action === 'reuse' && t.adopted !== true)
      .map((t) => t.table),
  );
  for (const table of order) {
    const made = toCreate.has(table.ref);
    if (!made && !ownLeftover.has(table.ref)) continue;
    const live = existing.find((t) => t.ref === table.ref);
    for (const column of table.columns) {
      if (!closesCycle(position, table.ref, column)) continue;
      if (!made && live?.columns.some((c) => c.ref === column.ref) !== true) continue;
      const name = `fk_${table.ref}_${column.ref}`;
      try {
        if (await hasConstraint(db, dialect, table.ref, name)) continue;
        const { column: targetColumn } = keyTarget(column.references!, tables, existing, dialect);
        await db.schema
          .alterTable(table.ref)
          .addForeignKeyConstraint(name, [column.ref], column.references!, [targetColumn])
          .execute();
      } catch (error) {
        if (error instanceof AddOnInstallError) throw error;
        throw new AddOnInstallError(
          'DDL_FAILED',
          `linking "${table.ref}" to "${column.references!}" failed: ${String(error)}`,
          table.ref,
        );
      }
    }
  }
}

/**
 * An `int` or `bigint` primary key numbers itself.
 *
 * It used to be a bare `integer PRIMARY KEY`, which SQLite quietly turns into
 * its rowid alias and Postgres and MySQL do not: every insert that left the id
 * out — every record an operator adds from a form — failed there with a
 * not-null violation, and only SQLite's suite could not see it. `BY DEFAULT`,
 * not `ALWAYS`, so an explicit id (sample data, an import) is still accepted;
 * whoever writes one moves the sequence past it.
 */
export function isNumberedKey(column: RequiredColumn): boolean {
  return column.role === 'pk' && (column.type === 'int' || column.type === 'bigint');
}

/**
 * A column's DEFAULT, rendered for the dialect, or `null` for none.
 *
 * The manifest schema has already refused every default that is not the same
 * on all three engines (`defaultIssue`), so this only spells what is left, with
 * the schema-authoring compiler's own `renderDefault` so an app's table and a
 * table an operator designs get the same clause.
 */
export function defaultSqlFor(column: RequiredColumn, dialect: Dialect): string | null {
  const value = column.default;
  if (value === undefined) return null;
  if (value === 'now' && column.type === 'timestamptz') {
    return renderDefault({ default: { kind: 'now' }, logicalType: 'timestamptz' }, dialect);
  }
  const logicalType =
    column.type === 'int'
      ? 'integer'
      : column.type === 'bigint'
        ? 'bigint'
        : column.type === 'decimal' || column.type === 'money'
          ? 'decimal'
          : column.type === 'float'
            ? 'float'
            : column.type === 'bool'
              ? 'boolean'
              : 'varchar';
  return renderDefault({ default: { kind: 'literal', text: String(value) }, logicalType }, dialect);
}

/** Quotes an identifier for the CHECK expression, per dialect. */
function quote(identifier: string, dialect: Dialect): string {
  return dialect === 'mysql' ? `\`${identifier}\`` : `"${identifier}"`;
}

/**
 * A string literal for the CHECK expression, per dialect.
 *
 * The enum's values are the only manifest-authored TEXT that reaches emitted
 * SQL — everything else is either an identifier the schema constrains to
 * `^[a-z][a-z0-9_]*$` or a type from the closed map above.
 *
 * Doubling the quote is enough for postgres and sqlite. **MySQL also treats a
 * backslash as an escape character inside a string literal**, unless the server
 * runs with `NO_BACKSLASH_ESCAPES` — which cannot be assumed of somebody else's
 * database. So a value ending in a backslash would otherwise escape the closing
 * quote and run the rest of the list as SQL.
 */
function literal(value: string, dialect: Dialect): string {
  const escaped =
    dialect === 'mysql'
      ? value.replace(/\\/g, '\\\\').replace(/'/g, "''")
      : value.replace(/'/g, "''");
  return `'${escaped}'`;
}
