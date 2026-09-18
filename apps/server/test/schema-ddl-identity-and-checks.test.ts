// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two operations the Schema Designer needs and the compiler could not do:
 * changing a column's allowed values on a table that already exists, and giving
 * an existing key auto-increment (D23, plan 50 B6 / T15).
 *
 * ─── Why this file runs the statements instead of matching them ────────────
 *
 * Both bugs were invisible to a string test. `drop-check` compiled to a
 * perfectly well-formed `ALTER TABLE … DROP CONSTRAINT "ck_patients"` — a name
 * no engine has ever assigned — and `set-default` with an auto-increment threw
 * `set-default with no default` only at apply, after the review pane had shown
 * the operator a plan. Asserting the SQL would have frozen both. So every claim
 * here is made by a real server: Postgres and MySQL when their URLs are set,
 * SQLite always (its path is the rebuild, which is a different module).
 *
 * The hazard classes these steps carry were measured the same way — see
 * `packages/engine/test/ddl-hazard-matrix.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { ColumnModel, DdlStep, Dialect, TableModel } from '@adminium/engine';

import { compileStep } from '../src/schema-ddl/compile.js';
import { rebuildColumnMapping, runSqliteRebuild } from '../src/schema-ddl/sqlite-rebuild.js';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const col = (over: Partial<ColumnModel> & { name: string }): ColumnModel => ({
  ordinal: 1, dbType: 'text', logicalType: 'text', nullable: true, default: null,
  isPrimaryKey: false, isUnique: false, isGenerated: false, enumRef: null,
  maxLength: null, numericPrecision: null, numericScale: null, isArray: false,
  comment: null, references: null, semantics: null, ...over,
});

const tbl = (id: string, columns: ColumnModel[], primaryKey: string[] = ['id']): TableModel => ({
  id, schema: id.includes('.') ? id.slice(0, id.indexOf('.')) : 'main',
  name: id.slice(id.lastIndexOf('.') + 1), kind: 'table', comment: null,
  columns, primaryKey, uniques: [], checks: [], indexes: [],
  rowCountEstimate: null, rowCountExact: false, sizeBytes: null, activity: null,
  rls: null, system: false, semantics: null,
});

const step = (over: Partial<DdlStep> & { kind: DdlStep['kind']; table: string }): DdlStep => ({
  id: 's1', column: null, constraint: null, hazard: 'safe', requiresSuperAdmin: false,
  summary: 's', rationale: 'r', consequences: [], dependsOn: [], outsideTransaction: false,
  refusal: null, ...over,
});

/** The step's statements, as the executor would run them. */
async function run(db: AnyDb, dialect: Dialect, s: DdlStep, ctx: Parameters<typeof compileStep>[1] extends infer C ? Omit<C & object, 'db' | 'dialect' | 'serverVersion'> : never): Promise<void> {
  for (const query of compileStep(s, { db, dialect, serverVersion: null, ...ctx })) {
    await sql.raw(query.sql).execute(db);
  }
}

/** The key column, as it is before and after auto-increment is turned on. */
const plainKey = col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false });
const generatedKey = { ...plainKey, default: { kind: 'autoincrement' as const } };

// ---------------------------------------------------------------------------
// Compilation — the shapes, per dialect, with no server
// ---------------------------------------------------------------------------

describe('what the new steps compile to', () => {
  const compiler = (dialect: Dialect): AnyDb =>
    dialect === 'postgres'
      ? (new Kysely({ dialect: new PostgresDialect({ pool: {} as never }) }) as AnyDb)
      : dialect === 'mysql'
        ? (new Kysely({ dialect: new MysqlDialect({ pool: {} as never }) }) as AnyDb)
        : (new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) }) as AnyDb);

  const sqlFor = (s: DdlStep, dialect: Dialect, ctx: Record<string, unknown> = {}): string[] =>
    compileStep(s, { db: compiler(dialect), dialect, serverVersion: null, ...ctx } as never).map((q) => q.sql);

  it('drops a check by the name the database gave it, never by a guess', () => {
    const dropping = step({
      kind: 'drop-check', table: 'public.patients', column: 'status',
      constraint: 'patients_status_check',
    });
    expect(sqlFor(dropping, 'postgres')[0]).toBe(
      'ALTER TABLE "public"."patients" DROP CONSTRAINT "patients_status_check"',
    );
    // MySQL's own spelling for a check, and only for a check.
    expect(sqlFor({ ...dropping, table: 'patients' }, 'mysql')[0]).toBe(
      'ALTER TABLE `patients` DROP CHECK `patients_status_check`',
    );
  });

  it('names a NEW check after its table as well as its column', () => {
    // MySQL scopes constraint names to the SCHEMA, so `ck_status` collided
    // across two tables that each had a `status` enum.
    const adding = step({ kind: 'add-check', table: 'public.patients', column: 'status' });
    expect(sqlFor(adding, 'postgres', { enumValues: { status: ['new', 'seen'] } })[0]).toBe(
      'ALTER TABLE "public"."patients" ADD CONSTRAINT "ck_patients_status" ' +
        `CHECK ("status" IN ('new', 'seen'))`,
    );
  });

  it('turns auto-increment on with the sequence set past the highest row', () => {
    const statements = sqlFor(
      step({ kind: 'set-identity', table: 'public.patients', column: 'id' }),
      'postgres',
    );
    expect(statements[0]).toBe(
      'ALTER TABLE "public"."patients" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY',
    );
    // Without this the fresh sequence starts at 1 and the next insert collides
    // with an existing row — measured on postgres 18.3.
    expect(statements[1]).toContain('setval(pg_get_serial_sequence');
    expect(statements[1]).toContain('MAX("id")');
  });
});

// ---------------------------------------------------------------------------
// SQLite — the rebuild carries both
// ---------------------------------------------------------------------------

describe('sqlite reaches both through the rebuild', () => {
  it('replaces the enum check and keeps an unrelated one', async () => {
    const raw = new BetterSqlite3(':memory:');
    raw.exec(`
      create table patients (
        id integer primary key,
        status text check (status in ('new')),
        age integer check (age >= 0)
      );
      insert into patients (status, age) values ('new', 3);
    `);
    const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
    try {
      const columns = [
        col({ name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, default: { kind: 'autoincrement' } }),
        col({ name: 'status', logicalType: 'enum', dbType: 'text' }),
        col({ name: 'age', logicalType: 'integer', dbType: 'integer' }),
      ];
      const actual: TableModel = {
        ...tbl('main.patients', columns),
        checks: [
          { name: null, expression: "status in ('new')" },
          { name: null, expression: 'age >= 0' },
        ],
      };
      await runSqliteRebuild({
        db, actual, desired: actual,
        columnMapping: rebuildColumnMapping(actual, actual),
        enumValues: { status: ['new', 'seen'] },
      });

      // The widened list is in force…
      raw.exec(`insert into patients (status, age) values ('seen', 1)`);
      // …the value that is in neither list is still refused…
      expect(() => raw.exec(`insert into patients (status, age) values ('void', 1)`)).toThrow(/constraint/i);
      // …and the check that was never about the enum survived the rebuild.
      expect(() => raw.exec(`insert into patients (status, age) values ('new', -1)`)).toThrow(/constraint/i);
      expect(raw.prepare('select count(*) as n from patients').get()).toEqual({ n: 2 });
    } finally {
      await db.destroy();
    }
  });

  it('gives an existing key auto-increment by rebuilding it as the rowid alias', async () => {
    const raw = new BetterSqlite3(':memory:');
    raw.exec(`
      create table notes (id integer not null primary key, body text);
      insert into notes (id, body) values (1, 'a'), (5, 'b');
    `);
    const db = new Kysely({ dialect: new SqliteDialect({ database: raw }) }) as AnyDb;
    try {
      const body = col({ name: 'body', logicalType: 'text', dbType: 'text' });
      const actual = tbl('main.notes', [plainKey, body]);
      const desired = tbl('main.notes', [generatedKey, body]);
      await runSqliteRebuild({
        db, actual, desired,
        columnMapping: rebuildColumnMapping(actual, desired),
      });
      raw.exec(`insert into notes (body) values ('c')`);
      expect(raw.prepare('select max(id) as m from notes').get()).toEqual({ m: 6 });
    } finally {
      await db.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

describe.skipIf(POSTGRES_URL === undefined)('against a real PostgreSQL', () => {
  async function open(): Promise<{ db: AnyDb; schema: string; done: () => Promise<void> }> {
    const require = createRequire(import.meta.url);
    const { Pool } = require('pg') as { Pool: new (config: unknown) => never };
    const schema = `adm_ddl_${randomBytes(4).toString('hex')}`;
    const pool = new Pool({ connectionString: POSTGRES_URL });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) }) as AnyDb;
    await sql.raw(`create schema ${schema}`).execute(db);
    return {
      db,
      schema,
      done: async () => {
        await sql.raw(`drop schema ${schema} cascade`).execute(db);
        await db.destroy();
      },
    };
  }

  it('changes the allowed values on a table that already has rows', async () => {
    const { db, schema, done } = await open();
    try {
      await sql.raw(`create table ${schema}.patients (
        id integer primary key,
        status varchar(10) constraint patients_status_check check (status in ('new'))
      )`).execute(db);
      await sql.raw(`insert into ${schema}.patients values (1, 'new')`).execute(db);

      const table = `${schema}.patients`;
      const columns = [plainKey, col({ name: 'status', logicalType: 'enum', dbType: 'varchar(10)' })];
      const ctx = { desired: tbl(table, columns), enumValues: { status: ['new', 'seen'] } };
      await run(db, 'postgres', step({ kind: 'drop-check', table, column: 'status', constraint: 'patients_status_check' }), ctx as never);
      await run(db, 'postgres', step({ kind: 'add-check', table, column: 'status' }), ctx as never);

      await sql.raw(`insert into ${table} values (2, 'seen')`).execute(db);
      await expect(
        sql.raw(`insert into ${table} values (3, 'void')`).execute(db),
      ).rejects.toThrow(/ck_patients_status/);
    } finally {
      await done();
    }
  });

  it('turns auto-increment on for an existing key without colliding with its rows', async () => {
    const { db, schema, done } = await open();
    try {
      await sql.raw(`create table ${schema}.notes (id integer primary key, body text)`).execute(db);
      await sql.raw(`insert into ${schema}.notes values (1, 'a'), (5, 'b')`).execute(db);

      const table = `${schema}.notes`;
      const body = col({ name: 'body', logicalType: 'text', dbType: 'text' });
      const ctx = { desired: tbl(table, [generatedKey, body]) };
      await run(db, 'postgres', step({ kind: 'set-identity', table, column: 'id' }), ctx as never);

      // The sequence starts where the data ends, not at 1.
      const inserted = await sql<{ id: number }>`insert into ${sql.raw(table)} (body) values ('c') returning id`.execute(db);
      expect(inserted.rows[0]?.id).toBe(6);

      // …and off again: postgres refuses DROP DEFAULT on an identity column by
      // name, which is why this is its own step kind.
      await run(db, 'postgres', step({ kind: 'drop-identity', table, column: 'id' }), {
        desired: tbl(table, [plainKey, body]),
      } as never);
      await expect(
        sql.raw(`insert into ${table} (body) values ('d')`).execute(db),
      ).rejects.toThrow(/null value in column "id"|not-null/i);
    } finally {
      await done();
    }
  });
});

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

const MYSQL_URL = process.env.TEST_MYSQL_URL;

describe.skipIf(MYSQL_URL === undefined)('against a real MySQL', () => {
  async function open(): Promise<{ db: AnyDb; done: () => Promise<void> }> {
    const mysql = await import('mysql2');
    const database = `adm_ddl_${randomBytes(4).toString('hex')}`;
    const admin = mysql.createPool({ uri: MYSQL_URL as string, connectionLimit: 1 }).promise();
    await admin.query(`CREATE DATABASE \`${database}\``);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${database}`;
    const db = new Kysely({
      dialect: new MysqlDialect({ pool: mysql.createPool({ uri: url.toString() }) }),
    }) as AnyDb;
    return {
      db,
      done: async () => {
        await db.destroy();
        await admin.query(`DROP DATABASE \`${database}\``);
        await admin.end();
      },
    };
  }

  it('changes the allowed values on a table that already has rows', async () => {
    const { db, done } = await open();
    try {
      await sql.raw(`create table patients (
        id int primary key,
        status varchar(10),
        constraint patients_status_check check (status in ('new'))
      )`).execute(db);
      await sql.raw(`insert into patients values (1, 'new')`).execute(db);

      const columns = [plainKey, col({ name: 'status', logicalType: 'enum', dbType: 'varchar(10)' })];
      const ctx = { desired: tbl('patients', columns), enumValues: { status: ['new', 'seen'] } };
      await run(db, 'mysql', step({ kind: 'drop-check', table: 'patients', column: 'status', constraint: 'patients_status_check' }), ctx as never);
      await run(db, 'mysql', step({ kind: 'add-check', table: 'patients', column: 'status' }), ctx as never);

      await sql.raw(`insert into patients values (2, 'seen')`).execute(db);
      await expect(
        sql.raw(`insert into patients values (3, 'void')`).execute(db),
      ).rejects.toThrow(/ck_patients_status|check constraint/i);
    } finally {
      await done();
    }
  });

  it('turns auto-increment on for an existing key and continues past its rows', async () => {
    const { db, done } = await open();
    try {
      await sql.raw('create table notes (id int not null primary key, body text)').execute(db);
      await sql.raw(`insert into notes values (1, 'a'), (5, 'b')`).execute(db);

      const body = col({ name: 'body', logicalType: 'text', dbType: 'text' });
      await run(db, 'mysql', step({ kind: 'set-identity', table: 'notes', column: 'id', hazard: 'rewrite' }), {
        desired: tbl('notes', [generatedKey, body]),
      } as never);

      await sql.raw(`insert into notes (body) values ('c')`).execute(db);
      const max = await sql<{ m: number }>`select max(id) as m from notes`.execute(db);
      // MySQL sets AUTO_INCREMENT to the highest existing value + 1 by itself —
      // measured on 26.7, which is why no RESTART is emitted here.
      expect(Number(max.rows[0]?.m)).toBe(6);

      await run(db, 'mysql', step({ kind: 'drop-identity', table: 'notes', column: 'id', hazard: 'rewrite' }), {
        desired: tbl('notes', [plainKey, body]),
      } as never);
      const created = await sql<{ 'Create Table': string }>`show create table notes`.execute(db);
      expect(created.rows[0]?.['Create Table']).not.toContain('AUTO_INCREMENT');
    } finally {
      await done();
    }
  });
});
