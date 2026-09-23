// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SQLite rebuild keeps the table's foreign keys.
 *
 * ─── What this was ─────────────────────────────────────────────────────────
 *
 * `compileSqliteRebuild` built the new table from the desired COLUMNS, the
 * key, the uniques and the existing checks — and nothing else. Foreign keys
 * live in `DatabaseModel.relations`, not on the `TableModel` the rebuild was
 * handed, so the `CREATE TABLE` it emitted had no `REFERENCES` at all. Every
 * rebuild — a type change, a nullability change, an added unique — silently
 * dropped every link the table had, reported success, and step 12 could not
 * see it because it compares columns, the key and indexes.
 *
 * Driven through `applySchemaEdit` against a real database, because the bug
 * sat BETWEEN the two halves: the planner knew the desired links and the
 * executor was never given them.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { introspectSqlite } from '@adminium/adapter-sqlite';
import type { DatabaseModel, DesiredTable, SchemaEdit } from '@adminium/engine';

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
const { compileSqliteRebuild } = await import('../src/schema-ddl/sqlite-rebuild.js');

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers) await close();
});

async function open(): Promise<{ db: AnyDb; raw: BetterSqlite3.Database; actual: DatabaseModel }> {
  const raw = new BetterSqlite3(':memory:');
  raw.exec(`
    pragma foreign_keys = on;
    create table region (id integer primary key, name text not null);
    create table territories (
      id integer primary key,
      region_id integer not null references region (id) on delete cascade,
      description text
    );
    insert into region (id, name) values (1, 'North'), (2, 'South');
    insert into territories (id, region_id, description) values (10, 1, 'a'), (11, 2, 'b');
  `);
  const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
  closers.push(async () => {
    await db.destroy();
  });
  const actual = await introspectSqlite(async (text) => raw.prepare(text).all() as never, {
    connectionId: 'conn_1',
    databaseName: 'memory',
    fileSizeBytes: null,
  });
  return { db, raw, actual };
}

const territories = (over: Partial<DesiredTable> = {}): DesiredTable => ({
  id: 'main.territories',
  schema: 'main',
  name: 'territories',
  comment: null,
  columns: [
    { name: 'id', logicalType: 'integer', nullable: false, default: null, maxLength: null, numericPrecision: null, numericScale: null, comment: null },
    { name: 'region_id', logicalType: 'integer', nullable: false, default: null, maxLength: null, numericPrecision: null, numericScale: null, comment: null },
    // The change that forces the rebuild: `text` → `varchar(50)`.
    { name: 'description', logicalType: 'varchar', nullable: true, default: null, maxLength: 50, numericPrecision: null, numericScale: null, comment: null },
  ],
  primaryKey: ['id'],
  uniques: [],
  indexes: [],
  foreignKeys: [
    { name: null, columns: ['region_id'], toTable: 'main.region', toColumns: ['id'], onDelete: 'cascade', onUpdate: null },
  ],
  enumValues: {},
  ...over,
});

const editOf = (table: DesiredTable): SchemaEdit => ({
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [table],
  addColumns: [],
  alterColumns: [],
  dropTables: [],
});

async function apply(db: AnyDb, actual: DatabaseModel, edit: SchemaEdit) {
  const base = {
    meta: {} as never,
    connectionId: 'conn_1',
    edit,
    actual,
    dialect: 'sqlite' as const,
    serverVersion: null,
    maxIdentifierLength: 128,
    metaSharesDatabase: false,
    db,
    countRows: async () => ({ value: 2, capped: false }),
  };
  const plan = await planSchemaEdit(base);
  const result = await applySchemaEdit({
    ...base,
    checksum: plan.checksum,
    createdBy: null,
    superAdmin: true,
  });
  return { plan, result };
}

type FkRow = { table: string; from: string; to: string; on_delete: string };

describe('a SQLite rebuild and the table’s foreign keys', () => {
  it('keeps a link the operator did not touch, with its ON DELETE rule', async () => {
    const { db, raw, actual } = await open();
    const { plan, result } = await apply(db, actual, editOf(territories()));

    // The premise: this really is a rebuild, not an ALTER.
    expect(plan.steps.map((s) => s.kind)).toContain('rebuild-table');
    expect(result.status).toBe('applied');

    const fks = raw.prepare('PRAGMA foreign_key_list(territories)').all() as FkRow[];
    expect(fks).toEqual([
      expect.objectContaining({ table: 'region', from: 'region_id', to: 'id', on_delete: 'CASCADE' }),
    ]);
    // …and it is enforced, not merely declared.
    raw.pragma('foreign_keys = on');
    expect(() => raw.prepare('insert into territories (id, region_id) values (12, 99)').run()).toThrow();
    raw.prepare('delete from region where id = 1').run();
    expect(raw.prepare('select id from territories order by id').all()).toEqual([{ id: 11 }]);
  });

  it('drops a link the operator removed, and only that one', async () => {
    const { db, raw, actual } = await open();
    const { result } = await apply(db, actual, editOf(territories({ foreignKeys: [] })));

    expect(result.status).toBe('applied');
    expect(raw.prepare('PRAGMA foreign_key_list(territories)').all()).toEqual([]);
  });

  it('keeps a constraint name when the link has one, and both actions', async () => {
    // SQLite's catalog reports no FK names, so the introspected link above is
    // unnamed; a link authored with a name must keep it.
    const { db, actual } = await open();
    const table = actual.tables.find((t) => t.name === 'territories')!;
    const create = compileSqliteRebuild({
      db,
      actual: table,
      desired: table,
      columnMapping: {},
      objects: [],
      foreignKeys: [
        {
          id: 'fk:x',
          kind: 'declared-fk',
          cardinality: 'one-to-many',
          from: { tableId: 'main.territories', columns: ['region_id'] },
          to: { tableId: 'main.region', columns: ['id'] },
          through: null,
          onDelete: 'set-null',
          onUpdate: 'cascade',
          selfReferential: false,
          confidence: 1,
          constraintName: 'fk_territories_region',
        },
      ],
    })
      .map((q) => q.sql)
      .find((text) => text.startsWith('CREATE TABLE'))!;
    expect(create).toContain(
      'CONSTRAINT "fk_territories_region" FOREIGN KEY ("region_id") REFERENCES "region" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
    );
  });
});
