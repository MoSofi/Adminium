// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Free SQL text that reaches DDL (an expression default, from a snapshot or a
 * schema import) on a live database of each engine: the payload that ran a
 * second statement is refused before any SQL is made and leaves nothing
 * behind; a plain expression default, now inside parentheses of its own, is
 * still taken by every engine.
 *
 * SQLite always; Postgres with TEST_POSTGRES_URL, MySQL with TEST_MYSQL_URL.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { createPool } from 'mysql2';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import type { ColumnModel, Dialect, TableModel } from '@adminium/engine';

import { columnDefinition } from '../src/schema-ddl/compile.js';

const POSTGRES_URL = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL_URL = process.env['TEST_MYSQL_URL'] || undefined;
const MYSQL_DATABASE = 'adminium_test_sql_text';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers.reverse()) await close();
});

async function open(dialect: Exclude<Dialect, 'generic'>): Promise<AnyDb> {
  if (dialect === 'sqlite') {
    const db = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) }) as AnyDb;
    closers.push(async () => db.destroy());
    return db;
  }
  if (dialect === 'postgres') {
    const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: POSTGRES_URL }) }) }) as AnyDb;
    closers.push(async () => db.destroy());
    return db;
  }
  const admin = createPool({ uri: MYSQL_URL! });
  await admin.promise().query(`create database if not exists ${MYSQL_DATABASE}`);
  await admin.promise().end();
  const db = new Kysely({ dialect: new MysqlDialect({ pool: createPool({ uri: `${MYSQL_URL!.replace(/\/$/, '')}/${MYSQL_DATABASE}` }) }) }) as AnyDb;
  closers.push(async () => db.destroy());
  return db;
}

const column = (name: string, text: string, logicalType: ColumnModel['logicalType'], dbType: string): ColumnModel => ({
  name,
  ordinal: 1,
  dbType,
  logicalType,
  nullable: true,
  default: { kind: 'expression', text },
  isPrimaryKey: false,
  isUnique: false,
  isGenerated: false,
  enumRef: null,
  maxLength: logicalType === 'varchar' ? 64 : null,
  numericPrecision: null,
  numericScale: null,
  isArray: false,
  comment: null,
  references: null,
  semantics: null,
});

const table = (columns: ColumnModel[]): TableModel => ({
  id: 'sql_text_probe',
  schema: 'public',
  name: 'sql_text_probe',
  kind: 'table',
  comment: null,
  columns,
  primaryKey: [],
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
});

/** The reviewer's payload, the second statement made to leave a mark when it runs. */
const STACKED = '0); create table sql_text_stacked (x int); --';

/** A plain expression default each engine takes, and what a new row reads. */
type Engine = Exclude<Dialect, 'generic'>;
const PLAIN: Record<Engine, { text: string; logicalType: ColumnModel['logicalType']; dbType: string }> = {
  postgres: { text: "lower('ABC')", logicalType: 'varchar', dbType: 'varchar(64)' },
  mysql: { text: "lower('ABC')", logicalType: 'varchar', dbType: 'varchar(64)' },
  sqlite: { text: "lower('ABC')", logicalType: 'text', dbType: 'text' },
};

const ENGINES: [Engine, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

describe('an expression default on a live database', { timeout: 60_000 }, () => {
  for (const [dialect, available] of ENGINES) {
    it.skipIf(!available)(`${dialect}: the stacked statement is refused and leaves nothing; a plain expression still works`, async () => {
      const db = await open(dialect);
      await sql`drop table if exists sql_text_stacked`.execute(db);
      await sql`drop table if exists sql_text_probe`.execute(db);

      const attack = table([column('c', STACKED, 'integer', 'integer')]);
      expect(() => columnDefinition(attack.columns[0]!, attack, dialect)).toThrow(/expression default/);
      const tables = (await db.introspection.getTables()).map((one) => one.name);
      expect(tables).not.toContain('sql_text_stacked');

      const plain = PLAIN[dialect];
      const ok = table([column('label', plain.text, plain.logicalType, plain.dbType), column('n', '1 + 1', 'integer', 'integer')]);
      const defs = ok.columns.map((one) => columnDefinition(one, ok, dialect));
      await sql.raw(`create table sql_text_probe (${defs.join(', ')})`).execute(db);
      await sql.raw('insert into sql_text_probe (label) values (default)').execute(db).catch(async () => sql.raw('insert into sql_text_probe default values').execute(db));
      const rows = await sql<{ label: string; n: number }>`select label, n from sql_text_probe`.execute(db);
      expect(rows.rows[0]).toMatchObject({ label: 'abc' });
      expect(Number(rows.rows[0]?.n)).toBe(2);
      await sql`drop table sql_text_probe`.execute(db);
    });
  }
});
