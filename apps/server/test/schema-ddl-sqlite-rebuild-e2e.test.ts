// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SQLite rebuild, executed — 35-schema-authoring.md §7, 35-T06.
 *
 * ─── Why this file exists ──────────────────────────────────────────────────
 *
 * Every piece of the rebuild was unit-tested and the whole thing was
 * unreachable. `compileSqliteRebuild`, `assertRebuildMatches` and
 * `assertNoForeignKeyViolations` had passing tests; the planner emitted
 * `rebuild-table`; `compileStep` threw for that kind by design; the plan
 * service caught the throw and returned NO statements; and the apply loop
 * iterated an empty statement list and recorded the step as **succeeded**.
 *
 * On SQLite — the desktop engine, where everything except "add a column" is a
 * rebuild — a type change, a nullability change, a primary-key change or any
 * added constraint reported success and did nothing.
 *
 * A test that drives one half at a time cannot catch that. This one runs the
 * procedure against a real database and asserts the table CHANGED.
 */
import { afterAll, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { ColumnModel, TableModel } from '@adminium/engine';

import { rebuildColumnMapping, runSqliteRebuild, SqliteRebuildError } from '../src/schema-ddl/sqlite-rebuild.js';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers) await close();
});

function open(setup: string): { db: AnyDb; raw: BetterSqlite3.Database } {
  const raw = new BetterSqlite3(':memory:');
  raw.exec(setup);
  const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
  closers.push(async () => {
    await db.destroy();
  });
  return { db, raw };
}

const col = (over: Partial<ColumnModel> & { name: string }): ColumnModel => ({
  ordinal: 1, dbType: 'text', logicalType: 'text', nullable: true, default: null,
  isPrimaryKey: false, isUnique: false, isGenerated: false, enumRef: null,
  maxLength: null, numericPrecision: null, numericScale: null, isArray: false,
  comment: null, references: null, semantics: null, ...over,
});

const tbl = (over: Partial<TableModel> & { name: string }): TableModel => ({
  id: `main.${over.name}`, schema: 'main', kind: 'table', comment: null,
  columns: [], primaryKey: [], uniques: [], checks: [], indexes: [],
  rowCountEstimate: null, rowCountExact: false, sizeBytes: null, activity: null,
  rls: null, system: false, semantics: null, ...over,
});

describe('the rebuild actually rebuilds', () => {
  it('changes a column type and keeps every row', async () => {
    const { db, raw } = open(`
      create table notes (id integer primary key, amount text);
      insert into notes (amount) values ('10'), ('20');
    `);
    const actual = tbl({
      name: 'notes',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'amount', logicalType: 'text', dbType: 'text' }),
      ],
      primaryKey: ['id'],
    });
    const desired = { ...actual, columns: [actual.columns[0]!, col({ name: 'amount', logicalType: 'integer', dbType: 'integer' })] };

    await runSqliteRebuild({
      db, actual, desired,
      columnMapping: rebuildColumnMapping(actual, desired),
    });

    // The declared type really changed…
    const info = raw.prepare('PRAGMA table_info(notes)').all() as { name: string; type: string }[];
    expect(info.find((c) => c.name === 'amount')?.type.toLowerCase()).toBe('integer');
    // …and both rows survived the copy.
    expect(raw.prepare('select count(*) c from notes').get()).toEqual({ c: 2 });
    // The temporary table is gone.
    const tables = raw.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).not.toContain('adminium_rebuild_notes');
  });

  it('recreates an index the rebuild would otherwise drop (step 8)', async () => {
    const { db, raw } = open(`
      create table notes (id integer primary key, body text);
      create index ix_notes_body on notes (body);
    `);
    const actual = tbl({
      name: 'notes',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'body', logicalType: 'text', dbType: 'text' }),
      ],
      primaryKey: ['id'],
      indexes: [{ name: 'ix_notes_body', columns: ['body'], expression: null, unique: false, primary: false, method: null, partial: false }],
    });
    const desired = { ...actual, columns: [actual.columns[0]!, col({ name: 'body', logicalType: 'varchar', maxLength: 400, dbType: 'varchar(400)' })] };

    await runSqliteRebuild({ db, actual, desired, columnMapping: rebuildColumnMapping(actual, desired) });

    const indexes = raw.prepare("select name from sqlite_master where type='index' and tbl_name='notes'").all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('ix_notes_body');
  });

  it('adds a NOT NULL constraint SQLite has no ALTER for', async () => {
    const { db, raw } = open(`
      create table notes (id integer primary key, body text);
      insert into notes (body) values ('hi');
    `);
    const actual = tbl({
      name: 'notes',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'body', logicalType: 'text', dbType: 'text', nullable: true }),
      ],
      primaryKey: ['id'],
    });
    const desired = { ...actual, columns: [actual.columns[0]!, col({ name: 'body', logicalType: 'text', dbType: 'text', nullable: false })] };

    await runSqliteRebuild({ db, actual, desired, columnMapping: rebuildColumnMapping(actual, desired) });

    const info = raw.prepare('PRAGMA table_info(notes)').all() as { name: string; notnull: number }[];
    expect(info.find((c) => c.name === 'body')?.notnull).toBe(1);
    // The constraint is real: SQLite rejects a null now.
    expect(() => raw.prepare('insert into notes (body) values (null)').run()).toThrow();
  });

  it('copies a renamed column from its old name', async () => {
    const { db, raw } = open(`
      create table notes (id integer primary key, old_name text);
      insert into notes (old_name) values ('kept');
    `);
    const actual = tbl({
      name: 'notes',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'old_name', logicalType: 'text', dbType: 'text' }),
      ],
      primaryKey: ['id'],
    });
    const desired = { ...actual, columns: [actual.columns[0]!, col({ name: 'new_name', logicalType: 'text', dbType: 'text', nullable: false })] };

    await runSqliteRebuild({
      db, actual, desired,
      columnMapping: rebuildColumnMapping(actual, desired, { old_name: 'new_name' }),
    });

    expect(raw.prepare('select new_name from notes').get()).toEqual({ new_name: 'kept' });
  });

  it('rolls back and leaves the table intact when a step fails', async () => {
    const { db, raw } = open(`
      create table notes (id integer primary key, body text);
      insert into notes (body) values (null);
    `);
    const actual = tbl({
      name: 'notes',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'body', logicalType: 'text', dbType: 'text', nullable: true }),
      ],
      primaryKey: ['id'],
    });
    // NOT NULL against a table holding a null row — the copy must fail.
    const desired = { ...actual, columns: [actual.columns[0]!, col({ name: 'body', logicalType: 'text', dbType: 'text', nullable: false })] };

    await expect(
      runSqliteRebuild({ db, actual, desired, columnMapping: rebuildColumnMapping(actual, desired) }),
    ).rejects.toThrow();

    // The original table is still there, still holding its row.
    expect(raw.prepare('select count(*) c from notes').get()).toEqual({ c: 1 });
    const info = raw.prepare('PRAGMA table_info(notes)').all() as { name: string; notnull: number }[];
    expect(info.find((c) => c.name === 'body')?.notnull).toBe(0);
  });

  it('runs step 12 when a re-introspection is supplied, and refuses a mismatch', async () => {
    const { db } = open('create table notes (id integer primary key, body text);');
    const actual = tbl({
      name: 'notes',
      columns: [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'body', logicalType: 'text', dbType: 'text' }),
      ],
      primaryKey: ['id'],
    });
    const desired = { ...actual, columns: [actual.columns[0]!, col({ name: 'body', logicalType: 'integer', dbType: 'integer' })] };

    // A re-introspection that reports the OLD shape — what a silently-failed
    // rebuild would look like. Step 12 is what turns that into an error.
    await expect(
      runSqliteRebuild({
        db, actual, desired,
        columnMapping: rebuildColumnMapping(actual, desired),
        reintrospect: async () => actual,
      }),
    ).rejects.toThrow(SqliteRebuildError);
  });
});
