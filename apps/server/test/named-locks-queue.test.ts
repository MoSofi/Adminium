// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The queue in front of the named locks: writers of the same names wait
 * their turn in this process, first come first served, without taking a
 * connection from the pool — so a burst of writers for one show leaves the
 * pool to everybody else. And a writer waiting for a lock another server
 * holds is told busy after the wait, on every engine.
 *
 * Postgres and MySQL legs gate on TEST_POSTGRES_URL / TEST_MYSQL_URL.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../src/connections/manager.js';
import { queuedTurns, withNamedLocks, type NamedLock } from '../src/crud/capacity/locks.js';

type Db = Kysely<SourceDatabase>;

const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const lock = (name: string): NamedLock => ({ name, busy: 'CAPACITY_BUSY' });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Leg {
  dialect: Dialect;
  available: boolean;
  /** A handle with a pool of `max` connections. */
  open: (max: number) => Promise<Db>;
}

const LEGS: Leg[] = [
  {
    dialect: 'sqlite',
    available: true,
    open: async () => new Kysely<SourceDatabase>({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) }),
  },
  {
    dialect: 'postgres',
    available: POSTGRES_URL !== undefined,
    open: async (max) => {
      const pg = await import('pg');
      return new Kysely<SourceDatabase>({ dialect: new PostgresDialect({ pool: new pg.default.Pool({ connectionString: POSTGRES_URL, max }) }) });
    },
  },
  {
    dialect: 'mysql',
    available: MYSQL_URL !== undefined,
    open: async (max) => {
      const mysql = await import('mysql2');
      return new Kysely<SourceDatabase>({ dialect: new MysqlDialect({ pool: mysql.default.createPool({ uri: MYSQL_URL!, connectionLimit: max }) }) });
    },
  },
];

for (const leg of LEGS) {
  describe.skipIf(!leg.available)(`the named-lock queue on ${leg.dialect}`, () => {
    let db: Db;
    let other: Db;
    const target = () => ({ db, dialect: leg.dialect });
    const unique = `named-locks-queue-${String(process.pid)}-${leg.dialect}`;

    beforeAll(async () => {
      db = await leg.open(2);
      other = await leg.open(2);
    });

    afterAll(async () => {
      await db.destroy();
      await other.destroy();
    });

    it('lets writers of the same names in one at a time, in the order they came', async () => {
      const order: number[] = [];
      const writers = [0, 1, 2, 3, 4].map(async (n) => {
        await pause(n * 5);
        return withNamedLocks(target(), [lock(`${unique}:fifo`)], async () => {
          order.push(n);
          await pause(60);
        });
      });
      await pause(30);
      expect(queuedTurns()).toBe(5);
      await Promise.all(writers);
      expect(order).toEqual([0, 1, 2, 3, 4]);
      expect(queuedTurns()).toBe(0);
    });

    it.skipIf(leg.dialect === 'sqlite')('keeps the pool free for readers while writers of one show wait their turn', async () => {
      // A pool of two: without the queue, two waiting writers would hold both connections.
      const writers = Array.from({ length: 6 }, () =>
        withNamedLocks(target(), [lock(`${unique}:burst`)], async () => {
          await pause(120);
        }),
      );
      await pause(30);
      const started = Date.now();
      await sql`select 1 as one`.execute(db);
      const waited = Date.now() - started;
      await Promise.all(writers);
      expect(waited).toBeLessThan(100);
    });

    it('tells a writer the first name is busy when its turn does not come within the wait', async () => {
      const first = withNamedLocks(target(), [lock(`${unique}:slow`)], async () => pause(1500));
      await pause(20);
      await expect(withNamedLocks(target(), [lock(`${unique}:slow`)], async () => 'ran', { waitSeconds: 0.3 })).rejects.toMatchObject({
        code: 'CAPACITY_BUSY',
      });
      await first;
      // The turn is handed on after a waiter gave up: the next one gets in.
      expect(await withNamedLocks(target(), [lock(`${unique}:slow`)], async () => 'ran')).toBe('ran');
    });

    it.skipIf(leg.dialect === 'sqlite')('tells a writer busy when another server holds the lock past the wait', async () => {
      // Another server: a second handle, holding the lock for longer than the writer waits.
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      const elsewhere = withNamedLocks({ db: other, dialect: leg.dialect }, [lock(`${unique}:far`)], async () => {
        holding();
        await released;
      });
      await held;
      const started = Date.now();
      await expect(
        withNamedLocks(target(), [lock(`${unique}:far`)], async () => 'ran', { waitSeconds: 1 }),
      ).rejects.toMatchObject({ code: 'CAPACITY_BUSY' });
      expect(Date.now() - started).toBeLessThan(5000);
      release();
      await elsewhere;
    });

    it.skipIf(leg.dialect !== 'postgres')('keeps the lock wait to the locks: the rows after them wait as before', async () => {
      const inside = await withNamedLocks(target(), [lock(`${unique}:timeout`)], async (trx) =>
        (await sql<{ was: string }>`select current_setting('lock_timeout') as was`.execute(trx)).rows[0]!.was,
      );
      const outside = (await sql<{ was: string }>`select current_setting('lock_timeout') as was`.execute(db)).rows[0]!.was;
      expect(inside).toBe(outside);
    });
  });
}
