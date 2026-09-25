// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dropping an index drops THAT index, by its own name, on every engine.
 *
 * The planner once sent a `drop-index` step with no name and the compiler
 * guessed `ix_<table>` — which named nothing on a table whose index was
 * called anything else, so the drop failed (or, worse, removed an index of
 * that name that was not the one asked about). Here a real table on each
 * engine carries two indexes; the plan removes one; the compiled statement
 * runs; exactly that one is gone.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { createPool } from 'mysql2';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { parseDatabaseModel, planDdl, type DesiredTable, type Dialect } from '@adminium/engine';

import { compileStep } from '../src/schema-ddl/compile.js';
import { LEGS, MYSQL_URL, POSTGRES_URL } from './invoicing-install.helpers.js';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers) await close();
});

const DATABASE = 'adm_drop_index_test';

async function connect(dialect: Dialect): Promise<AnyDb> {
  if (dialect === 'sqlite') {
    const db = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) }) as AnyDb;
    closers.push(() => db.destroy());
    return db;
  }
  if (dialect === 'postgres') {
    const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: POSTGRES_URL, max: 1 }) }) }) as AnyDb;
    closers.push(() => db.destroy());
    await sql`drop table if exists public.notes`.execute(db);
    return db;
  }
  const admin = new Kysely({ dialect: new MysqlDialect({ pool: createPool({ uri: MYSQL_URL!, connectionLimit: 1 }) }) }) as AnyDb;
  await sql.raw(`create database if not exists ${DATABASE}`).execute(admin);
  await admin.destroy();
  const db = new Kysely({ dialect: new MysqlDialect({ pool: createPool({ uri: `${MYSQL_URL!}/${DATABASE}`, connectionLimit: 1 }) }) }) as AnyDb;
  closers.push(async () => {
    await sql.raw(`drop database if exists ${DATABASE}`).execute(db);
    await db.destroy();
  });
  await sql`drop table if exists notes`.execute(db);
  return db;
}

const tableId = (dialect: Dialect) => (dialect === 'postgres' ? 'public.notes' : dialect === 'mysql' ? `${DATABASE}.notes` : 'main.notes');

async function indexNames(db: AnyDb, dialect: Dialect): Promise<string[]> {
  const rows =
    dialect === 'sqlite'
      ? (await sql<{ name: string }>`select name from sqlite_master where type = 'index' and tbl_name = 'notes' and sql is not null`.execute(db)).rows
      : dialect === 'postgres'
        ? (await sql<{ name: string }>`select indexname as name from pg_indexes where schemaname = 'public' and tablename = 'notes' and indexname <> 'notes_pkey'`.execute(db)).rows
        : (await sql<{ name: string }>`select distinct index_name as name from information_schema.statistics where table_schema = ${DATABASE} and table_name = 'notes' and index_name <> 'PRIMARY'`.execute(db)).rows;
  return rows.map((r) => r.name).sort();
}

describe.each(LEGS)('dropping one index by its name — %s', (dialect, reachable) => {
  it.skipIf(!reachable)('removes exactly the index the plan names', async () => {
    const db = await connect(dialect);
    await sql.raw('create table notes (id integer primary key, author varchar(40), body varchar(200))').execute(db);
    await sql.raw('create index notes_by_author on notes (author)').execute(db);
    await sql.raw('create index notes_by_body on notes (body)').execute(db);
    expect(await indexNames(db, dialect)).toEqual(['notes_by_author', 'notes_by_body']);

    const column = (name: string, ordinal: number, over: Record<string, unknown> = {}) => ({
      name, ordinal, dbType: 'varchar(40)', logicalType: 'text', nullable: true, default: null, isPrimaryKey: false, isUnique: false,
      isGenerated: false, enumRef: null, maxLength: 40, numericPrecision: null, numericScale: null, isArray: false, comment: null,
      references: null, semantics: null, ...over,
    });
    const index = (name: string, col: string) => ({ name, columns: [col], expression: null, unique: false, primary: false, method: null, partial: false });
    const table = (indexes: ReturnType<typeof index>[]) => ({
      id: tableId(dialect),
      schema: dialect === 'postgres' ? 'public' : dialect === 'mysql' ? DATABASE : 'main',
      name: 'notes', kind: 'table', comment: null,
      columns: [column('id', 1, { dbType: 'integer', logicalType: 'integer', nullable: false, isPrimaryKey: true, maxLength: null }), column('author', 2), column('body', 3)],
      primaryKey: ['id'], uniques: [], checks: [], indexes,
      rowCountEstimate: null, rowCountExact: false, sizeBytes: null, activity: null, rls: null, system: false, semantics: null,
    });
    const actual = parseDatabaseModel(
      JSON.stringify({ irVersion: 1, dialect, name: 't', tables: [table([index('notes_by_author', 'author'), index('notes_by_body', 'body')])], relations: [], enums: [] }),
    );
    const desired = parseDatabaseModel(
      JSON.stringify({ irVersion: 1, dialect, name: 't', tables: [table([index('notes_by_body', 'body')])], relations: [], enums: [] }),
    ).tables as unknown as DesiredTable[];
    const plan = planDdl({ dialect, serverVersion: null, actual, desired: desired as never });
    const drop = plan.steps.find((step) => step.kind === 'drop-index');
    expect(drop?.constraint).toBe('notes_by_author');

    for (const query of compileStep(drop!, { db, dialect, serverVersion: null })) await sql.raw(query.sql).execute(db);
    expect(await indexNames(db, dialect)).toEqual(['notes_by_body']);
  });
});
