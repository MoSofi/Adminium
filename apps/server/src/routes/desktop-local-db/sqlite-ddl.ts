// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `DatabaseModel` → SQLite DDL (11-electron.md §6 step 2 card 1, task 11-T07).
 *
 * §6: "*From a schema file* — upload `.sql`/`pg_dump`/Prisma/Drizzle/TypeORM/
 * Sequelize/`schema.rb`/Django/JSON via `@adminium/schema-import`, translated to
 * SQLite DDL and applied."
 *
 * `@adminium/schema-import` parses eight formats into ONE artifact — the engine's
 * `DatabaseModel` IR (05-introspection-engine.md §2.1). So this module has a
 * single input shape regardless of which of the eight the user dropped on the
 * wizard, and every format gets the same fidelity. It is pure: statements in,
 * statements out, no `better-sqlite3` — which is what makes the round-trip
 * assertable offline (emit → apply → introspect → compare) rather than by eye.
 *
 * ─── WHY THIS EMITS `VARCHAR(n)` AND `CHECK (… IN (…))`, NOT `TEXT` ──────────
 *
 * SQLite has type AFFINITY, not types: `VARCHAR(32)`, `TEXT` and `CHARACTER(1)`
 * all behave identically at runtime, and the naive translation of every string
 * column is therefore `TEXT`. That translation is correct and it is also the
 * single worst thing this module could do, because the DDL is not the product —
 * the PAGES generated from it are.
 *
 * 11-T08 found this the hard way while building the demo database: a
 * `status TEXT` column introspects back with `maxLength: null`, which fails the
 * candidate rule r07's `maxLength <= 32` gate, so the kanban archetype never
 * scores and the table generates a plain CRUD grid instead of the board its
 * schema is describing. The declared length and the `CHECK (col IN (…))` are how
 * a status column stays recognisable across the emit→introspect round trip:
 * `adapter-sqlite`'s introspector reads the declared type text for `maxLength`
 * and lifts `CHECK … IN` into an `EnumDef` (§2.1's `source: 'check'`).
 *
 * So: the model's `maxLength` is preserved, and an `enum` column is emitted with
 * its values as a CHECK constraint. A user who imports a Prisma schema with
 * `status Status` gets a kanban board; the same import through a `TEXT`-only
 * emitter gets a table. Both "work". Only one is the feature.
 *
 * ─── WHAT IS DELIBERATELY DROPPED ────────────────────────────────────────────
 *
 * - **Views and materialized views.** `TableModel.kind` distinguishes them but
 *   the IR carries no query text (`schema-model.ts` — there is no `definition`
 *   field), so there is nothing to emit. A `CREATE VIEW` cannot be invented from
 *   a column list. Reported as a warning, never a silent skip.
 * - **Schemas.** SQLite has one namespace. `TableModel.schema` is folded into the
 *   emitted name only when the model actually uses more than one (see
 *   {@link emitSqliteDdl}), because `public.users` → `users` is what every
 *   single-schema import wants and `public_users` is what none of them do.
 * - **Generated columns, RLS, partial/expression indexes, index methods.**
 *   `isGenerated` has no expression in the IR (same absence as views); RLS is
 *   Postgres-only; `IndexModel.expression`/`method`/`partial` describe a source
 *   engine's plan, not this one's.
 *
 * Everything dropped produces a {@link DdlWarning}, and the route hands the list
 * to the wizard. §8.2's rule — never hide, always explain — applies to a schema
 * translation as much as to a button.
 */

import type { DatabaseModel, LogicalType, TableModel } from '@adminium/engine';

/** A non-fatal translation gap. Mirrors the IR's own `ModelWarning` shape. */
export interface DdlWarning {
  code:
    /**
     * Raised by the PARSER, not by this module — `@adminium/schema-import`
     * reports what it could not read ("skipped CREATE VIEW without column
     * list", a construct it does not model) as free text, and those are the
     * gaps this emitter never even sees. Dropping them because they arrive in a
     * different shape would mean the user's view vanished between their file
     * and their database with nothing said, which is exactly the failure the
     * `view-skipped` code below exists to prevent for the views that DO reach
     * here. `routes/desktop-local-db/handlers.ts` folds them in.
     */
    | 'source-not-translated'
    | 'view-skipped'
    | 'generated-column-materialized'
    | 'expression-index-skipped'
    | 'no-primary-key'
    | 'fk-target-missing'
    | 'circular-fk';
  message: string;
  tableId: string | null;
}

export interface SqliteDdl {
  /** Executed in order, inside one transaction. */
  statements: string[];
  warnings: DdlWarning[];
  /** Emitted table names, in creation (topological) order. */
  tables: string[];
}

/**
 * Logical type → SQLite column type.
 *
 * The declared text matters twice over: SQLite derives AFFINITY from it by
 * substring rules (`INT` → INTEGER, `CHAR`/`TEXT` → TEXT, `REAL`/`FLOA`/`DOUB` →
 * REAL, `BLOB`/empty → BLOB, everything else → NUMERIC), and `adapter-sqlite`
 * reads it back verbatim as `dbType`. So these spellings are chosen to satisfy
 * BOTH readers — `DECIMAL(10,2)` keeps NUMERIC affinity and round-trips its
 * precision, where a bare `REAL` would silently discard the scale of every money
 * column in the schema.
 */
const TYPE_MAP: Readonly<Record<LogicalType, string>> = {
  text: 'TEXT',
  varchar: 'VARCHAR',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  decimal: 'DECIMAL',
  float: 'REAL',
  // SQLite has no boolean; INTEGER 0/1 is the documented convention and is what
  // `adapter-sqlite`'s type-map reads back as `boolean`.
  boolean: 'BOOLEAN',
  date: 'DATE',
  time: 'TIME',
  timestamp: 'DATETIME',
  timestamptz: 'DATETIME',
  interval: 'TEXT',
  uuid: 'VARCHAR(36)',
  json: 'JSON',
  binary: 'BLOB',
  // Never emitted directly — enum columns go through `columnType`, which needs
  // the EnumDef to size the VARCHAR. This is the fallback if one has no ref.
  enum: 'VARCHAR(32)',
  geometry: 'BLOB',
  inet: 'VARCHAR(45)',
  unknown: 'TEXT',
};

/** `"` is SQLite's standard identifier quote; doubling escapes it. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** `'` doubled — the only escape SQLite string literals have. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The declared type for one column.
 *
 * The enum branch is the one that earns its keep — see the module header. The
 * `+ 0` guard on the VARCHAR length is not defensive noise: `maxLength` is
 * `z.number().int().positive()` in the IR, so it is trustworthy, but an enum
 * whose longest value exceeds the declared length would make every CHECK-passing
 * value violate its own column type.
 */
function columnType(
  column: TableModel['columns'][number],
  model: DatabaseModel,
): string {
  if (column.logicalType === 'enum' && column.enumRef !== null) {
    const def = model.enums.find((candidate) => candidate.id === column.enumRef);
    if (def !== undefined) {
      const longest = def.values.reduce((max, value) => Math.max(max, value.length), 0);
      // The `<= 32` in candidate rule r07 is a gate on the INTROSPECTED length,
      // so a status enum must declare one that fits under it or the kanban never
      // scores (module header). Real status vocabularies are short; the clamp
      // only ever fires for an enum that was never going to be a board anyway.
      return `VARCHAR(${String(Math.max(longest, 1))})`;
    }
  }
  if (column.logicalType === 'varchar' && column.maxLength !== null) {
    return `VARCHAR(${String(column.maxLength)})`;
  }
  if (column.logicalType === 'decimal' && column.numericPrecision !== null) {
    const scale = column.numericScale ?? 0;
    return `DECIMAL(${String(column.numericPrecision)},${String(scale)})`;
  }
  return TYPE_MAP[column.logicalType];
}

/**
 * The DEFAULT clause, or `null` for none.
 *
 * `expression` defaults are dropped rather than passed through: the text is the
 * SOURCE engine's dialect (`nextval('users_id_seq')`, `gen_random_uuid()`,
 * `CURRENT_TIMESTAMP AT TIME ZONE 'utc'`), and SQLite would reject most of them
 * at CREATE TABLE time — turning one unportable default into a failed import of
 * the whole schema. The three STRUCTURED kinds are dialect-free by construction,
 * so those are the three that survive.
 */
function columnDefault(column: TableModel['columns'][number]): string | null {
  const value = column.default;
  if (value === null) return null;
  switch (value.kind) {
    case 'literal':
      // A literal's text is a value, not SQL: quote it, unless it is plainly
      // numeric or a keyword SQLite understands unquoted.
      if (/^-?\d+(\.\d+)?$/.test(value.text)) return `DEFAULT ${value.text}`;
      if (/^(null|true|false)$/i.test(value.text)) return `DEFAULT ${value.text.toUpperCase()}`;
      return `DEFAULT ${quoteLiteral(value.text)}`;
    case 'now':
      return 'DEFAULT CURRENT_TIMESTAMP';
    case 'uuid':
      // SQLite has no uuid generator and no extension is loaded (§7 forbids
      // downloading one). The column stays writable and the app supplies ids.
      return null;
    case 'autoincrement':
      // Handled by INTEGER PRIMARY KEY — see `emitTable`.
      return null;
    case 'expression':
      return null;
  }
}

interface EmitTableResult {
  sql: string;
  warnings: DdlWarning[];
}

/**
 * One `CREATE TABLE`.
 *
 * `INTEGER PRIMARY KEY` is spelled exactly so on purpose for the single-column
 * integer case: it is the ONLY declaration SQLite treats as a rowid alias, which
 * is what makes the column auto-assign on insert. `INT PRIMARY KEY`,
 * `BIGINT PRIMARY KEY` and `INTEGER PRIMARY KEY` in a table-level clause all
 * silently lose that — the column becomes an ordinary NOT NULL integer, and the
 * first placeholder insert (and every later CRUD create) fails with a NOT NULL
 * violation on a column the user believes is auto-generated.
 */
function emitTable(table: TableModel, model: DatabaseModel, nameOf: (id: string) => string | null): EmitTableResult {
  const warnings: DdlWarning[] = [];
  const parts: string[] = [];

  const pk = table.primaryKey;
  const rowidAlias =
    pk.length === 1 &&
    table.columns.some(
      (column) =>
        column.name === pk[0] &&
        (column.logicalType === 'integer' || column.logicalType === 'bigint'),
    );

  for (const column of table.columns) {
    if (column.isGenerated) {
      warnings.push({
        code: 'generated-column-materialized',
        message: `Column "${table.name}.${column.name}" is generated in the source schema. The import IR does not carry its expression, so it was created as an ordinary column.`,
        tableId: table.id,
      });
    }

    const bits: string[] = [quoteIdent(column.name)];

    if (rowidAlias && column.name === pk[0]) {
      // The rowid-alias spelling. NOT NULL and DEFAULT are meaningless on it
      // (SQLite assigns the value) and `AUTOINCREMENT` is a different, slower
      // guarantee nobody asked for.
      bits.push('INTEGER PRIMARY KEY');
      parts.push(bits.join(' '));
      continue;
    }

    bits.push(columnType(column, model));
    if (!column.nullable) bits.push('NOT NULL');
    if (column.isUnique && !(pk.length === 1 && column.name === pk[0])) bits.push('UNIQUE');
    const fallback = columnDefault(column);
    if (fallback !== null) bits.push(fallback);

    if (column.logicalType === 'enum' && column.enumRef !== null) {
      const def = model.enums.find((candidate) => candidate.id === column.enumRef);
      if (def !== undefined && def.values.length > 0) {
        // §2.1 `EnumDef.source: 'check'` is exactly this shape, so the
        // introspector lifts it straight back into an enum on the next pass.
        const values = def.values.map(quoteLiteral).join(', ');
        bits.push(`CHECK (${quoteIdent(column.name)} IN (${values}))`);
      }
    }
    parts.push(bits.join(' '));
  }

  if (pk.length === 0) {
    warnings.push({
      code: 'no-primary-key',
      message: `Table "${table.name}" has no primary key. Adminium can read it, but its rows cannot be edited.`,
      tableId: table.id,
    });
  } else if (!rowidAlias) {
    parts.push(`PRIMARY KEY (${pk.map(quoteIdent).join(', ')})`);
  }

  for (const unique of table.uniques) {
    // A single-column unique already rode along as a column constraint above.
    if (unique.columns.length === 1 && table.columns.some((c) => c.name === unique.columns[0] && c.isUnique)) {
      continue;
    }
    parts.push(`UNIQUE (${unique.columns.map(quoteIdent).join(', ')})`);
  }

  for (const check of table.checks) {
    // The expression is source-dialect text like the expression defaults above,
    // and unlike them it cannot be dropped without changing what the schema
    // MEANS. SQLite's expression grammar is close enough to both Postgres's and
    // MySQL's for the overwhelming majority of real CHECKs (`amount > 0`,
    // `status IN (…)`), and the transaction in `applyDdl` makes a rejection a
    // clean whole-import failure with the offending statement in the message —
    // not a half-created database.
    parts.push(`CHECK (${check.expression})`);
  }

  for (const relation of model.relations) {
    if (relation.kind !== 'declared-fk') continue;
    if (relation.through !== null) continue;
    if (relation.from.tableId !== table.id) continue;
    const target = nameOf(relation.to.tableId);
    if (target === null) {
      warnings.push({
        code: 'fk-target-missing',
        message: `Foreign key on "${table.name}" points at "${relation.to.tableId}", which is not in this schema. The column was created without the constraint.`,
        tableId: table.id,
      });
      continue;
    }
    const from = relation.from.columns.map(quoteIdent).join(', ');
    const to = relation.to.columns.map(quoteIdent).join(', ');
    const actions = [
      relation.onDelete === null ? '' : ` ON DELETE ${fkAction(relation.onDelete)}`,
      relation.onUpdate === null ? '' : ` ON UPDATE ${fkAction(relation.onUpdate)}`,
    ].join('');
    parts.push(`FOREIGN KEY (${from}) REFERENCES ${quoteIdent(target)} (${to})${actions}`);
  }

  const name = nameOf(table.id) ?? table.name;
  return {
    sql: `CREATE TABLE ${quoteIdent(name)} (\n  ${parts.join(',\n  ')}\n)`,
    warnings,
  };
}

function fkAction(action: 'cascade' | 'restrict' | 'set-null' | 'set-default' | 'no-action'): string {
  switch (action) {
    case 'cascade':
      return 'CASCADE';
    case 'restrict':
      return 'RESTRICT';
    case 'set-null':
      return 'SET NULL';
    case 'set-default':
      return 'SET DEFAULT';
    case 'no-action':
      return 'NO ACTION';
  }
}

/**
 * Creation order: a table's FK targets first.
 *
 * SQLite would actually accept any order — foreign keys are resolved lazily, and
 * `PRAGMA foreign_keys` is per-connection — but the placeholder generator
 * (`placeholder.ts`) needs parents to exist before children, and it reads THIS
 * order rather than computing a second one that could disagree.
 *
 * A cycle (`a.b_id → b`, `b.a_id → a`) has no topological order at all. Rather
 * than fail the import, the remaining tables are emitted in declaration order
 * and the cycle is reported: the DDL is still correct, and only the seeding of
 * those tables is affected (the generator skips the nullable side).
 */
export function orderTables(model: DatabaseModel): { order: TableModel[]; warnings: DdlWarning[] } {
  const tables = model.tables.filter((table) => table.kind === 'table');
  const byId = new Map(tables.map((table) => [table.id, table]));
  const dependencies = new Map<string, Set<string>>(tables.map((table) => [table.id, new Set<string>()]));

  for (const relation of model.relations) {
    if (relation.kind !== 'declared-fk' || relation.through !== null) continue;
    if (relation.selfReferential) continue;
    if (!byId.has(relation.from.tableId) || !byId.has(relation.to.tableId)) continue;
    dependencies.get(relation.from.tableId)?.add(relation.to.tableId);
  }

  const order: TableModel[] = [];
  const emitted = new Set<string>();
  let progress = true;
  while (progress && order.length < tables.length) {
    progress = false;
    for (const table of tables) {
      if (emitted.has(table.id)) continue;
      const needs = dependencies.get(table.id) ?? new Set<string>();
      if ([...needs].every((id) => emitted.has(id))) {
        order.push(table);
        emitted.add(table.id);
        progress = true;
      }
    }
  }

  const warnings: DdlWarning[] = [];
  const stuck = tables.filter((table) => !emitted.has(table.id));
  if (stuck.length > 0) {
    warnings.push({
      code: 'circular-fk',
      message: `Circular foreign keys between ${stuck.map((table) => `"${table.name}"`).join(', ')}. The tables were created, but sample rows were not generated for them.`,
      tableId: null,
    });
    order.push(...stuck);
  }

  return { order, warnings };
}

/**
 * Are two tables' names distinguishable without their schema?
 *
 * SQLite has one namespace, so `public.users` and `audit.users` cannot both be
 * `users`. Prefixing is the fix, and prefixing ALWAYS is the trap: a
 * single-schema Postgres dump (the common case by a wide margin) would produce
 * `public_users`, and every generated page, slug and nav label in the app would
 * carry a namespace the user never typed and cannot remove.
 */
function needsSchemaPrefix(tables: readonly TableModel[]): boolean {
  const seen = new Set<string>();
  for (const table of tables) {
    if (seen.has(table.name)) return true;
    seen.add(table.name);
  }
  return false;
}

/** Translate a parsed schema into the statements that recreate it in SQLite. */
export function emitSqliteDdl(model: DatabaseModel): SqliteDdl {
  const { order, warnings } = orderTables(model);
  const prefix = needsSchemaPrefix(order);
  const nameOf = (id: string): string | null => {
    const table = order.find((candidate) => candidate.id === id);
    if (table === undefined) return null;
    return prefix ? `${table.schema}_${table.name}` : table.name;
  };

  const statements: string[] = [];
  const allWarnings = [...warnings];

  for (const view of model.tables.filter((table) => table.kind !== 'table')) {
    allWarnings.push({
      code: 'view-skipped',
      message: `"${view.name}" is a ${view.kind === 'view' ? 'view' : 'materialized view'}. A schema file records its columns but not its query, so it was not recreated.`,
      tableId: view.id,
    });
  }

  for (const table of order) {
    const emitted = emitTable(table, model, nameOf);
    statements.push(emitted.sql);
    allWarnings.push(...emitted.warnings);
  }

  // Indexes after every table exists — an index statement names exactly one
  // table, so the ordering is cosmetic, but keeping DDL grouped by kind makes
  // the transaction readable in a log when one statement is rejected.
  for (const table of order) {
    const name = nameOf(table.id) ?? table.name;
    for (const index of table.indexes) {
      if (index.primary) continue; // already the PRIMARY KEY clause
      if (index.columns.length === 0 || index.expression !== null || index.partial) {
        allWarnings.push({
          code: 'expression-index-skipped',
          message: `Index "${index.name}" on "${table.name}" is a partial or expression index. Those are written in the source engine's dialect, so it was not recreated.`,
          tableId: table.id,
        });
        continue;
      }
      // Index names are unique per DATABASE in SQLite, not per table (they are
      // per-schema in Postgres). Two tables with an `idx_created_at` are an
      // ordinary Postgres schema and a duplicate-name error here, so the table
      // name is folded in.
      const indexName = `${name}_${index.name}`;
      const unique = index.unique ? 'UNIQUE ' : '';
      const columns = index.columns.map(quoteIdent).join(', ');
      statements.push(
        `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(indexName)} ON ${quoteIdent(name)} (${columns})`,
      );
    }
  }

  return {
    statements,
    warnings: allWarnings,
    tables: order.map((table) => nameOf(table.id) ?? table.name),
  };
}
