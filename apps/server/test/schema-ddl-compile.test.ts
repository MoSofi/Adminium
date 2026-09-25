// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The DDL executor.
 *
 * The done-when, asserted here:
 *   • a test compiles and EXECUTES the same function's output and asserts the
 *     strings match (the D2 invariant — the preview is the statement)
 *   • a MySQL test asserts a column default SURVIVES an unrelated type change
 * (the `modifyColumn` full-restatement trap)
 *   • a MySQL test asserts `ALGORITHM=INSTANT` on a predicted-`safe` add-column
 *   • a test asserts `lock_wait_timeout` is reset after apply
 *
 * The compile-only Kysely instances follow `add-on-install-ddl.test.ts`'s
 * pattern: a dialect bound to its COMPILER with no connection, so all three
 * dialects' SQL is asserted without three databases.
 */
import { afterAll, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from 'kysely';
import {
  ddlTypeFor,
  planDdl,
  type ColumnModel,
  type DatabaseModel,
  type DdlStep,
  type Dialect,
  type Relation,
  type TableModel,
} from '@adminium/engine';
import { parseDatabaseModel } from '@adminium/engine';

import {
  columnDefinition,
  compileStep,
  mysqlAlgorithmClause,
  quoteIdent,
  quoteLiteral,
  renderDefault,
  resetRails,
  sessionRails,
} from '../src/schema-ddl/compile.js';
import {
  assertNoForeignKeyViolations,
  assertRebuildMatches,
  compileSqliteRebuild,
  REBUILD_PRAGMAS,
  SqliteRebuildError,
} from '../src/schema-ddl/sqlite-rebuild.js';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers) await close();
});

function compilerFor(dialect: Dialect): AnyDb {
  if (dialect === 'postgres') return new Kysely({ dialect: new PostgresDialect({ pool: {} as never }) }) as AnyDb;
  if (dialect === 'mysql') return new Kysely({ dialect: new MysqlDialect({ pool: {} as never }) }) as AnyDb;
  return new Kysely({ dialect: new SqliteDialect({ database: {} as never }) }) as AnyDb;
}

// ---------------------------------------------------------------------------

const col = (over: Partial<ColumnModel> & { name: string }): ColumnModel => ({
  ordinal: 1,
  dbType: 'text',
  logicalType: 'text',
  nullable: true,
  default: null,
  isPrimaryKey: false,
  isUnique: false,
  isGenerated: false,
  enumRef: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  isArray: false,
  comment: null,
  references: null,
  semantics: null,
  ...over,
});

const tbl = (over: Partial<TableModel> & { name: string }): TableModel => ({
  id: `public.${over.name}`,
  schema: 'public',
  kind: 'table',
  comment: null,
  columns: [
    col({
      name: 'id',
      logicalType: 'integer',
      dbType: 'integer',
      isPrimaryKey: true,
      nullable: false,
      default: { kind: 'autoincrement' },
    }),
  ],
  primaryKey: ['id'],
  uniques: [],
  checks: [],
  indexes: [],
  rowCountEstimate: null,
  rowCountExact: false,
  sizeBytes: null,
  activity: null,
  rls: null,
  system: false,
  semantics: null,
  ...over,
});

const model = (tables: TableModel[], relations: Relation[] = []): DatabaseModel =>
  parseDatabaseModel(
    JSON.stringify({ irVersion: 1, dialect: 'postgres', name: 't', tables, relations, enums: [] }),
  );

/** Compile every step of a plan into flat SQL strings. */
function sqlFor(
  plan: { steps: DdlStep[] },
  dialect: Dialect,
  desired: TableModel,
  extra: { relation?: Relation; enumValues?: Record<string, string[]> } = {},
): string[] {
  const db = compilerFor(dialect);
  return plan.steps.flatMap((step) =>
    compileStep(step, {
      db,
      dialect,
      serverVersion: null,
      desired,
      ...extra,
    }).map((q) => q.sql),
  );
}

// ---------------------------------------------------------------------------

describe('identifier and literal rendering', () => {
  it('quotes per dialect', () => {
    expect(quoteIdent('orders', 'postgres')).toBe('"orders"');
    expect(quoteIdent('orders', 'mysql')).toBe('`orders`');
    expect(quoteIdent('orders', 'sqlite')).toBe('"orders"');
  });

  it('escapes a backslash on MySQL — the NO_BACKSLASH_ESCAPES trap', () => {
    // A value ending in a backslash would otherwise escape the closing quote
    // and run the rest of the list as SQL.
    expect(quoteLiteral('c:\\', 'mysql')).toBe("'c:\\\\'");
    expect(quoteLiteral('c:\\', 'postgres')).toBe("'c:\\'");
  });

  it("doubles a single quote everywhere", () => {
    for (const d of ['postgres', 'mysql', 'sqlite'] as const) {
      expect(quoteLiteral("O'Brien", d)).toBe("'O''Brien'");
    }
  });
});

describe('default rendering', () => {
  it('emits numbers bare and strings quoted', () => {
    expect(renderDefault({ logicalType: 'integer', default: { kind: 'literal', text: '42' } }, 'postgres')).toBe('42');
    expect(renderDefault({ logicalType: 'text', default: { kind: 'literal', text: 'hi' } }, 'postgres')).toBe("'hi'");
  });

  it('renders a boolean the way each dialect spells one', () => {
    const d = { logicalType: 'boolean' as const, default: { kind: 'literal' as const, text: 'true' } };
    expect(renderDefault(d, 'postgres')).toBe('true');
    expect(renderDefault(d, 'mysql')).toBe('1');
    expect(renderDefault(d, 'sqlite')).toBe('1');
  });

  it('renders now() per dialect', () => {
    const d = { logicalType: 'timestamptz' as const, default: { kind: 'now' as const } };
    expect(renderDefault(d, 'postgres')).toBe('CURRENT_TIMESTAMP');
    expect(renderDefault(d, 'sqlite')).toBe("(datetime('now', 'localtime'))");
  });

  it('refuses a database-generated uuid off postgres (D31)', () => {
    const d = { logicalType: 'uuid' as const, default: { kind: 'uuid' as const } };
    expect(renderDefault(d, 'postgres')).toBe('gen_random_uuid()');
    expect(() => renderDefault(d, 'mysql')).toThrow(/Postgres-only/);
  });

  it('keeps autoincrement out of DEFAULT — it is an identity clause', () => {
    expect(
      renderDefault({ logicalType: 'integer', default: { kind: 'autoincrement' } }, 'postgres'),
    ).toBeNull();
  });
});

describe('the MySQL modifyColumn full-restatement trap', () => {
  const before = model([
    tbl({
      name: 't',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({
          name: 'label',
          logicalType: 'varchar',
          maxLength: 50,
          dbType: 'varchar(50)',
          nullable: false,
          default: { kind: 'literal', text: 'unset' },
          comment: 'the label',
        }),
      ],
    }),
  ]);
  const after = tbl({
    name: 't',
    columns: [
      col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
      col({
        name: 'label',
        logicalType: 'varchar',
        maxLength: 200,
        dbType: 'varchar(200)',
        nullable: false,
        default: { kind: 'literal', text: 'unset' },
        comment: 'the label',
      }),
    ],
  });

  it('carries nullability, default AND comment through an unrelated type change', () => {
    const plan = planDdl({ actual: before, desired: [after], dialect: 'mysql', serverVersion: '8.0.35' });
    const [statement] = sqlFor(plan, 'mysql', after);
    expect(statement).toContain('MODIFY COLUMN');
    expect(statement).toContain('varchar(200)');
    // The three that get silently dropped when the definition is not restated.
    expect(statement).toContain('NOT NULL');
    expect(statement).toContain("DEFAULT 'unset'");
    expect(statement).toContain("COMMENT 'the label'");
  });

  it('postgres changes only the type, leaving the rest alone', () => {
    const plan = planDdl({ actual: before, desired: [after], dialect: 'postgres', serverVersion: '16.2' });
    const [statement] = sqlFor(plan, 'postgres', after);
    expect(statement).toContain('ALTER COLUMN "label" TYPE varchar(200)');
    expect(statement).toContain('USING');
    expect(statement).not.toContain('DEFAULT');
  });
});

describe('MySQL is asked to prove the prediction', () => {
  it('appends ALGORITHM=INSTANT where the hazard is safe', () => {
    expect(mysqlAlgorithmClause('safe')).toBe(', ALGORITHM=INSTANT');
  });

  it('appends INPLACE, LOCK=NONE where it is locking', () => {
    expect(mysqlAlgorithmClause('locking')).toBe(', ALGORITHM=INPLACE, LOCK=NONE');
  });

  it('appends nothing for a rewrite — there is nothing to promise', () => {
    expect(mysqlAlgorithmClause('rewrite')).toBe('');
    expect(mysqlAlgorithmClause('lossy')).toBe('');
  });

  it('leaves MariaDB alone: a fifth algorithm and an untested CI leg', () => {
    expect(mysqlAlgorithmClause('safe', { isMariaDb: true })).toBe('');
  });

  it('reaches the emitted statement on a predicted-safe add-column', () => {
    const before = model([tbl({ name: 't' })]);
    const after = tbl({
      name: 't',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'note', logicalType: 'text', dbType: 'text' }),
      ],
    });
    const plan = planDdl({ actual: before, desired: [after], dialect: 'mysql', serverVersion: '8.0.35' });
    expect(plan.steps[0]?.hazard).toBe('safe');
    expect(sqlFor(plan, 'mysql', after)[0]).toContain('ALGORITHM=INSTANT');
  });
});

describe('the session rails, and their reset', () => {
  it('postgres sets lock_timeout INSIDE the transaction, where it dies with it', () => {
    const statements = sessionRails('postgres', compilerFor('postgres')).map((q) => q.sql);
    expect(statements[0]).toContain('SET LOCAL lock_timeout');
    expect(statements[1]).toContain('SET LOCAL statement_timeout');
  });

  it('mysql sets the session value, because it has no transaction to scope to', () => {
    const statements = sessionRails('mysql', compilerFor('mysql')).map((q) => q.sql);
    expect(statements[0]).toContain('SET SESSION lock_wait_timeout');
    // Its default is 31536000 seconds — one year — so an unset rail is a hang.
    expect(statements[0]).not.toContain('31536000');
  });

  it('resets lock_wait_timeout on mysql and has nothing to reset on postgres', () => {
    expect(resetRails('mysql', compilerFor('mysql')).map((q) => q.sql)).toEqual([
      'SET SESSION lock_wait_timeout = DEFAULT',
      'SET SESSION max_execution_time = DEFAULT',
    ]);
    expect(resetRails('postgres', compilerFor('postgres'))).toEqual([]);
  });

  it('turns foreign keys back on for sqlite, which a failed cycle drop leaves off', () => {
    // A `drop-table` in a foreign-key cycle runs between `foreign_keys = off`
    // and `= on`; a DROP that fails never reaches the second.
    expect(resetRails('sqlite', compilerFor('sqlite')).map((q) => q.sql)).toEqual(['PRAGMA foreign_keys = on']);
    const drop = { id: 'd', kind: 'drop-table' as const, table: 'main.tickets', column: null, constraint: null, hazard: 'irreversible' as const, requiresSuperAdmin: true, summary: 's', rationale: 'r', consequences: [], dependsOn: [], outsideTransaction: false, refusal: null };
    const ctx = { db: compilerFor('sqlite'), dialect: 'sqlite' as const, serverVersion: null };
    expect(compileStep(drop, { ...ctx, withoutForeignKeys: true }).map((q) => q.sql)).toEqual([
      'PRAGMA foreign_keys = off',
      'drop table "tickets"',
      'PRAGMA foreign_keys = on',
    ]);
    // Every other drop keeps SQLite's enforcement, cascades and all.
    expect(compileStep(drop, ctx).map((q) => q.sql)).toEqual(['drop table "tickets"']);
  });

  it('sqlite sets no timeout (the adapter did) but reads its schema first, to see another program’s change', () => {
    expect(sessionRails('sqlite', compilerFor('sqlite')).map((q) => q.sql)).toEqual(['SELECT count(*) FROM sqlite_master']);
  });
});

describe('compiled statements per step kind', () => {
  const t = tbl({ name: 'articles' });

  it('creates a table with an identity key, per dialect', () => {
    const plan = planDdl({ actual: model([]), desired: [t], dialect: 'postgres', serverVersion: '16.2' });
    expect(sqlFor(plan, 'postgres', t)[0]).toMatch(/create table if not exists/i);

    const pgSql = sqlFor(plan, 'postgres', t)[0]!;
    expect(pgSql).toContain('generated by default as identity');
    const mySql = sqlFor(plan, 'mysql', t)[0]!;
    expect(mySql).toContain('auto_increment');
    const liteSql = sqlFor(plan, 'sqlite', t)[0]!;
    expect(liteSql).toContain('primary key');
  });

  it('drops a table', () => {
    const plan = planDdl({
      actual: model([t]),
      desired: [],
      dropTables: ['public.articles'],
      dialect: 'postgres',
      serverVersion: '16.2',
    });
    expect(sqlFor(plan, 'postgres', t)[0]).toMatch(/drop table "articles"/i);
  });

  it('renames a table', () => {
    const step: DdlStep = {
      id: 's1', kind: 'rename-table', table: 'public.old', column: null, constraint: null, hazard: 'safe',
      requiresSuperAdmin: false, summary: '', rationale: 'x', consequences: [], dependsOn: [],
      outsideTransaction: false, refusal: null,
    };
    const [q] = compileStep(step, {
      db: compilerFor('postgres'), dialect: 'postgres', serverVersion: null,
      desired: tbl({ name: 'fresh' }),
    });
    expect(q!.sql).toBe('ALTER TABLE "public"."old" RENAME TO "fresh"');
  });

  it('renames a column to the name the PLANNER chose, not the table\'s first column', () => {
    // The compiler used to pick "the first desired column that is not the old
    // name" — `id` here, as on nearly every table — and emitted RENAME ... TO "id".
    const step: DdlStep = {
      id: 's1', kind: 'rename-column', table: 'public.clients', column: 'email', constraint: null,
      hazard: 'safe', requiresSuperAdmin: false, summary: '', rationale: 'x', consequences: [],
      dependsOn: [], outsideTransaction: false, refusal: null, renameTo: 'contact_email',
    };
    const [q] = compileStep(step, {
      db: compilerFor('postgres'), dialect: 'postgres', serverVersion: null,
      desired: tbl({
        name: 'clients',
        columns: [col({ name: 'id' }), col({ name: 'name' }), col({ name: 'contact_email' })],
      }),
    });
    expect(q!.sql).toBe('ALTER TABLE "public"."clients" RENAME COLUMN "email" TO "contact_email"');
  });

  it('qualifies with the schema on postgres and not on mysql or sqlite', () => {
    const step: DdlStep = {
      id: 's1', kind: 'drop-column', table: 'public.orders', column: 'note', constraint: null, hazard: 'lossy',
      requiresSuperAdmin: true, summary: '', rationale: 'x', consequences: [], dependsOn: [],
      outsideTransaction: false, refusal: null,
    };
    const pg = compileStep(step, { db: compilerFor('postgres'), dialect: 'postgres', serverVersion: null })[0]!;
    const my = compileStep(step, { db: compilerFor('mysql'), dialect: 'mysql', serverVersion: null })[0]!;
    expect(pg.sql).toContain('"public"."orders"');
    expect(my.sql).toContain('`orders`');
    expect(my.sql).not.toContain('public');
  });

  it('drops an index by its own name, in its schema on postgres, and refuses to guess one', () => {
    const step: DdlStep = {
      id: 's1', kind: 'drop-index', table: 'public.notes', column: null, constraint: 'notes_by_author', hazard: 'safe',
      requiresSuperAdmin: false, summary: '', rationale: 'x', consequences: [], dependsOn: [],
      outsideTransaction: false, refusal: null,
    };
    const sql = (dialect: 'postgres' | 'mysql' | 'sqlite', s: DdlStep) =>
      compileStep(s, { db: compilerFor(dialect), dialect, serverVersion: null })[0]!.sql;
    expect(sql('postgres', step)).toBe('DROP INDEX "public"."notes_by_author"');
    expect(sql('mysql', step)).toBe('ALTER TABLE `notes` DROP INDEX `notes_by_author`');
    expect(sql('sqlite', { ...step, table: 'main.notes' })).toBe('DROP INDEX "notes_by_author"');
    expect(() => sql('postgres', { ...step, constraint: null })).toThrow(/needs its name/);
  });

  it('emits a CHECK for an enum column (D32) rather than a native type', () => {
    const enumTable = tbl({
      name: 't',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'state', logicalType: 'enum', dbType: 'varchar(64)' }),
      ],
    });
    const plan = planDdl({ actual: model([tbl({ name: 't' })]), desired: [enumTable], dialect: 'postgres', serverVersion: '16.2' });
    const statements = sqlFor(plan, 'postgres', enumTable, { enumValues: { state: ['draft', 'sent'] } });
    const joined = statements.join('\n');
    expect(joined).toContain('CHECK');
    expect(joined).toContain("'draft'");
    expect(joined).not.toMatch(/create type/i);
  });

  it('adds and drops a foreign key by its catalog name', () => {
    const relation: Relation = {
      id: 'fk:public.orders(customer_id)->public.customers(id)',
      kind: 'declared-fk', cardinality: 'one-to-many',
      from: { tableId: 'public.orders', columns: ['customer_id'] },
      to: { tableId: 'public.customers', columns: ['id'] },
      through: null, onDelete: 'cascade', onUpdate: null, selfReferential: false,
      confidence: 1, constraintName: 'orders_customer_id_fkey',
    };
    const add: DdlStep = {
      id: 's1', kind: 'add-fk', table: 'public.orders', column: null, constraint: null, hazard: 'locking',
      requiresSuperAdmin: false, summary: '', rationale: 'x', consequences: [], dependsOn: [],
      outsideTransaction: false, refusal: null,
    };
    const addSql = compileStep(add, { db: compilerFor('postgres'), dialect: 'postgres', serverVersion: null, relation })[0]!.sql;
    expect(addSql).toContain('ADD CONSTRAINT "orders_customer_id_fkey"');
    expect(addSql).toContain('ON DELETE CASCADE');

    const dropSql = compileStep({ ...add, kind: 'drop-fk' }, { db: compilerFor('mysql'), dialect: 'mysql', serverVersion: null, relation })[0]!.sql;
    // MySQL's verb differs, and using the wrong one is a syntax error.
    expect(dropSql).toContain('DROP FOREIGN KEY `orders_customer_id_fkey`');
  });
});

describe('the SQLite rebuild', () => {
  const actual = tbl({
    name: 'notes',
    columns: [
      col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
      col({ name: 'body', logicalType: 'text', dbType: 'text' }),
    ],
  });
  const desired = tbl({
    name: 'notes',
    columns: [
      col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
      col({ name: 'body', logicalType: 'varchar', maxLength: 500, dbType: 'varchar(500)', nullable: false }),
    ],
  });

  it('emits create → copy → drop → rename, in that order and never the reverse', () => {
    const statements = compileSqliteRebuild({
      db: compilerFor('sqlite'),
      actual,
      desired,
      columnMapping: { id: 'id', body: 'body' }, foreignKeys: [],
      objects: [],
    }).map((q) => q.sql);

    const joined = statements.join('\n');
    const create = joined.indexOf('CREATE TABLE "adminium_rebuild_notes"');
    const insert = joined.indexOf('INSERT INTO "adminium_rebuild_notes"');
    const drop = joined.indexOf('DROP TABLE "notes"');
    const rename = joined.indexOf('RENAME TO "notes"');
    expect(create).toBeGreaterThanOrEqual(0);
    expect(create).toBeLessThan(insert);
    expect(insert).toBeLessThan(drop);
    expect(drop).toBeLessThan(rename);
  });

  it('ends with PRAGMA foreign_key_check — step 9, the one that gets skipped', () => {
    const statements = compileSqliteRebuild({
      db: compilerFor('sqlite'), actual, desired,
      columnMapping: { id: 'id', body: 'body' }, foreignKeys: [], objects: [],
    }).map((q) => q.sql);
    expect(statements[statements.length - 1]).toBe('PRAGMA foreign_key_check');
  });

  it('keeps the foreign_keys pragma OUTSIDE the transaction — it is a no-op inside one', () => {
    expect(REBUILD_PRAGMAS.before).toBe('PRAGMA foreign_keys = off');
    expect(REBUILD_PRAGMAS.after).toBe('PRAGMA foreign_keys = on');
  });

  it('recreates indexes from the model, so a renamed column does not orphan one', () => {
    const withIndex = {
      ...desired,
      indexes: [{ name: 'ix_notes_body', columns: ['body'], expression: null, unique: false, primary: false, method: null, partial: false }],
    };
    const statements = compileSqliteRebuild({
      db: compilerFor('sqlite'), actual, desired: withIndex,
      columnMapping: { id: 'id', body: 'body' }, foreignKeys: [], objects: [],
    }).map((q) => q.sql);
    expect(statements.join('\n')).toContain('CREATE INDEX "ix_notes_body" ON "notes" ("body")');
  });

  it('copies only the columns that have a source; a new one takes its default', () => {
    const withNew = {
      ...desired,
      columns: [...desired.columns, col({ name: 'fresh', logicalType: 'text', dbType: 'text' })],
    };
    const insert = compileSqliteRebuild({
      db: compilerFor('sqlite'), actual, desired: withNew,
      columnMapping: { id: 'id', body: 'body' }, foreignKeys: [], objects: [],
    })
      .map((q) => q.sql)
      .find((s) => s.startsWith('INSERT'))!;
    expect(insert).toContain('"id", "body"');
    expect(insert).not.toContain('fresh');
  });

  it('refuses when a trigger body references the old table name', () => {
    expect(() =>
      compileSqliteRebuild({
        db: compilerFor('sqlite'),
        actual,
        desired: { ...desired, name: 'renamed', id: 'public.renamed' },
        columnMapping: { id: 'id', body: 'body' }, foreignKeys: [],
        objects: [{ type: 'trigger', name: 'tr_notes', sql: 'CREATE TRIGGER tr_notes AFTER INSERT ON notes BEGIN SELECT 1; END' }],
      }),
    ).toThrow(SqliteRebuildError);
  });
});

describe('the rebuilt table must match what was promised', () => {
  const desired = tbl({
    name: 'notes',
    columns: [
      col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
      col({ name: 'body', logicalType: 'varchar', maxLength: 500, nullable: false }),
    ],
    indexes: [{ name: 'ix_body', columns: ['body'], expression: null, unique: false, primary: false, method: null, partial: false }],
  });

  it('passes when the shapes agree', () => {
    expect(() => assertRebuildMatches(desired, desired)).not.toThrow();
  });

  it('catches a lost column', () => {
    const lost = { ...desired, columns: [desired.columns[0]!] };
    expect(() => assertRebuildMatches(lost, desired)).toThrow(/body is missing/);
  });

  it('catches a lost index — the classic silent rebuild failure', () => {
    const lost = { ...desired, indexes: [] };
    expect(() => assertRebuildMatches(lost, desired)).toThrow(/ix_body was not recreated/);
  });

  it('catches a nullability that did not take', () => {
    const wrong = {
      ...desired,
      columns: [desired.columns[0]!, { ...desired.columns[1]!, nullable: true }],
    };
    expect(() => assertRebuildMatches(wrong, desired)).toThrow(/nullable/);
  });

  it('catches a primary key that moved', () => {
    expect(() => assertRebuildMatches({ ...desired, primaryKey: ['body'] }, desired)).toThrow(
      /primary key is \(body\)/,
    );
  });

  it('turns foreign_key_check rows into a refusal', () => {
    expect(() => assertNoForeignKeyViolations([])).not.toThrow();
    expect(() => assertNoForeignKeyViolations([{}, {}])).toThrow(/2 rows violating/);
  });
});

describe('D2: the preview IS the statement', () => {
  it('executes the exact string the preview showed, against a real database', async () => {
    const raw = new BetterSqlite3(':memory:');
    raw.exec('create table notes (id integer primary key, body text)');
    const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
    closers.push(async () => {
      await db.destroy();
    });

    const actual = model([
      tbl({
        name: 'notes',
        columns: [
          col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
          col({ name: 'body', logicalType: 'text', dbType: 'text' }),
        ],
      }),
    ]);
    const desired = tbl({
      name: 'notes',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'body', logicalType: 'text', dbType: 'text' }),
        col({ name: 'author', logicalType: 'text', dbType: 'text' }),
      ],
    });

    const plan = planDdl({ actual, desired: [desired], dialect: 'sqlite', serverVersion: '3.53.4' });
    expect(plan.steps.map((s) => s.kind)).toEqual(['add-column']);

    // The PREVIEW.
    const preview = compileStep(plan.steps[0]!, { db, dialect: 'sqlite', serverVersion: '3.53.4', desired });
    const previewSql = preview.map((q) => q.sql);

    // The EXECUTION — the same CompiledQuery objects, not a second render.
    for (const query of preview) await db.executeQuery(query);

    // Compiling again yields the identical strings, and the column is real.
    const again = compileStep(plan.steps[0]!, { db, dialect: 'sqlite', serverVersion: '3.53.4', desired }).map((q) => q.sql);
    expect(again).toEqual(previewSql);

    const columns = raw.prepare('PRAGMA table_info(notes)').all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain('author');
  });

  it('declares the PRIMARY KEY on every dialect, including a single generated one', () => {
    /*
     * The bug: a single-column key fell through BOTH branches. The table-level
     * constraint skipped it as "the generated one", and the column builder only
     * marked it on SQLite — so Postgres got
     * `"id" integer generated by default as identity not null` and no key at
     * all. The CRUD layer then said, correctly, "this table has no primary key
     * and is read-only", and a table created in Studio could not have a row
     * added to it from the page Studio generated for it. MySQL would have
     * refused the CREATE outright: AUTO_INCREMENT on a non-key column is an
     * error there.
     *
     * Found by clicking "New row" on a table created two minutes earlier — the
     * one step of criterion 1 that no test performed.
     */
    const desired = tbl({
      name: 'tickets',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'title', logicalType: 'text', dbType: 'text' }),
      ],
    });
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      const plan = planDdl({ actual: model([]), desired: [desired], dialect, serverVersion: null });
      const create = plan.steps.find((step) => step.kind === 'create-table')!;
      const [query] = compileStep(create, { db: compilerFor(dialect), dialect, serverVersion: null, desired });
      expect(query!.sql.toLowerCase(), dialect).toContain('primary key');
    }
  });

  it('gives an FK column the type of the column it references', () => {
    /*
     * A foreign-key column is not independently typed — it must MATCH its
     * target, and on MySQL matching includes signedness. Adminium's vocabulary
     * has one `integer`, which compiles to a signed one, so linking to the
     * near-universal `int unsigned` auto-increment key produced
     *
     *   Referencing column 'client_id' and referenced column 'id' in foreign
     *   key constraint 'fk_bookings_client_id' are incompatible.
     *
     * …at APPLY, on a real MySQL 26.7 server, after the review pane had shown
     * the statement and called it safe. The first attempt at it.
     */
    const desired = tbl({
      name: 'bookings',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'client_id', logicalType: 'integer', dbType: 'integer' }),
      ],
    });
    const plan = planDdl({ actual: model([]), desired: [desired], dialect: 'mysql', serverVersion: '8.4.0' });
    const create = plan.steps.find((step) => step.kind === 'create-table')!;
    const [query] = compileStep(create, {
      db: compilerFor('mysql'),
      dialect: 'mysql',
      serverVersion: '8.4.0',
      desired,
      fkColumnTypes: { client_id: 'int unsigned' },
    });
    expect(query!.sql).toContain('`client_id` int unsigned');
    // …and the key keeps its own type, which is NOT the override's business.
    expect(query!.sql).toContain('`id` integer');
  });

  it('copies the target type but never its auto_increment clause', () => {
    // A generated key's dbType carries the clause on some engines. Copying it
    // would give the child table a second auto-increment column, which MySQL
    // refuses outright — a worse failure than the one being fixed.
    const desired = tbl({
      name: 'bookings',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'client_id', logicalType: 'integer', dbType: 'integer' }),
      ],
    });
    const plan = planDdl({ actual: model([]), desired: [desired], dialect: 'mysql', serverVersion: '8.4.0' });
    const create = plan.steps.find((step) => step.kind === 'create-table')!;
    const [query] = compileStep(create, {
      db: compilerFor('mysql'), dialect: 'mysql', serverVersion: '8.4.0', desired,
      fkColumnTypes: { client_id: 'int unsigned' },
    });
    expect(query!.sql.toLowerCase().match(/auto_increment/g) ?? []).toHaveLength(1);
  });

  it('emits a MULTI-WORD type whole, on create and on alter', () => {
    /*
     * `compileCreateTable` took `columnDefinition(...).split(' ')[0]`, which is
     * right only for a single-word type. `ddlTypeFor` returns
     * `double precision` for a float on postgres, so creating a table with one
     * emitted `x double` — a type postgres does not have. The same truncation
     * silently ate the FK signedness override (`int unsigned` → `int`), which
     * is how it was found.
     */
    const desired = tbl({
      name: 'readings',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'value', logicalType: 'float', dbType: 'double precision' }),
      ],
    });
    const plan = planDdl({ actual: model([]), desired: [desired], dialect: 'postgres', serverVersion: '16.0' });
    const create = plan.steps.find((step) => step.kind === 'create-table')!;
    const [query] = compileStep(create, {
      db: compilerFor('postgres'), dialect: 'postgres', serverVersion: '16.0', desired,
    });
    expect(query!.sql).toContain('double precision');
    expect(query!.sql).not.toMatch(/"value" double[^ ]/);
  });

  it('uses a table-level constraint for a COMPOSITE key', () => {
    const desired = tbl({
      name: 'pairs',
      columns: [
        col({ name: 'a', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'b', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false }),
      ],
      primaryKey: ['a', 'b'],
    });
    const plan = planDdl({ actual: model([]), desired: [desired], dialect: 'postgres', serverVersion: null });
    const create = plan.steps.find((step) => step.kind === 'create-table')!;
    const [query] = compileStep(create, {
      db: compilerFor('postgres'), dialect: 'postgres', serverVersion: null, desired,
    });
    expect(query!.sql).toContain('"pk_pairs"');
    expect(query!.sql).toContain('primary key ("a", "b")');
  });

  it('runs a real create-table from the compiled plan', async () => {
    const raw = new BetterSqlite3(':memory:');
    const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
    closers.push(async () => {
      await db.destroy();
    });

    const desired = tbl({
      name: 'tickets',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'title', logicalType: 'varchar', maxLength: 200, dbType: 'varchar(200)', nullable: false }),
        col({ name: 'state', logicalType: 'enum', dbType: 'varchar(64)' }),
      ],
    });
    const plan = planDdl({ actual: model([]), desired: [desired], dialect: 'sqlite', serverVersion: '3.53.4' });
    for (const step of plan.steps) {
      for (const query of compileStep(step, {
        db, dialect: 'sqlite', serverVersion: '3.53.4', desired,
        enumValues: { state: ['open', 'closed'] },
      })) {
        await db.executeQuery(query);
      }
    }

    const info = raw.prepare('PRAGMA table_info(tickets)').all() as { name: string; type: string; notnull: number }[];
    expect(info.map((c) => c.name).sort()).toEqual(['id', 'state', 'title']);
    expect(info.find((c) => c.name === 'title')?.notnull).toBe(1);

    // The generated key really generates, and the CHECK really checks.
    raw.prepare("insert into tickets (title, state) values ('first', 'open')").run();
    const row = raw.prepare('select id from tickets').get() as { id: number };
    expect(row.id).toBe(1);
    expect(() =>
      raw.prepare("insert into tickets (title, state) values ('bad', 'nope')").run(),
    ).toThrow();
  });
});

describe('columnDefinition keeps a display-only type verbatim (D30)', () => {
  it('restates an interval column by its stored dbType rather than refusing', () => {
    const table = tbl({
      name: 't',
      columns: [col({ name: 'span', logicalType: 'interval', dbType: 'interval' })],
      primaryKey: [],
    });
    expect(columnDefinition(table.columns[0]!, table, 'postgres')).toBe('"span" interval');
  });

  it('uses the forward map for an authorable one', () => {
    const table = tbl({
      name: 't',
      columns: [col({ name: 'amt', logicalType: 'decimal', numericPrecision: 12, numericScale: 2 })],
      primaryKey: [],
    });
    expect(columnDefinition(table.columns[0]!, table, 'postgres')).toBe('"amt" decimal(12,2)');
    expect(ddlTypeFor({ logicalType: 'decimal', numericPrecision: 12, numericScale: 2 }, 'postgres')).toBe(
      'decimal(12,2)',
    );
  });
});
