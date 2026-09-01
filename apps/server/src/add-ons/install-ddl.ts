// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `applyInstall` — turning an add-on's `requiredSchema` into real tables
 * (26-add-on-runtime.md §3, 26-T02).
 *
 * ─── Why this is here and not in `@adminium/manifest` ──────────────────────
 *
 * §3 lists `planInstall` and `applyInstall` side by side, but they belong in
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

/** Every way applying a plan can be refused. */
export type ApplyRefusal =
  | 'UNSUPPORTED_COLUMN_TYPE'
  | 'UNRESOLVED_FK_TARGET'
  | 'NO_PRIMARY_KEY'
  | 'DDL_FAILED';

export class AddOnInstallError extends Error {
  override readonly name = 'AddOnInstallError';
  readonly reason: ApplyRefusal;
  readonly table: string | undefined;

  constructor(reason: ApplyRefusal, message: string, table?: string) {
    super(message);
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
function columnTypeFor(type: RequiredColumn['type'], dialect: Dialect): string {
  switch (type) {
    case 'id':
    case 'fk':
      return dialect === 'postgres' ? 'varchar(36)' : dialect === 'mysql' ? 'varchar(36)' : 'text';
    case 'text':
      return 'text';
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
      // sqlite has no date/time type at all; text is what every sqlite tool
      // reads back as a timestamp, and what the introspector recognises.
      return dialect === 'postgres'
        ? 'timestamptz'
        : dialect === 'mysql'
          ? 'datetime'
          : 'text';
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
  columns: readonly { ref: string; isPrimaryKey?: boolean }[];
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
}

export interface ApplyInstallResult {
  created: string[];
  /** Tables the plan reuses; untouched, listed so a caller can report them. */
  reused: string[];
}

/**
 * Resolves the column an FK points at.
 *
 * `references` names a TABLE, never a column (the manifest schema has no field
 * for one), so the target's primary key has to be found. For a table this
 * install is creating that is the column marked `role: 'pk'`; for a HOST table
 * it comes from the live schema. A target with no single primary key is
 * refused rather than guessed at — a composite key cannot be pointed at by one
 * column, and inventing `id` would create a constraint against a column that
 * may not exist.
 */
function primaryKeyOf(
  target: string,
  tables: readonly RequiredTable[],
  existing: readonly ExistingTable[],
): string {
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
    return keys[0]!.ref;
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
  return pk[0]!.ref;
}

/**
 * Orders the tables to create so a foreign key's target exists first.
 *
 * A stable topological sort over the internal references only — a reference to
 * a HOST table needs no ordering, because that table is already there. A cycle
 * is not an error: two tables referencing each other is legal in every dialect
 * that supports deferred or post-hoc constraints, and refusing it here would
 * refuse a schema the operator could write by hand. The leftovers are emitted
 * in declaration order and their constraints simply resolve at creation time or
 * not at all, which is the database's ruling to make rather than this file's.
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

  for (const table of creationOrder(tables)) {
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
      const type = columnTypeFor(column.type, dialect);
      builder = builder.addColumn(column.ref, sql.raw(type), (col) => {
        let built = col;
        if (column.role === 'pk') built = built.primaryKey();
        // Nullable unless the manifest says otherwise, and a primary key is
        // never nullable whatever it says.
        if (column.nullable !== true && column.role !== 'pk') built = built.notNull();
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
      const targetColumn = primaryKeyOf(column.references, tables, existing);
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
  }

  return { created, reused: plan.reuse.map((table) => table.ref) };
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
