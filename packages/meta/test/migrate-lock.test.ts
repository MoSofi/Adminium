// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Migration-lock suite (07-meta-store.md §4).
 *
 * Every assertion here needs TWO handles on the SAME meta store, which the
 * shared harness deliberately cannot give: `dialect.make()` provisions a fresh
 * `adminium_test_meta_<rand>` database per call so vitest workers do not race,
 * and its SQLite leg is `:memory:`, which no second connection can ever see.
 * So this file builds the pair itself — the server DSN re-pointed with
 * `urlWithDatabase()` at the database the first handle reports, and for SQLite
 * a real temp FILE opened twice.
 *
 * The SQLite pair opens with a short `timeout`: better-sqlite3 is synchronous,
 * so its default 5s busy-wait would block this process's event loop — and both
 * "processes" live in this one. Separate containers, the case the lock is for,
 * do not share an event loop.
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_MIGRATIONS,
  MigrationLockTimeoutError,
  applyMigrations,
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  initMetaDb,
  postgresInt8AsNumber,
  withMigrationLock,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, postgresAdminUrl, testDatabaseName, urlWithDatabase } from './helpers/db.js';

/** Two independent handles on one meta store, plus their teardown. */
interface Pair {
  a: MetaDb;
  b: MetaDb;
  destroy: () => Promise<void>;
}

async function sqlitePair(): Promise<Pair> {
  const dir = mkdtempSync(join(tmpdir(), 'adminium-meta-lock-'));
  const file = join(dir, `${randomBytes(4).toString('hex')}.sqlite`);
  const { default: BetterSqlite3 } = await import('better-sqlite3');
  const open = async (): Promise<MetaDb> => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(file, { timeout: 100 }) });
    await initMetaDb(meta);
    return meta;
  };
  const a = await open();
  const b = await open();
  return {
    a,
    b,
    destroy: async () => {
      await a.db.destroy();
      await b.db.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function postgresPair(): Promise<Pair> {
  const base = process.env.TEST_POSTGRES_URL as string;
  const { default: pg } = await import('pg');
  const database = testDatabaseName();
  const admin = new pg.Client({ connectionString: postgresAdminUrl(base) });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  const open = (): MetaDb =>
    createPostgresMetaDb({
      pool: new pg.Pool({
        connectionString: urlWithDatabase(base, database),
        max: 2,
        types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>),
      }),
    });
  const a = open();
  const b = open();
  return {
    a,
    b,
    destroy: async () => {
      await a.db.destroy();
      await b.db.destroy();
      const drop = new pg.Client({ connectionString: postgresAdminUrl(base) });
      await drop.connect();
      await drop.query(`DROP DATABASE IF EXISTS "${database}"`);
      await drop.end();
    },
  };
}

async function mysqlPair(): Promise<Pair> {
  const base = process.env.TEST_MYSQL_URL as string;
  const mysql = await import('mysql2/promise');
  const { createPool } = await import('mysql2');
  const database = testDatabaseName();
  const admin = await mysql.createConnection({ uri: base });
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.end();

  const open = (): MetaDb =>
    createMysqlMetaDb({
      pool: createPool({ uri: urlWithDatabase(base, database), connectionLimit: 2 }),
    });
  const a = open();
  const b = open();
  return {
    a,
    b,
    destroy: async () => {
      await a.db.destroy();
      await b.db.destroy();
      const drop = await mysql.createConnection({ uri: base });
      await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await drop.end();
    },
  };
}

const PAIRS: Record<string, () => Promise<Pair>> = {
  sqlite: sqlitePair,
  postgres: postgresPair,
  mysql: mysqlPair,
};

/** A promise the test resolves by hand — holds a lock open across an assertion. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`migration lock [${dialect.name}]`, () => {
    let pair: Pair | undefined;

    afterEach(async () => {
      await pair?.destroy();
      pair = undefined;
    });

    const makePair = async (): Promise<Pair> => {
      pair = await (PAIRS[dialect.name] as () => Promise<Pair>)();
      return pair;
    };

    it('runs the body on a pinned handle and reports whether it opened a transaction', async () => {
      const { a } = await makePair();
      const seen = await withMigrationLock(a.db, { dialect: a.dialect }, async (locked, ctx) => {
        expect(locked).toBeDefined();
        return ctx.inTransaction;
      });
      // Only SQLite's lock IS a transaction (BEGIN IMMEDIATE).
      expect(seen).toBe(dialect.name === 'sqlite');
    });

    it('blocks a second holder while the first is inside, and warns that it is waiting', async () => {
      const { a, b } = await makePair();
      const held = deferred();
      const onWait = vi.fn();

      const first = withMigrationLock(a.db, { dialect: a.dialect }, async () => {
        await held.promise;
        return 'first';
      });
      // Give the first holder a turn to actually take the lock.
      await sleep(50);

      await expect(
        withMigrationLock(b.db, { dialect: b.dialect, timeoutMs: 300, onWait }, async () => 'second'),
      ).rejects.toBeInstanceOf(MigrationLockTimeoutError);
      expect(onWait).toHaveBeenCalledTimes(1);
      expect(onWait.mock.calls[0]?.[0]).toMatchObject({ dialect: dialect.name, timeoutMs: 300 });

      held.resolve();
      await expect(first).resolves.toBe('first');

      // …and the lock is free again the moment the first holder returns.
      await expect(
        withMigrationLock(b.db, { dialect: b.dialect, timeoutMs: 2_000 }, async () => 'now free'),
      ).resolves.toBe('now free');
    });

    it('releases the lock when the body throws', async () => {
      const { a, b } = await makePair();
      await expect(
        withMigrationLock(a.db, { dialect: a.dialect }, async () => {
          throw new Error('migration blew up');
        }),
      ).rejects.toThrow('migration blew up');

      await expect(
        withMigrationLock(b.db, { dialect: b.dialect, timeoutMs: 2_000 }, async () => 'free'),
      ).resolves.toBe('free');
    });

    it('serializes two processes booting into the same pending set', async () => {
      const { a, b } = await makePair();
      const [first, second] = await Promise.all([
        applyMigrations(a.db, { dialect: a.dialect, lock: { timeoutMs: 60_000 } }),
        applyMigrations(b.db, { dialect: b.dialect, lock: { timeoutMs: 60_000 } }),
      ]);

      // Whoever wins applies everything; the loser reads a complete ledger and
      // applies nothing. What must never happen is both entering one migration.
      const all = [...first.applied, ...second.applied];
      expect(new Set(all).size).toBe(all.length);
      expect(all.sort()).toEqual(ALL_MIGRATIONS.map((m) => m.name).sort());

      const rows = await a.db.selectFrom('adminium_migrations').select('name').execute();
      expect(rows).toHaveLength(ALL_MIGRATIONS.length);
    });

    it('still applies migrations when locking is switched off', async () => {
      const { a } = await makePair();
      const { applied } = await applyMigrations(a.db, { dialect: a.dialect, lock: false });
      expect(applied).toEqual(ALL_MIGRATIONS.map((m) => m.name));
    });
  });
}
