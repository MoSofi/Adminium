// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The executor — one function per step kind, `(step, ctx) → CompiledQuery[]`.
 *
 * ─── The invariant this file exists to keep ────────────────────────────────
 *
 * D2: **the preview IS the statement that runs.** `plan` calls
 * {@link compileStep} to show the operator SQL; `apply` calls the same
 * function to get the statements it executes. There is one implementation, so
 * there is nothing to drift. A second, prettier renderer for the UI would be
 * wrong the first time the two disagreed, and the disagreement would surface
 * as "the preview lied", which is worse than having no preview.
 *
 * ─── Why this is here and not in the engine ────────────────────────────────
 *
 * Same boundary `install-ddl.ts:6-14` already draws: planning is pure and
 * lives in `@adminium/engine` where the schema model does; compiling needs
 * Kysely, and the dep-cruiser import matrix does not let the engine reach for
 * it. `plan-ddl` is testable with no database precisely because the SQL lives
 * on this side of the line.
 *
 * ─── Where Kysely stops ────────────────────────────────────────────────────
 *
 * Kysely 0.29.5's `AlterTableBuilder` covers most of the vocabulary but has
 * **no** `NOT VALID`/`VALIDATE CONSTRAINT`, no `USING` cast, no
 * `CONCURRENTLY`, no MySQL `ALGORITHM=`/`LOCK=` clause and no `SET LOCAL`.
 * Those are `` sql`…`.compile(db) `` templates, which return the *same*
 * `CompiledQuery` type — so the seam is invisible to the caller and the D2
 * invariant holds across it.
 *
 * ─── Identifiers ───────────────────────────────────────────────────────────
 *
 * Every identifier reaching a template is quoted through {@link quoteIdent}
 * after being re-checked against `^[a-z][a-z0-9_]*$`. That check is redundant
 * — `validateSchemaEdit` already refused anything else, and a table name from
 * the snapshot is the database's own — and it stays, because this is the file
 * that builds strings, and a defence that costs a regex is not worth removing
 * to save one. Where Kysely's builder is used it does its own quoting.
 */
import {
  sql,
  type CompiledQuery,
  type CreateTableBuilder,
  type Kysely,
} from 'kysely';
import {
  ddlTypeFor,
  IDENTIFIER_RE,
  type ColumnModel,
  type DdlStep,
  type Dialect,
  type Relation,
  type TableModel,
} from '@adminium/engine';

import { AppError } from '../errors.js';

/** A step this compiler cannot express — a bug, not a user error. */
export class DdlCompileError extends AppError {
  override readonly name = 'DdlCompileError';

  constructor(message: string, details?: unknown) {
    super(500, 'DDL_COMPILE_FAILED', message, details);
  }
}

type Db = Kysely<Record<string, Record<string, unknown>>>;

export interface CompileContext {
  db: Db;
  dialect: Dialect;
  serverVersion: string | null;
  /** The table's desired shape — needed for `create-table` and MySQL restatements. */
  desired?: TableModel | undefined;
  /** The table's shape BEFORE the step, for MySQL's full-definition restatement. */
  actual?: TableModel | undefined;
  /** FKs the step operates on, when it is an FK step. */
  relation?: Relation | undefined;
  /**
   * EVERY foreign key the desired table declares — `create-table` inlines them.
   *
   * Not `relation` widened: that one is the single constraint an `add-fk` or
   * `drop-fk` step is about, matched by the step's own column. A CREATE is
   * about all of them at once, and on SQLite inlining is the only way the
   * table can have a foreign key at all.
   */
  relations?: readonly Relation[] | undefined;
  /** Enum value lists by column, for the D32 CHECK. */
  enumValues?: Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * Native type per FK SOURCE column, taken from the column it references.
   *
   * A foreign-key column is not independently typed: it has to match its
   * target, and on MySQL "match" includes SIGNEDNESS. Adminium's vocabulary has
   * one `integer`, which compiles to a signed `integer`, so linking to the
   * near-universal `int unsigned` auto-increment key produced
   *
   *   Referencing column 'client_id' and referenced column 'id' in foreign key
   *   constraint 'fk_bookings_client_id' are incompatible.
   *
   * …at APPLY, after the review pane had promised the statement would run.
   * Verified against a real MySQL 26.7 server.
   *
   * This is not a widening of D30's closed authoring vocabulary. The operator
   * chooses "links to clients"; the storage type of the column that implements
   * that link is a consequence of the target, not a thing anyone authors, and
   * postgres and sqlite reach the same answer through their own type rules.
   */
  fkColumnTypes?: Readonly<Record<string, string>> | undefined;
  /**
   * SQLite `drop-table` only: the table is in a foreign-key cycle with a table
   * this plan drops after it, so the DROP runs with enforcement off.
   *
   * SQLite has no `DROP CONSTRAINT` to break the cycle with, and its DROP TABLE
   * runs an implicit DELETE that fails once rows link the two tables both ways
   * — in either order. Postgres and MySQL get a `drop-fk` step instead.
   */
  withoutForeignKeys?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Identifier and literal rendering
// ---------------------------------------------------------------------------

/** Quote an identifier for a raw template, per dialect. */
export function quoteIdent(identifier: string, dialect: Dialect): string {
  if (!IDENTIFIER_RE.test(identifier)) {
    // Unreachable through the authoring path; reachable if a snapshot ever
    // carries a name the introspector read from a database that permits one.
    // Quote it rather than refuse — but double the quote character first.
    const escaped =
      dialect === 'mysql' ? identifier.replaceAll('`', '``') : identifier.replaceAll('"', '""');
    return dialect === 'mysql' ? `\`${escaped}\`` : `"${escaped}"`;
  }
  return dialect === 'mysql' ? `\`${identifier}\`` : `"${identifier}"`;
}

/**
 * A string literal for a CHECK expression or a default.
 *
 * Doubling the quote is enough for postgres and sqlite. **MySQL also treats a
 * backslash as an escape inside a string literal** unless the server runs with
 * `NO_BACKSLASH_ESCAPES`, which cannot be assumed of somebody else's database
 * — so a value ending in a backslash would otherwise escape the closing quote
 * and run the rest of the list as SQL. `install-ddl.ts:340-352` paid for this
 * lesson once; it is not being paid for again.
 */
export function quoteLiteral(value: string, dialect: Dialect): string {
  const escaped =
    dialect === 'mysql'
      ? value.replaceAll('\\', '\\\\').replaceAll("'", "''")
      : value.replaceAll("'", "''");
  return `'${escaped}'`;
}

/** The unqualified name a statement should use, per dialect. */
function tableRef(tableId: string, dialect: Dialect): string {
  // Ids are `schema.name`; only postgres has schemas worth qualifying with.
  const dot = tableId.lastIndexOf('.');
  const schema = dot === -1 ? null : tableId.slice(0, dot);
  const name = dot === -1 ? tableId : tableId.slice(dot + 1);
  if (dialect === 'postgres' && schema !== null && schema !== '') {
    return `${quoteIdent(schema, dialect)}.${quoteIdent(name, dialect)}`;
  }
  return quoteIdent(name, dialect);
}

/** The bare table name Kysely's builders want (they quote it themselves). */
function bareName(tableId: string): string {
  const dot = tableId.lastIndexOf('.');
  return dot === -1 ? tableId : tableId.slice(dot + 1);
}

/**
 * Render a column's DEFAULT clause. Only the five closed kinds D30 admits can
 * reach here from authoring; an `expression` is passed through verbatim,
 * which happens only when it came out of a snapshot unchanged.
 */
export function renderDefault(
  column: Pick<ColumnModel, 'default' | 'logicalType'>,
  dialect: Dialect,
): string | null {
  const value = column.default;
  if (value === null) return null;
  switch (value.kind) {
    case 'literal':
      // Numbers and booleans are emitted bare; everything else is a string
      // literal. The validator has already proved the text matches the type.
      switch (column.logicalType) {
        case 'integer':
        case 'bigint':
        case 'decimal':
        case 'float':
          return value.text;
        case 'boolean':
          return dialect === 'postgres' ? value.text : value.text === 'true' ? '1' : '0';
        default:
          return quoteLiteral(value.text, dialect);
      }
    case 'expression':
      return value.text;
    case 'now':
      /*
       * SQLite has no zone: its timestamp is a wall clock, and every value
       * Adminium writes into one is the SERVER's (`write-values.ts`,
       * `instants.ts`). A bare `datetime('now')` is UTC's — so a row the
       * database stamped and a row Adminium wrote sat hours apart in the same
       * column. `localtime` makes them one clock.
       */
      return dialect === 'sqlite' ? "(datetime('now', 'localtime'))" : 'CURRENT_TIMESTAMP';
    case 'uuid':
      // D31: offered on postgres only, and the validator refuses it elsewhere.
      if (dialect !== 'postgres') {
        throw new DdlCompileError('a database-generated uuid default is Postgres-only');
      }
      return 'gen_random_uuid()';
    case 'autoincrement':
      // Not a DEFAULT at all — it is part of the column's identity clause and
      // is handled by `identityClause`. Returning null keeps it out of DEFAULT.
      return null;
  }
}

/**
 * The identity/auto-increment clause for a generated key (D31). Per dialect,
 * because the CRUD insert path reads the key back differently on each:
 * RETURNING on pg and sqlite, `insertId` on MySQL — and `insertId` only works
 * for a single auto-increment column.
 */
function identityClause(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return 'GENERATED BY DEFAULT AS IDENTITY';
    case 'mysql':
      return 'AUTO_INCREMENT';
    case 'sqlite':
      // `INTEGER PRIMARY KEY` IS the rowid alias on SQLite; `AUTOINCREMENT`
      // adds a monotonic guarantee nobody asked for and a write cost.
      return '';
    default:
      return '';
  }
}

/** Is this column the table's generated key? */
function isGeneratedKey(column: ColumnModel, table: TableModel): boolean {
  return (
    column.default?.kind === 'autoincrement' &&
    table.primaryKey.length === 1 &&
    table.primaryKey[0] === column.name
  );
}

/** One column's full definition, as MySQL's `modifyColumn` and CREATE need it. */
/**
 * The native TYPE for a column, and nothing else.
 *
 * `compileCreateTable` used to take `columnDefinition(...).split(' ')[0]`,
 * which is right only for a single-word type. It is wrong for every type this
 * map can actually produce with a space in it — `double precision` on
 * postgres became `double`, which postgres does not have — and it silently
 * truncated the FK type override (`int unsigned` → `int`), which is the whole
 * point of the override. Found while fixing the MySQL FK signedness failure.
 */
export function columnTypeOf(
  column: ColumnModel,
  dialect: Dialect,
  typeOverride?: string | undefined,
): string {
  if (typeOverride !== undefined) return typeOverride;
  const authorable = column.logicalType;
  if (
    authorable === 'binary' ||
    authorable === 'interval' ||
    authorable === 'geometry' ||
    authorable === 'inet' ||
    authorable === 'unknown'
  ) {
    return column.dbType;
  }
  return ddlTypeFor(
    {
      logicalType: authorable,
      maxLength: column.maxLength,
      numericPrecision: column.numericPrecision,
      numericScale: column.numericScale,
    },
    dialect,
  );
}

export function columnDefinition(
  column: ColumnModel,
  table: TableModel,
  dialect: Dialect,
  opts: { includeName?: boolean; typeOverride?: string | undefined } = {},
): string {
  const parts: string[] = [];
  if (opts.includeName !== false) parts.push(quoteIdent(column.name, dialect));

  // A column coming back out of a snapshot may be a display-only type (D30) —
  // `columnTypeOf` keeps its verbatim `dbType` rather than refusing to restate
  // it, and applies the FK override when there is one.
  const type = columnTypeOf(column, dialect, opts.typeOverride);

  if (dialect === 'sqlite' && isGeneratedKey(column, table)) {
    // The one shape SQLite recognises as a generated key.
    parts.push('integer');
    parts.push('PRIMARY KEY');
    return parts.join(' ');
  }

  parts.push(type);
  if (!column.nullable) parts.push('NOT NULL');

  if (isGeneratedKey(column, table)) {
    const clause = identityClause(dialect);
    if (clause !== '') parts.push(clause);
  } else {
    const def = renderDefault(column, dialect);
    if (def !== null) parts.push(`DEFAULT ${def}`);
  }

  if (column.comment !== null && dialect === 'mysql') {
    // MySQL carries the comment inside the column definition; pg has a
    // separate COMMENT ON statement, and sqlite has none at all.
    parts.push(`COMMENT ${quoteLiteral(column.comment, dialect)}`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// MySQL algorithm assertions
// ---------------------------------------------------------------------------

/**
 * Append MySQL's `ALGORITHM=`/`LOCK=` assertion so the SERVER enforces the
 * hazard this plan predicted. Where says `safe`, the statement demands
 * `ALGORITHM=INSTANT`; where it says `locking` without a rewrite,
 * `ALGORITHM=INPLACE, LOCK=NONE`. A server that cannot honour the clause
 * FAILS the statement rather than silently copying the table — which turns
 * the hazard badge from a guess into a contract.
 *
 * MariaDB is left alone: it has a fifth algorithm (`NOCOPY`) MySQL lacks and
 * from 11.2 defaults `ALTER TABLE` to `ALGORITHM=COPY, LOCK=NONE`, so emitting
 * MySQL's set at it is a real divergence — and CI runs no MariaDB service, so
 * an assertion nobody can test is a liability, not a safeguard.
 */
export function mysqlAlgorithmClause(
  hazard: DdlStep['hazard'],
  opts: { isMariaDb?: boolean } = {},
): string {
  if (opts.isMariaDb === true) return '';
  if (hazard === 'safe') return ', ALGORITHM=INSTANT';
  if (hazard === 'locking') return ', ALGORITHM=INPLACE, LOCK=NONE';
  return '';
}

// ---------------------------------------------------------------------------
// The session rails
// ---------------------------------------------------------------------------

/**
 * Statements that set the safety rails for one apply.
 *
 * Postgres: `SET LOCAL` inside the wrapping transaction, so the setting dies
 * with it. `lock_timeout` defaults to `0` — wait forever — and a WAITING
 * `ACCESS EXCLUSIVE` request parks every later `SELECT` behind it, so a 200 ms
 * metadata-only ALTER queued behind one long query is a total table outage.
 * This is the single most important statement in the file.
 *
 * MySQL: `SET SESSION`, because there is no transaction to scope it to.
 * `lock_wait_timeout` defaults to **31536000 seconds — one year**. The caller
 * resets it in `finally` (D10), which is why {@link resetRails} exists.
 */
export function sessionRails(
  dialect: Dialect,
  db: Db,
  opts: { lockTimeoutMs?: number; statementTimeoutMs?: number } = {},
): CompiledQuery[] {
  const lock = opts.lockTimeoutMs ?? 5_000;
  const statement = opts.statementTimeoutMs ?? 300_000;
  switch (dialect) {
    case 'postgres':
      return [
        sql.raw(`SET LOCAL lock_timeout = '${lock}ms'`).compile(db),
        sql.raw(`SET LOCAL statement_timeout = '${statement}ms'`).compile(db),
      ];
    case 'mysql':
      return [
        sql.raw(`SET SESSION lock_wait_timeout = ${Math.ceil(lock / 1000)}`).compile(db),
        sql.raw(`SET SESSION max_execution_time = ${statement}`).compile(db),
      ];
    default:
      /*
       * SQLite's busy_timeout is set by the adapter's data pragmas already.
       *
       * What SQLite needs instead is a READ before the first DDL. A connection
       * prepares against the schema it cached, and learns that another
       * connection changed it only when a statement RUNS and finds the schema
       * cookie moved. A DML statement re-prepares and never shows it; an
       * `ALTER TABLE … ADD COLUMN` is refused while it is prepared — "duplicate
       * column name" for a column another program has since dropped — so it
       * never runs far enough to find out. Reading the schema table runs, which
       * makes the connection reload what it cached.
       */
      return [sql.raw('SELECT count(*) FROM sqlite_master').compile(db)];
  }
}

/**
 * Undo {@link sessionRails} on a connection that outlives the apply (D10).
 *
 * On SQLite, foreign-key enforcement: a `drop-table` compiled
 * `withoutForeignKeys` turns it off around its DROP, and a DROP that fails
 * never reaches the statement that turns it back on. The adapter opens every
 * data connection with it on, which is the state this restores.
 */
export function resetRails(dialect: Dialect, db: Db): CompiledQuery[] {
  if (dialect === 'sqlite') return [sql.raw(FOREIGN_KEYS_ON).compile(db)];
  return dialect === 'mysql'
    ? [
        sql.raw('SET SESSION lock_wait_timeout = DEFAULT').compile(db),
        sql.raw('SET SESSION max_execution_time = DEFAULT').compile(db),
      ]
    : [];
}

const FOREIGN_KEYS_ON = 'PRAGMA foreign_keys = on';

// ---------------------------------------------------------------------------
// Step compilation
// ---------------------------------------------------------------------------

/**
 * Compile one step into the statements that perform it.
 *
 * Returns an array because several kinds are genuinely more than one
 * statement — a postgres comment is its own `COMMENT ON`, an FK over the
 * warning line is `NOT VALID` plus a later `VALIDATE`, and the SQLite rebuild
 * is twelve.
 */
export function compileStep(step: DdlStep, ctx: CompileContext): CompiledQuery[] {
  const { db, dialect } = ctx;
  const t = tableRef(step.table, dialect);
  const raw = (text: string): CompiledQuery => sql.raw(text).compile(db);

  switch (step.kind) {
    case 'create-table':
      return compileCreateTable(step, ctx);

    case 'drop-table': {
      const drop = db.schema.dropTable(bareName(step.table)).compile();
      if (dialect !== 'sqlite' || ctx.withoutForeignKeys !== true) return [drop];
      // Outside any transaction, where the pragma takes effect: the apply runs
      // SQLite's statements one by one. `resetRails` turns enforcement back on
      // if the DROP fails before the last statement does.
      return [raw('PRAGMA foreign_keys = off'), drop, raw(FOREIGN_KEYS_ON)];
    }

    case 'rename-table': {
      const to = ctx.desired?.name;
      if (to === undefined) throw new DdlCompileError('rename-table needs the desired name', step);
      return [raw(`ALTER TABLE ${t} RENAME TO ${quoteIdent(to, dialect)}`)];
    }

    case 'rename-column': {
      // The planner's own answer. Never re-derived from the desired table:
      // "the column that is not `from`" is every other column, and the old
      // guess picked the first — `id` — for every rename.
      const from = step.column;
      const to = step.renameTo ?? null;
      if (from === null || to === null) {
        throw new DdlCompileError('rename-column needs both names', step);
      }
      return [
        raw(
          `ALTER TABLE ${t} RENAME COLUMN ${quoteIdent(from, dialect)} TO ${quoteIdent(to, dialect)}`,
        ),
      ];
    }

    case 'add-column': {
      const column = columnOf(ctx.desired, step.column, step);
      const table = ctx.desired!;
      const clause = dialect === 'mysql' ? mysqlAlgorithmClause(step.hazard) : '';
      /*
       * SQLite's one in-place constraint: a link on the column being added
       * (the planner leaves out the add-fk it would otherwise rebuild for).
       * Postgres and MySQL add it as its own step.
       */
      const link =
        dialect === 'sqlite' &&
        ctx.relation !== undefined &&
        ctx.relation.kind === 'declared-fk' &&
        ctx.relation.from.columns.length === 1 &&
        ctx.relation.from.columns[0] === column.name
          ? ` REFERENCES ${tableRef(ctx.relation.to.tableId, dialect)} (${ctx.relation.to.columns.map((c) => quoteIdent(c, dialect)).join(', ')})` +
            (ctx.relation.onDelete === null ? '' : ` ON DELETE ${fkAction(ctx.relation.onDelete)}`)
          : '';
      const statements = [
        raw(
          `ALTER TABLE ${t} ADD COLUMN ${columnDefinition(column, table, dialect, {
            typeOverride: ctx.fkColumnTypes?.[column.name],
          })}${link}${clause}`,
        ),
      ];
      // An enum column carries its CHECK (D32) as part of becoming an enum.
      const values = ctx.enumValues?.[column.name];
      if (values !== undefined && values.length > 0) {
        statements.push(
          raw(checkStatement(t, column.name, values, dialect, enumCheckName(step.table, column.name))),
        );
      }
      if (dialect === 'postgres' && column.comment !== null) {
        statements.push(raw(commentOnColumn(t, column.name, column.comment, dialect)));
      }
      return statements;
    }

    case 'drop-column': {
      const name = requireColumn(step);
      const clause = dialect === 'mysql' ? mysqlAlgorithmClause(step.hazard) : '';
      return [raw(`ALTER TABLE ${t} DROP COLUMN ${quoteIdent(name, dialect)}${clause}`)];
    }

    case 'alter-column-type': {
      const column = columnOf(ctx.desired, step.column, step);
      const table = ctx.desired!;
      if (dialect === 'mysql') {
        // MODIFY COLUMN restates the WHOLE definition — nullability, default
        // and comment included — so anything not carried forward is silently
        // dropped. This is the single most likely correctness bug in the file
        // and is why `columnDefinition` takes the whole column.
        return [
          raw(
            `ALTER TABLE ${t} MODIFY COLUMN ${columnDefinition(column, table, dialect)}` +
              mysqlAlgorithmClause(step.hazard),
          ),
        ];
      }
      // The whole type, not its first word: `ALTER COLUMN x TYPE double`
      // is not a statement postgres accepts, and `double precision` is what
      // the map returns for a float.
      const type = columnTypeOf(column, dialect, ctx.fkColumnTypes?.[column.name]);
      // `USING` is required when no assignment cast exists; emitting it always
      // is harmless and covers the cases where it is not optional.
      return [
        raw(
          `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(column.name, dialect)} TYPE ${type} ` +
            `USING ${quoteIdent(column.name, dialect)}::${type}`,
        ),
      ];
    }

    case 'set-not-null':
    case 'drop-not-null': {
      const name = requireColumn(step);
      if (dialect === 'mysql') {
        const column = columnOf(ctx.desired, name, step);
        return [
          raw(
            `ALTER TABLE ${t} MODIFY COLUMN ${columnDefinition(column, ctx.desired!, dialect)}` +
              mysqlAlgorithmClause(step.hazard),
          ),
        ];
      }
      const verb = step.kind === 'set-not-null' ? 'SET NOT NULL' : 'DROP NOT NULL';
      return [raw(`ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(name, dialect)} ${verb}`)];
    }

    case 'set-default':
    case 'drop-default': {
      const name = requireColumn(step);
      if (dialect === 'mysql') {
        const column = columnOf(ctx.desired, name, step);
        return [
          raw(
            `ALTER TABLE ${t} MODIFY COLUMN ${columnDefinition(column, ctx.desired!, dialect)}` +
              mysqlAlgorithmClause(step.hazard),
          ),
        ];
      }
      if (step.kind === 'drop-default') {
        return [raw(`ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(name, dialect)} DROP DEFAULT`)];
      }
      const column = columnOf(ctx.desired, name, step);
      const def = renderDefault(column, dialect);
      if (def === null) throw new DdlCompileError('set-default with no default', step);
      return [raw(`ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(name, dialect)} SET DEFAULT ${def}`)];
    }

    case 'set-comment': {
      const name = requireColumn(step);
      const column = columnOf(ctx.desired, name, step);
      if (dialect === 'mysql') {
        return [
          raw(`ALTER TABLE ${t} MODIFY COLUMN ${columnDefinition(column, ctx.desired!, dialect)}`),
        ];
      }
      return [raw(commentOnColumn(t, name, column.comment, dialect))];
    }

    case 'set-table-comment': {
      const comment = ctx.desired?.comment ?? null;
      if (dialect === 'mysql') {
        return [
          raw(`ALTER TABLE ${t} COMMENT = ${comment === null ? "''" : quoteLiteral(comment, dialect)}`),
        ];
      }
      return [
        raw(`COMMENT ON TABLE ${t} IS ${comment === null ? 'NULL' : quoteLiteral(comment, dialect)}`),
      ];
    }

    case 'add-fk': {
      const relation = requireRelation(ctx, step);
      const name = relation.constraintName ?? defaultFkName(relation);
      const cols = relation.from.columns.map((c) => quoteIdent(c, dialect)).join(', ');
      const refCols = relation.to.columns.map((c) => quoteIdent(c, dialect)).join(', ');
      const actions = [
        relation.onDelete === null ? '' : ` ON DELETE ${fkAction(relation.onDelete)}`,
        relation.onUpdate === null ? '' : ` ON UPDATE ${fkAction(relation.onUpdate)}`,
      ].join('');
      // NOT VALID on postgres: the constraint is enforced for new rows
      // immediately and validated later under a gentler lock. The
      // planner decides when, by emitting a `validate-fk` step beside this one.
      const notValid =
        dialect === 'postgres' && step.dependsOn.length === 0 && stepHasValidatePartner(step)
          ? ' NOT VALID'
          : '';
      return [
        raw(
          `ALTER TABLE ${t} ADD CONSTRAINT ${quoteIdent(name, dialect)} ` +
            `FOREIGN KEY (${cols}) REFERENCES ${tableRef(relation.to.tableId, dialect)} (${refCols})` +
            `${actions}${notValid}`,
        ),
      ];
    }

    case 'validate-fk': {
      const relation = requireRelation(ctx, step);
      const name = relation.constraintName ?? defaultFkName(relation);
      return [raw(`ALTER TABLE ${t} VALIDATE CONSTRAINT ${quoteIdent(name, dialect)}`)];
    }

    case 'drop-fk': {
      const relation = requireRelation(ctx, step);
      const name = relation.constraintName ?? defaultFkName(relation);
      const verb = dialect === 'mysql' ? 'DROP FOREIGN KEY' : 'DROP CONSTRAINT';
      return [raw(`ALTER TABLE ${t} ${verb} ${quoteIdent(name, dialect)}`)];
    }

    case 'add-unique': {
      const cols = requireColumns(ctx, step);
      const name = `uq_${bareName(step.table)}_${cols.join('_')}`;
      return [
        raw(
          `ALTER TABLE ${t} ADD CONSTRAINT ${quoteIdent(name, dialect)} UNIQUE (` +
            `${cols.map((c) => quoteIdent(c, dialect)).join(', ')})`,
        ),
      ];
    }

    case 'drop-unique': {
      const name = step.column ?? `uq_${bareName(step.table)}`;
      const verb = dialect === 'mysql' ? 'DROP INDEX' : 'DROP CONSTRAINT';
      return [raw(`ALTER TABLE ${t} ${verb} ${quoteIdent(name, dialect)}`)];
    }

    case 'add-check': {
      const column = requireColumn(step);
      const values = ctx.enumValues?.[column] ?? [];
      if (values.length === 0) throw new DdlCompileError('add-check needs an enum value list', step);
      return [
        raw(
          checkStatement(
            t,
            column,
            values,
            dialect,
            step.constraint ?? enumCheckName(step.table, column),
          ),
        ),
      ];
    }

    case 'drop-check': {
      /*
       * The constraint's REAL name, which the snapshot knows and the planner
       * now carries. The old fallback — `ck_<table>` — was a name no engine
       * ever assigns, so dropping a database's own CHECK (to widen an enum, say)
       * always failed on a constraint that did not exist.
       */
      const name =
        step.constraint ??
        (step.column === null ? `ck_${bareName(step.table)}` : enumCheckName(step.table, step.column));
      // MySQL 8.0.16+ spells it DROP CHECK; DROP CONSTRAINT arrived in 8.0.19
      // and drops any kind, which is more than this step means.
      const verb = dialect === 'mysql' ? 'DROP CHECK' : 'DROP CONSTRAINT';
      return [raw(`ALTER TABLE ${t} ${verb} ${quoteIdent(name, dialect)}`)];
    }

    /*
     * Auto-increment on a key that already exists (D23). Every clause here was
     * run against the real servers before it was written down:
     *
     *  - postgres 18.3: ADD GENERATED leaves `pg_relation_filenode` alone, and
     *    the fresh sequence starts at 1 — with rows already in the table the
     *    very next insert failed on the primary key. The `setval` is therefore
     *    part of the step, not a nicety, and it computes the floor in the
     *    database so the statement needs no round trip to build.
     *  - mysql 26.7: MODIFY … AUTO_INCREMENT refuses INSTANT and INPLACE, and
     *    continues numbering from the highest existing value on its own.
     *  - sqlite: the planner collapses this into `rebuild-table`.
     */
    case 'set-identity': {
      const name = requireColumn(step);
      if (dialect === 'sqlite') {
        throw new DdlCompileError('set-identity on sqlite is done by the rebuild', step);
      }
      if (dialect === 'mysql') {
        const column = columnOf(ctx.desired, name, step);
        return [raw(`ALTER TABLE ${t} MODIFY COLUMN ${columnDefinition(column, ctx.desired!, dialect)}`)];
      }
      return [
        raw(
          `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(name, dialect)} ` +
            'ADD GENERATED BY DEFAULT AS IDENTITY',
        ),
        raw(
          `SELECT setval(pg_get_serial_sequence(${quoteLiteral(step.table, dialect)}, ` +
            `${quoteLiteral(name, dialect)}), ` +
            `COALESCE((SELECT MAX(${quoteIdent(name, dialect)}) FROM ${t}), 0) + 1, false)`,
        ),
      ];
    }

    case 'drop-identity': {
      const name = requireColumn(step);
      if (dialect === 'sqlite') {
        throw new DdlCompileError('drop-identity on sqlite is done by the rebuild', step);
      }
      if (dialect === 'mysql') {
        const column = columnOf(ctx.desired, name, step);
        return [raw(`ALTER TABLE ${t} MODIFY COLUMN ${columnDefinition(column, ctx.desired!, dialect)}`)];
      }
      // IF EXISTS for D3's re-runnability: a retry after a partial apply must
      // complete the change rather than collide with its own first half.
      return [
        raw(`ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(name, dialect)} DROP IDENTITY IF EXISTS`),
      ];
    }

    case 'add-index': {
      const cols = requireColumns(ctx, step);
      const name = `ix_${bareName(step.table)}_${cols.join('_')}`;
      const concurrently = step.outsideTransaction && dialect === 'postgres' ? 'CONCURRENTLY ' : '';
      return [
        raw(
          `CREATE INDEX ${concurrently}${quoteIdent(name, dialect)} ON ${t} (` +
            `${cols.map((c) => quoteIdent(c, dialect)).join(', ')})`,
        ),
      ];
    }

    case 'drop-index': {
      const name = step.column ?? `ix_${bareName(step.table)}`;
      return dialect === 'mysql'
        ? [raw(`ALTER TABLE ${t} DROP INDEX ${quoteIdent(name, dialect)}`)]
        : [raw(`DROP INDEX ${quoteIdent(name, dialect)}`)];
    }

    case 'set-pk': {
      const cols = ctx.desired?.primaryKey ?? [];
      if (cols.length === 0) throw new DdlCompileError('set-pk with an empty key', step);
      const rendered = cols.map((c) => quoteIdent(c, dialect)).join(', ');
      return dialect === 'mysql'
        ? [raw(`ALTER TABLE ${t} ADD PRIMARY KEY (${rendered})`)]
        : [
            raw(
              `ALTER TABLE ${t} ADD CONSTRAINT ${quoteIdent(`pk_${bareName(step.table)}`, dialect)} ` +
                `PRIMARY KEY (${rendered})`,
            ),
          ];
    }

    case 'drop-pk':
      return dialect === 'mysql'
        ? [raw(`ALTER TABLE ${t} DROP PRIMARY KEY`)]
        : [
            raw(
              `ALTER TABLE ${t} DROP CONSTRAINT ${quoteIdent(`pk_${bareName(step.table)}`, dialect)}`,
            ),
          ];

    case 'add-enum-value':
      // D32 keeps NEW enum columns CHECK-backed on all three dialects, so this
      // step is only reachable for an enum that ALREADY exists as a native pg
      // type — which no Adminium-authored schema creates. It stays in the
      // vocabulary because a snapshot can contain one, and it refuses loudly
      // rather than emitting an `ALTER TYPE` this wave has not tested.
      throw new DdlCompileError(
        'extending a native Postgres enum is not compiled in this wave; new enum columns are CHECK-backed (D32)',
        step,
      );

    case 'rebuild-table':
      throw new DdlCompileError(
        'rebuild-table is compiled by the SQLite rebuild module, not here',
        step,
      );
  }
}

// ---------------------------------------------------------------------------

function compileCreateTable(step: DdlStep, ctx: CompileContext): CompiledQuery[] {
  const table = ctx.desired;
  if (table === undefined) throw new DdlCompileError('create-table needs the desired table', step);
  const { db, dialect } = ctx;

  // Kysely's builder, exactly as `install-ddl.ts:278-312` uses it — the same
  // `ifNotExists()` for the same reason (D3: re-runnable, because MySQL cannot
  // roll back and a retry must complete a partial apply rather than collide).
  let builder: CreateTableBuilder<string, string> = db.schema
    .createTable(bareName(table.id))
    .ifNotExists();

  /*
   * A single-column key is declared ON THE COLUMN; only a composite key needs a
   * table-level constraint.
   *
   * This was the other way round, and the consequence was severe: a
   * single-column GENERATED key fell through both branches and no key was
   * emitted at all. Every table created from Design mode on Postgres came out
   * as `id integer generated by default as identity not null` with **no primary
   * key** — which the CRUD layer reads exactly as it should ("this table has no
   * primary key and is read-only"), so a table created in Studio could not have
   * a row added to it from the page Studio then generated for it. On MySQL it
   * would not have been created at all: `AUTO_INCREMENT` on a column that is not
   * a key is an error there, not a warning.
   *
   * Found by inserting a row through the generated page — the last clause of
   * criterion 1, and the only step of the round trip that no test performed.
   */
  const singleKey =
    table.primaryKey.length === 1
      ? table.columns.find((c) => c.name === table.primaryKey[0])
      : undefined;

  for (const column of table.columns) {
    const type = columnTypeOf(column, dialect, ctx.fkColumnTypes?.[column.name]);
    builder = builder.addColumn(column.name, sql.raw(type), (col) => {
      let built = col;
      const isTheKey = singleKey !== undefined && singleKey.name === column.name;
      if (dialect === 'sqlite' && isGeneratedKey(column, table)) {
        // `INTEGER PRIMARY KEY` is the rowid alias — the only spelling SQLite
        // auto-assigns, and it must carry nothing else (no NOT NULL, no
        // AUTOINCREMENT) to stay one.
        return built.primaryKey();
      }
      if (!column.nullable) built = built.notNull();
      if (isGeneratedKey(column, table)) {
        built = dialect === 'postgres' ? built.generatedByDefaultAsIdentity() : built.autoIncrement();
      } else {
        const def = renderDefault(column, dialect);
        if (def !== null) built = built.defaultTo(sql.raw(def));
      }
      if (isTheKey) built = built.primaryKey();
      const values = ctx.enumValues?.[column.name];
      if (values !== undefined && values.length > 0) {
        built = built.check(
          sql.raw(
            `${quoteIdent(column.name, dialect)} in (` +
              `${values.map((v) => quoteLiteral(v, dialect)).join(', ')})`,
          ),
        );
      }
      return built;
    });
  }

  // Composite keys only — a single-column key was declared on the column above.
  if (table.primaryKey.length > 1) {
    builder = builder.addPrimaryKeyConstraint(`pk_${bareName(table.id)}`, table.primaryKey as never);
  }

  for (const unique of table.uniques) {
    builder = builder.addUniqueConstraint(
      unique.name ?? `uq_${bareName(table.id)}_${unique.columns.join('_')}`,
      unique.columns as never,
    );
  }

  /*
   * The table's links, inline (planner note).
   *
   * SQLite is the reason this is here rather than in a following `add-fk`
   * step: it has no `ALTER TABLE … ADD CONSTRAINT`, so a new table's foreign
   * key emitted as its own statement is a syntax error and the apply lands
   * `partial` — table created, link missing, and only the second half reported
   * as a failure. Inline is also the only shape that cannot half-apply.
   */
  for (const relation of ctx.relations ?? []) {
    if (relation.from.tableId !== table.id) continue;
    const name =
      relation.constraintName ??
      `fk_${bareName(table.id)}_${relation.from.columns.join('_')}`;
    builder = builder.addForeignKeyConstraint(
      name,
      relation.from.columns as never,
      bareName(relation.to.tableId),
      relation.to.columns as never,
      (fk) => {
        let built = fk;
        // Kysely's own vocabulary, which is lower case and space-separated —
        // NOT `fkAction`'s SQL keywords. Passing `SET NULL` here throws
        // `invalid OnModifyForeignAction`, which the compile guard turns into a
        // `-- could not render` comment and the apply then reports as a failed
        // step. Loud, but only after the CREATE was already attempted.
        if (relation.onDelete !== null) built = built.onDelete(builderFkAction(relation.onDelete));
        if (relation.onUpdate !== null) built = built.onUpdate(builderFkAction(relation.onUpdate));
        return built;
      },
    );
  }

  return [builder.compile()];
}

/**
 * The name a NEW enum CHECK gets.
 *
 * Table-qualified, and that is not tidiness: MySQL requires a constraint name
 * to be unique **per schema**, not per table, so the old `ck_<column>` made a
 * second table with a `status` enum fail to create against a name the operator
 * never chose and could not see. Postgres and SQLite scope it to the table and
 * do not mind the longer name.
 */
export function enumCheckName(tableId: string, column: string): string {
  return `ck_${bareName(tableId)}_${column}`;
}

function checkStatement(
  table: string,
  column: string,
  values: readonly string[],
  dialect: Dialect,
  name: string,
): string {
  const list = values.map((v) => quoteLiteral(v, dialect)).join(', ');
  return (
    `ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdent(name, dialect)} ` +
    `CHECK (${quoteIdent(column, dialect)} IN (${list}))`
  );
}

function commentOnColumn(
  table: string,
  column: string,
  comment: string | null,
  dialect: Dialect,
): string {
  const value = comment === null ? 'NULL' : quoteLiteral(comment, dialect);
  return `COMMENT ON COLUMN ${table}.${quoteIdent(column, dialect)} IS ${value}`;
}

/** The same five actions in Kysely's spelling, for the builder path. */
function builderFkAction(
  action: NonNullable<Relation['onDelete']>,
): 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action' {
  switch (action) {
    case 'cascade':
      return 'cascade';
    case 'restrict':
      return 'restrict';
    case 'set-null':
      return 'set null';
    case 'set-default':
      return 'set default';
    case 'no-action':
      return 'no action';
  }
}

export function fkAction(action: NonNullable<Relation['onDelete']>): string {
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

function defaultFkName(relation: Relation): string {
  const from = relation.from.tableId.split('.').pop() ?? relation.from.tableId;
  return `fk_${from}_${relation.from.columns.join('_')}`;
}

function stepHasValidatePartner(step: DdlStep): boolean {
  // The planner marks the pair by giving the add step a summary that names the
  // deferred validation; a plan without one wants the constraint validated now.
  return step.summary.includes('validated separately');
}

function columnOf(
  table: TableModel | undefined,
  name: string | null,
  step: DdlStep,
): ColumnModel {
  if (table === undefined || name === null) {
    throw new DdlCompileError(`${step.kind} needs the desired column`, step);
  }
  const column = table.columns.find((c) => c.name === name);
  if (column === undefined) {
    throw new DdlCompileError(`${name} is not in the desired table`, step);
  }
  return column;
}

function requireColumn(step: DdlStep): string {
  if (step.column === null) throw new DdlCompileError(`${step.kind} needs a column`, step);
  return step.column;
}

function requireColumns(ctx: CompileContext, step: DdlStep): string[] {
  // The constraint's columns come off the desired table's matching constraint;
  // the planner's summary names them, and the desired model is authoritative.
  const table = ctx.desired;
  if (table === undefined) throw new DdlCompileError(`${step.kind} needs the desired table`, step);
  if (step.column !== null) return [step.column];
  const fromUnique = table.uniques[0]?.columns;
  const fromIndex = table.indexes[0]?.columns;
  const cols = fromUnique ?? fromIndex;
  if (cols === undefined || cols.length === 0) {
    throw new DdlCompileError(`${step.kind} has no columns`, step);
  }
  return [...cols];
}

function requireRelation(ctx: CompileContext, step: DdlStep): Relation {
  if (ctx.relation === undefined) {
    throw new DdlCompileError(`${step.kind} needs the relation it operates on`, step);
  }
  return ctx.relation;
}
