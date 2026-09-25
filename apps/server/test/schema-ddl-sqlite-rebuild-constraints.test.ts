// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a SQLite rebuild puts back, and what it refuses to lose.
 *
 * A rebuild re-creates the table from the model, and the model cannot say
 * everything SQLite can. Driven through `planSchemaEdit` and `applySchemaEdit`
 * against a real database, with step 12 re-reading the table, because each of
 * these passed the rebuild's own comparison while the table came back other
 * than it was:
 *
 *   · a unique turned off in the designer came back: the index SQLite made for
 *     it still sat in the model's index list, and the rebuild re-made the
 *     constraint from it;
 *   · a column's `COLLATE NOCASE`, and a unique's `ON CONFLICT REPLACE`, were
 *     dropped, so "A" and "a" were suddenly two different values;
 *   · a partial unique index (`WHERE deleted_at IS NULL`) came back covering
 *     every row, and an index on an expression could not come back at all.
 *
 * What the model can carry comes back as it was; what it cannot, the rebuild
 * refuses, naming the column or the index, with nothing changed.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { introspectSqlite } from '@adminium/adapter-sqlite';
import type { DatabaseModel, DesiredTable, SchemaEdit, TableModel } from '@adminium/engine';

// The ledger is Adminium's own store, not the database under test; a recorder
// is all the apply needs from it.
vi.mock('@adminium/meta', async (importOriginal) => {
  const real = await importOriginal<typeof import('@adminium/meta')>();
  return {
    ...real,
    schemaChangesRepo: () => ({
      unfinishedFor: async () => null,
      start: async () => ({ id: 'sch_test' }),
      recordSteps: async () => undefined,
      finish: async () => undefined,
    }),
  };
});

const { applySchemaEdit, planSchemaEdit } = await import('../src/schema-ddl/service.js');
const { rebuildColumnMapping, runSqliteRebuild } = await import('../src/schema-ddl/sqlite-rebuild.js');

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers) await close();
});

async function introspect(raw: BetterSqlite3.Database): Promise<DatabaseModel> {
  return await introspectSqlite(async (text) => raw.prepare(text).all() as never, {
    connectionId: 'conn_1',
    databaseName: 'memory',
    fileSizeBytes: null,
  });
}

async function open(setup: string): Promise<{ db: AnyDb; raw: BetterSqlite3.Database; actual: DatabaseModel }> {
  const raw = new BetterSqlite3(':memory:');
  raw.exec(setup);
  const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
  closers.push(async () => {
    await db.destroy();
  });
  return { db, raw, actual: await introspect(raw) };
}

/** The table as the designer loads it: every index it was given, SQLite's own among them. */
function asDesigned(table: TableModel, over: Partial<DesiredTable> = {}): DesiredTable {
  return {
    id: table.id,
    schema: table.schema,
    name: table.name,
    comment: null,
    columns: table.columns.map((c) => ({
      name: c.name,
      logicalType: c.logicalType as DesiredTable['columns'][number]['logicalType'],
      nullable: c.nullable,
      default: c.default?.kind === 'autoincrement' ? c.default : null,
      maxLength: c.maxLength,
      numericPrecision: c.numericPrecision,
      numericScale: c.numericScale,
      comment: null,
    })),
    primaryKey: [...table.primaryKey],
    uniques: table.uniques.map((u) => ({ name: u.name, columns: [...u.columns] })),
    indexes: table.indexes.filter((i) => !i.primary).map((i) => ({ name: i.name, columns: [...i.columns], unique: i.unique })),
    foreignKeys: [],
    enumValues: {},
    ...over,
  };
}

/** `body` made NOT NULL: a change only a rebuild can make on SQLite. */
function bodyRequired(table: DesiredTable): DesiredTable {
  return { ...table, columns: table.columns.map((c) => (c.name === 'body' ? { ...c, nullable: false } : c)) };
}

const editOf = (table: DesiredTable): SchemaEdit => ({
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [table],
  addColumns: [],
  alterColumns: [],
  dropTables: [],
});

async function apply(db: AnyDb, raw: BetterSqlite3.Database, actual: DatabaseModel, table: DesiredTable) {
  const base = {
    meta: {} as never,
    connectionId: 'conn_1',
    edit: editOf(table),
    actual,
    dialect: 'sqlite' as const,
    serverVersion: null,
    maxIdentifierLength: 128,
    metaSharesDatabase: false,
    db,
    countRows: async () => ({ value: 1, capped: false }),
  };
  const plan = await planSchemaEdit(base);
  const result = await applySchemaEdit({
    ...base,
    checksum: plan.checksum,
    createdBy: null,
    superAdmin: true,
    // Step 12, against the table as it really came out.
    reintrospectTable: async (tableId) => (await introspect(raw)).tables.find((t) => t.id === tableId) ?? null,
  });
  return { plan, result };
}

const tableOf = (model: DatabaseModel, name: string): TableModel => model.tables.find((t) => t.name === name)!;
const createSql = (raw: BetterSqlite3.Database, name: string): string =>
  (raw.prepare('select sql from sqlite_master where name = ?').get(name) as { sql: string }).sql;

describe('a unique turned off in the designer', () => {
  for (const [how, strip] of [
    ['with SQLite’s own index still in the list', false],
    ['with SQLite’s own index taken out of the list', true],
  ] as const) {
    it(`lets a duplicate in afterwards, ${how}`, async () => {
      const { db, raw, actual } = await open(`
        create table notes (id integer primary key, code text unique, body text);
        insert into notes (code, body) values ('A', 'x');
      `);
      const designed = asDesigned(tableOf(actual, 'notes'), { uniques: [] });
      const { plan, result } = await apply(db, raw, actual, strip ? { ...designed, indexes: [] } : designed);

      expect(plan.steps.map((s) => s.kind)).toContain('rebuild-table');
      expect(result.status, result.error ?? '').toBe('applied');
      raw.prepare("insert into notes (code, body) values ('A', 'y')").run();
      expect(raw.prepare('select code from notes order by id').all()).toEqual([{ code: 'A' }, { code: 'A' }]);
    });
  }

  it('stays unique when it was left on, through a rebuild for another column', async () => {
    const { db, raw, actual } = await open(`
      create table notes (id integer primary key, code text unique, body text);
      insert into notes (code, body) values ('A', 'x');
    `);
    const { result } = await apply(db, raw, actual, bodyRequired(asDesigned(tableOf(actual, 'notes'))));
    expect(result.status, result.error ?? '').toBe('applied');
    expect(() => raw.prepare("insert into notes (code, body) values ('A', 'y')").run()).toThrow(/UNIQUE/);
  });
});

describe('what a rebuild cannot carry', () => {
  it('refuses to lose a column’s COLLATE NOCASE, naming the column, and changes nothing', async () => {
    const { db, raw, actual } = await open(`
      create table notes (id integer primary key, code text collate nocase unique, body text);
      insert into notes (code, body) values ('A', 'x');
    `);
    const before = createSql(raw, 'notes');
    const { result } = await apply(db, raw, actual, bodyRequired(asDesigned(tableOf(actual, 'notes'))));

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/"code"/);
    expect(result.error).toMatch(/COLLATE NOCASE/i);
    expect(createSql(raw, 'notes')).toBe(before);
    // Still compared without case: "a" is "A".
    expect(() => raw.prepare("insert into notes (code, body) values ('a', 'y')").run()).toThrow(/UNIQUE/);
  });

  it('refuses to lose a unique’s ON CONFLICT REPLACE, naming the column', async () => {
    const { db, raw, actual } = await open(`
      create table notes (id integer primary key, code text unique on conflict replace, body text);
      insert into notes (code, body) values ('A', 'x');
    `);
    const before = createSql(raw, 'notes');
    const { result } = await apply(db, raw, actual, bodyRequired(asDesigned(tableOf(actual, 'notes'))));

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/"code"/);
    expect(result.error).toMatch(/ON CONFLICT REPLACE/i);
    expect(createSql(raw, 'notes')).toBe(before);
  });

  it('rebuilds a table whose collation is the default one', async () => {
    const { db, raw, actual } = await open(`
      create table notes (id integer primary key, code text collate binary unique on conflict abort, body text);
      insert into notes (code, body) values ('A', 'x');
    `);
    const { result } = await apply(db, raw, actual, bodyRequired(asDesigned(tableOf(actual, 'notes'))));
    expect(result.status, result.error ?? '').toBe('applied');
  });

  it('puts a partial unique index back as partial', async () => {
    const { db, raw, actual } = await open(`
      create table members (id integer primary key, email text, deleted_at text, body text);
      create unique index ux_members_live on members (email) where deleted_at is null;
      insert into members (email, deleted_at, body) values ('a@x', '2026-01-01', 'x'), ('a@x', null, 'y');
    `);
    const { result } = await apply(db, raw, actual, bodyRequired(asDesigned(tableOf(actual, 'members'))));

    expect(result.status, result.error ?? '').toBe('applied');
    expect(createSql(raw, 'ux_members_live')).toMatch(/where deleted_at is null/i);
    // Unique among the live rows only, as before.
    raw.prepare("insert into members (email, deleted_at, body) values ('a@x', '2026-02-01', 'z')").run();
    expect(() => raw.prepare("insert into members (email, body) values ('a@x', 'w')").run()).toThrow(/UNIQUE/);
  });

  it('puts an index on an expression back, and a mixed one whole', async () => {
    const { db, raw, actual } = await open(`
      create table members (id integer primary key, email text, body text);
      create unique index ux_members_email on members (lower(email));
      create index ix_members_mixed on members (lower(email), id);
      insert into members (email, body) values ('A@x', 'x');
    `);
    const { result } = await apply(db, raw, actual, bodyRequired(asDesigned(tableOf(actual, 'members'))));

    expect(result.status, result.error ?? '').toBe('applied');
    expect(createSql(raw, 'ux_members_email')).toMatch(/lower\(email\)/i);
    expect(createSql(raw, 'ix_members_mixed')).toMatch(/lower\(email\), id/i);
    expect(() => raw.prepare("insert into members (email, body) values ('a@X', 'y')").run()).toThrow(/UNIQUE/);
  });

  it('refuses when the rebuild itself drops a column a partial index reads, naming the index and the column', async () => {
    const { db, raw, actual } = await open(`
      create table members (id integer primary key, email text, deleted_at text, body text);
      create unique index ux_members_live on members (email) where deleted_at is null;
    `);
    // The rebuild on its own, told to leave `deleted_at` behind (the planner
    // drops a column with an ALTER of its own, which SQLite refuses here too).
    const before = tableOf(actual, 'members');
    const desired = { ...before, columns: before.columns.filter((c) => c.name !== 'deleted_at') };
    await expect(
      runSqliteRebuild({ db, actual: before, desired, columnMapping: rebuildColumnMapping(before, desired), foreignKeys: [] }),
    ).rejects.toThrow(/"ux_members_live" reads "deleted_at"/);
    expect(createSql(raw, 'ux_members_live')).toMatch(/where deleted_at is null/i);
    expect(raw.prepare('select name from pragma_table_info(?)').all('members')).toHaveLength(4);
  });
});
