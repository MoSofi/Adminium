// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The engine giving a write up in a lock race, on demand: the next statement
 * that matches a pattern fails as each driver fails one (Postgres 40P01,
 * MySQL 1213, SQLite SQLITE_BUSY), once. For the tests of how each door tells
 * a lost race: a moment's wait, never a refusal.
 */
import { createRequire } from 'node:module';

import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { vi } from 'vitest';

const prepare = BetterSqlite3.prototype.prepare;
const pgQuery = pg.Client.prototype.query;
/** The prototype the MySQL adapter's connections take `query` from (its own copy of mysql2). */
const mysql = createRequire(new URL('../../../packages/adapter-mysql/package.json', import.meta.url))('mysql2') as { Connection: { prototype: object } };
const mysqlBase = Object.getPrototypeOf(mysql.Connection.prototype) as { query: (...args: unknown[]) => unknown };
const mysqlQuery = mysqlBase.query;

/** The engine giving this write up in a lock race, once, at the statement that matches `pattern`. */
export function loseRaceAt(dialect: string, pattern: RegExp): () => void {
  let fired = false;
  const hit = (sql: unknown) => !fired && typeof sql === 'string' && pattern.test(sql) && (fired = true);
  if (dialect === 'sqlite') {
    const spy = vi.spyOn(BetterSqlite3.prototype, 'prepare').mockImplementation(function (this: BetterSqlite3.Database, source: string) {
      if (hit(source)) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      return prepare.call(this, source);
    } as never);
    return () => spy.mockRestore();
  }
  if (dialect === 'postgres') {
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: unknown } | undefined)?.text;
      if (hit(sql)) return Promise.reject(Object.assign(new Error('deadlock detected'), { code: '40P01' }));
      return (pgQuery as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    return () => spy.mockRestore();
  }
  const spy = vi.spyOn(mysqlBase, 'query').mockImplementation(function (this: unknown, ...args: unknown[]) {
    const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { sql?: unknown } | undefined)?.sql;
    const done = args.find((arg) => typeof arg === 'function') as ((error: unknown) => void) | undefined;
    if (hit(sql) && done !== undefined) {
      process.nextTick(() => done(Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 })));
      return undefined;
    }
    return mysqlQuery.apply(this, args);
  });
  return () => spy.mockRestore();
}
