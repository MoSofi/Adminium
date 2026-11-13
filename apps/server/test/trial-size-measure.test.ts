// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How a trial's size cap measures a database, against real Postgres and
 * MySQL servers: the order rows were written in cannot hide them, a vacuum
 * cannot bring back what was deleted, a table named like Adminium's own
 * counts unless the meta store shares the database, the session's
 * `search_path` cannot blind it, and large objects count. And it stays cheap
 * on a database of thousands of tables.
 */
import { randomBytes } from 'node:crypto';

import { CompiledQuery, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, PostgresAdapter, PostgresDialect, PostgresIntrospector, PostgresQueryCompiler, sql, type DatabaseConnection, type Dialect, type Driver, type QueryResult, MysqlDialect } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { measureMysql, measurePostgres, type TableMemo } from '../src/trial/size-cap.js';
import { PG_HOST, PG_PORT, pgAvailable, psql } from './connections-helpers.js';

const MB = 1024 * 1024;

// ─── Postgres ─────────────────────────────────────────────────────────────────

describe.skipIf(!pgAvailable())('the measure on a live Postgres', { timeout: 120_000 }, () => {
  const database = `adminium_test_p75fxsize_${randomBytes(4).toString('hex')}`;
  const user = process.env.PGUSER ?? process.env.USER ?? 'postgres';
  const url = `postgres://${user}@${PG_HOST}:${PG_PORT}/${database}`;
  let db: Kysely<never>;
  let pgModule: typeof import('pg');
  const open = (dsn: string): Kysely<never> => new Kysely<never>({ dialect: new PostgresDialect({ pool: new pgModule.default.Pool({ connectionString: dsn, max: 2 }) }) });
  const one = (text: string): number => Number(psql(database, text).trim());

  beforeAll(async () => {
    pgModule = await import('pg');
    psql('postgres', `CREATE DATABASE ${database}`);
    db = open(url);
  });
  afterAll(async () => {
    await db.destroy();
    psql('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  });
  // Each test starts from an empty database, whatever the one before left.
  afterEach(() => {
    psql(database, 'DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    psql(database, 'SELECT lo_unlink(oid) FROM pg_largeobject_metadata');
  });

  it('is not fooled by small rows written before large ones', async () => {
    psql(database, 'CREATE TABLE heavy (id serial PRIMARY KEY, body text)');
    psql(database, "INSERT INTO heavy (body) SELECT 'x' FROM generate_series(1, 2000)");
    // 24 rows of about 1 MB each that do not compress, kept out of the page by TOAST.
    psql(database, "INSERT INTO heavy (body) SELECT (SELECT string_agg(md5(random()::text || r::text || c::text), '') FROM generate_series(1, 32768) c) FROM generate_series(1, 24) r");
    const live = one('SELECT sum(pg_column_size(t.*)) FROM heavy t');
    expect(live).toBeGreaterThan(24 * MB);
    expect(await measurePostgres(db)).toBeGreaterThanOrEqual(live * 0.8);
  });

  it('counts nothing for a table emptied and vacuumed, though its index keeps its size', async () => {
    psql(database, 'CREATE TABLE indexed (id serial PRIMARY KEY, body text NOT NULL)');
    psql(database, 'CREATE INDEX indexed_body ON indexed (body)');
    psql(database, 'CREATE INDEX indexed_body_id ON indexed (body, id)');
    psql(database, 'INSERT INTO indexed (body) SELECT repeat(md5(i::text), 8) FROM generate_series(1, 40000) i');
    const full = await measurePostgres(db);
    expect(full).toBeGreaterThan(20 * MB);
    psql(database, 'DELETE FROM indexed WHERE id % 2 = 0');
    psql(database, 'VACUUM indexed');
    const half = await measurePostgres(db);
    expect(half).toBeLessThan(full * 0.65);
    psql(database, 'DELETE FROM indexed');
    psql(database, 'VACUUM indexed');
    // Its files keep most of their size: the indexes are never given back by a vacuum.
    expect(one("SELECT pg_total_relation_size('indexed')")).toBeGreaterThan(10 * MB);
    expect(await measurePostgres(db)).toBeLessThan(MB);
  });

  it('sees a delete at once', async () => {
    psql(database, 'CREATE TABLE notes (id integer PRIMARY KEY, body text NOT NULL)');
    psql(database, 'INSERT INTO notes SELECT i, repeat(md5(i::text), 32) FROM generate_series(1, 20000) i');
    const full = await measurePostgres(db);
    psql(database, 'DELETE FROM notes WHERE id % 2 = 0');
    // No waiting for the statistics: the rows themselves are read.
    expect(await measurePostgres(db)).toBeLessThan(full * 0.6);
  });

  it('counts a table named like Adminium’s own, unless the meta store shares this database', async () => {
    psql(database, 'CREATE TABLE adminium_bulk (id serial PRIMARY KEY, body text)');
    psql(database, 'INSERT INTO adminium_bulk (body) SELECT repeat(md5(i::text), 30) FROM generate_series(1, 20000) i');
    expect(await measurePostgres(db)).toBeGreaterThan(10 * MB);
    expect(await measurePostgres(db, { skipMetaTables: true })).toBeLessThan(MB);
  });

  it('is not blinded by a table named like a catalog on the session’s search_path', async () => {
    psql(database, 'CREATE TABLE shadowed (id serial PRIMARY KEY, body text)');
    psql(database, 'INSERT INTO shadowed (body) SELECT repeat(md5(i::text), 30) FROM generate_series(1, 20000) i');
    const before = await measurePostgres(db);
    const shadow = open(`${url}?options=-c%20search_path%3Dpublic%2Cpg_catalog`);
    try {
      await sql`create table public.pg_class (oid oid, relkind "char", relpages int)`.execute(shadow);
      await sql`create table public.pg_stat_user_tables (relid oid, relname name, schemaname name, n_live_tup bigint, n_dead_tup bigint)`.execute(shadow);
      expect(await measurePostgres(shadow)).toBeGreaterThan(before * 0.9);
    } finally {
      await shadow.destroy();
    }
  });

  it('counts a dropped column’s values until the table is rewritten, and a delete still lets them go', async () => {
    psql(database, 'CREATE TABLE cycled (id serial PRIMARY KEY)');
    const memo: TableMemo = new Map();
    let dropped = 0;
    // Add a column, fill it, drop it: each round's values stay in its rows, kept in the page (about 1.8 KB, under TOAST's line).
    for (let round = 1; round <= 3; round += 1) {
      psql(database, `ALTER TABLE cycled ADD COLUMN pad text; INSERT INTO cycled (pad) SELECT repeat(md5(g::text || '${String(round)}'), 56) FROM generate_series(1, 5000) g`);
      psql(database, 'VACUUM cycled');
      const filled = await measurePostgres(db, { memo, fresh: true });
      psql(database, 'ALTER TABLE cycled DROP COLUMN pad');
      dropped = await measurePostgres(db, { memo, fresh: true });
      expect(dropped).toBeGreaterThan(filled * 0.9);
    }
    expect(dropped).toBeGreaterThan(3 * 5000 * 1792);
    psql(database, 'DELETE FROM cycled WHERE id % 2 = 0');
    const half = await measurePostgres(db, { memo, fresh: true });
    expect(half).toBeLessThan(dropped * 0.6);
    // A rewrite leaves the dropped values behind.
    psql(database, 'VACUUM FULL cycled');
    expect(await measurePostgres(db, { memo, fresh: true })).toBeLessThan(MB);
  });

  it('counts the large objects this login owns', async () => {
    const before = await measurePostgres(db);
    psql(database, "SELECT lo_from_bytea(0, convert_to(repeat(md5('a'), 131072), 'UTF8'))");
    expect(await measurePostgres(db)).toBeGreaterThan(before + 3.5 * MB);
  });
});

// ─── MySQL ────────────────────────────────────────────────────────────────────

// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

describe.skipIf(MYSQL_URL === undefined)('the measure on a live MySQL', { timeout: 120_000 }, () => {
  const database = `adminium_test_p75fxsize_${randomBytes(4).toString('hex')}`;
  let db: Kysely<never>;
  let admin: { query(text: string): Promise<unknown>; end(): Promise<void> };

  beforeAll(async () => {
    const mysql = await import('mysql2');
    admin = mysql.createPool({ uri: MYSQL_URL as string, connectionLimit: 1 }).promise();
    await admin.query(`CREATE DATABASE \`${database}\``);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${database}`;
    db = new Kysely<never>({ dialect: new MysqlDialect({ pool: mysql.createPool({ uri: url.toString(), multipleStatements: false }) }) });
  });
  afterAll(async () => {
    await db.destroy();
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  });
  afterEach(async () => {
    await sql`drop table if exists heavy, adminium_bulk, cycled`.execute(db);
  });

  it('is not fooled by small rows written before large ones', async () => {
    await sql`create table heavy (id int auto_increment primary key, body longtext not null)`.execute(db);
    for (let batch = 0; batch < 4; batch += 1) {
      const values = Array.from({ length: 250 }, () => sql`(${'x'})`);
      await sql`insert into heavy (body) values ${sql.join(values)}`.execute(db);
    }
    for (let i = 0; i < 40; i += 1) await sql`insert into heavy (body) values (${randomBytes(165_000).toString('hex')})`.execute(db);
    await sql`analyze table heavy`.execute(db);
    const { rows } = await sql<{ live: string }>`select sum(length(body)) as live from heavy`.execute(db);
    const live = Number(rows[0]?.live);
    expect(live).toBeGreaterThan(12 * MB);
    expect(await measureMysql(db)).toBeGreaterThanOrEqual(live * 0.8);
  });

  it('counts a dropped column’s values until the table is rebuilt, and a delete still lets them go', async () => {
    await sql`create table cycled (id int auto_increment primary key)`.execute(db);
    const memo: TableMemo = new Map();
    let dropped = 0;
    // Add a column, fill it, drop it: a drop made in place leaves each round's values in its rows.
    for (let round = 1; round <= 3; round += 1) {
      await sql`alter table cycled add column pad varchar(4000)`.execute(db);
      for (let batch = 0; batch < 4; batch += 1) {
        const values = Array.from({ length: 1000 }, () => sql`(${randomBytes(900).toString('hex')})`);
        await sql`insert into cycled (pad) values ${sql.join(values)}`.execute(db);
      }
      await sql`analyze table cycled`.execute(db);
      const filled = await measureMysql(db, { memo, fresh: true });
      await sql`alter table cycled drop column pad`.execute(db);
      await sql`analyze table cycled`.execute(db);
      dropped = await measureMysql(db, { memo, fresh: true });
      expect(dropped).toBeGreaterThan(filled * 0.9);
    }
    expect(dropped).toBeGreaterThan(3 * 4000 * 1800);
    await sql`delete from cycled where id % 4 <> 0`.execute(db);
    await sql`analyze table cycled`.execute(db);
    expect(await measureMysql(db, { memo, fresh: true })).toBeLessThan(dropped * 0.4);
    // A rebuild leaves the dropped values behind.
    await sql`optimize table cycled`.execute(db);
    expect(await measureMysql(db, { memo, fresh: true })).toBeLessThan(MB);
  });

  it('counts a table named like Adminium’s own, unless the meta store shares this database', async () => {
    await sql`create table adminium_bulk (id int primary key, body text not null)`.execute(db);
    for (let batch = 0; batch < 4; batch += 1) {
      const values = Array.from({ length: 1000 }, (_, i) => sql`(${batch * 1000 + i + 1}, ${'n'.repeat(1000)})`);
      await sql`insert into adminium_bulk values ${sql.join(values)}`.execute(db);
    }
    await sql`analyze table adminium_bulk`.execute(db);
    expect(await measureMysql(db)).toBeGreaterThan(3.5 * MB);
    expect(await measureMysql(db, { skipMetaTables: true })).toBeLessThan(MB);
  });
});

// ─── A database of many tables ────────────────────────────────────────────────

/** A Kysely whose every statement is answered by `answer` from its text, no server behind it. */
function stubbed(engine: 'postgres' | 'mysql', answer: (text: string) => Record<string, unknown>[]): Kysely<never> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>(query: CompiledQuery): Promise<QueryResult<R>> => ({ rows: answer(query.sql) as R[] }),
    // eslint-disable-next-line require-yield
    streamQuery: async function* () {
      throw new Error('not streamed');
    },
  };
  const driver: Driver = {
    init: async () => undefined,
    acquireConnection: async () => connection,
    beginTransaction: async () => undefined,
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
    releaseConnection: async () => undefined,
    destroy: async () => undefined,
  };
  const dialect: Dialect =
    engine === 'postgres'
      ? { createAdapter: () => new PostgresAdapter(), createDriver: () => driver, createQueryCompiler: () => new PostgresQueryCompiler(), createIntrospector: (k) => new PostgresIntrospector(k) }
      : { createAdapter: () => new MysqlAdapter(), createDriver: () => driver, createQueryCompiler: () => new MysqlQueryCompiler(), createIntrospector: (k) => new MysqlIntrospector(k) };
  return new Kysely<never>({ dialect });
}

describe('a database of 5,000 tables', () => {
  const TABLES = 5000;

  it('is measured on Postgres in under 200 ms, reading no table', async () => {
    const scans: string[] = [];
    const tables = Array.from({ length: TABLES }, (_, i) => ({
      id: String(16384 + i),
      name: `public.t${String(i)}`,
      table: 16_384,
      indexes: 16_384,
      live: 3,
      dead: 0,
      inserted: 3,
      updated: 0,
      deleted: 0,
      toast_chunks: 0,
      columns: JSON.stringify(Array.from({ length: 30 }, (_, c) => `c${String(c)}`)),
      index_list: JSON.stringify([{ bytes: 16_384, btree: true, keys: ['c0'] }]),
    }));
    const db = stubbed('postgres', (text) => {
      if (/size-cap:tables/.test(text)) return tables;
      if (/size-cap:large-objects/.test(text)) return [{ bytes: 0 }];
      if (/^\s*select/i.test(text)) scans.push(text);
      return [];
    });
    const started = performance.now();
    expect(await measurePostgres(db)).toBe(TABLES * 32_768);
    expect(performance.now() - started).toBeLessThan(200);
    expect(scans).toEqual([]);
  });

  it('is measured on MySQL in under 200 ms, reading no table', async () => {
    const scans: string[] = [];
    const tables = Array.from({ length: TABLES }, (_, i) => ({ name: `t${String(i)}`, rows: 3, data: 16_384, indexes: 16_384, updated: null }));
    const columns = Array.from({ length: TABLES * 30 }, (_, i) => ({ tableName: `t${String(Math.floor(i / 30))}`, columnName: `c${String(i % 30)}` }));
    const db = stubbed('mysql', (text) => {
      if (/size-cap:tables/.test(text)) return tables;
      if (/size-cap:columns/.test(text)) return columns;
      if (/^\s*select/i.test(text)) scans.push(text);
      return [];
    });
    const started = performance.now();
    expect(await measureMysql(db)).toBe(TABLES * 32_768);
    expect(performance.now() - started).toBeLessThan(200);
    expect(scans).toEqual([]);
  });
});
