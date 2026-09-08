// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A kysely `Dialect` wrapper that records every SQL string the CRUD path
 * actually sends, so a test can assert on the EMITTED query rather than on
 * the rows that came back.
 *
 * Two tests need this and both are about SQL that must not change:
 * 36-derived-columns.md 36-T12 (a read carrying no `compute=` emits
 * byte-identical SQL to the pre-wave build) and 36-T07 (the golden fold
 * fragment is parenthesized — the defect being guarded is kysely's
 * `eb(ref, op, ref)` dropping parentheses and binding a reference as a
 * parameter, which produces a wrong NUMBER, not a wrong query shape).
 *
 * There is no `log` hook to use instead: the server builds its Kysely
 * instance inside `ConnectionManager` from whatever dialect the adapter
 * provider hands over, and that seam is exactly here.
 */

import type {
  DatabaseConnection,
  Dialect,
  Driver,
  Kysely,
  QueryResult,
  TransactionSettings,
} from 'kysely';
import type { CompiledQuery } from 'kysely';

export interface SqlSink {
  queries: string[];
}

export function createSqlSink(): SqlSink {
  return { queries: [] };
}

/** Wrap a dialect so every executed statement lands in `sink.queries`. */
export function recordingDialect(inner: Dialect, sink: SqlSink): Dialect {
  return {
    createAdapter: () => inner.createAdapter(),
    // `any` mirrors kysely's own Dialect signature; `never` does not satisfy it.
    createIntrospector: (db: Kysely<any>) => inner.createIntrospector(db),
    createQueryCompiler: () => inner.createQueryCompiler(),
    createDriver: () => recordingDriver(inner.createDriver(), sink),
  };
}

function recordingDriver(driver: Driver, sink: SqlSink): Driver {
  // The pool hands the WRAPPED connection back to `releaseConnection`, so the
  // inner one has to be recoverable from it.
  const inners = new WeakMap<DatabaseConnection, DatabaseConnection>();
  return {
    init: () => driver.init(),
    acquireConnection: async (): Promise<DatabaseConnection> => {
      const connection = await driver.acquireConnection();
      const wrapper: DatabaseConnection = {
        executeQuery: async <R>(compiled: CompiledQuery): Promise<QueryResult<R>> => {
          sink.queries.push(compiled.sql);
          return connection.executeQuery<R>(compiled);
        },
        streamQuery: <R>(compiled: CompiledQuery, chunkSize: number) => {
          sink.queries.push(compiled.sql);
          return connection.streamQuery<R>(compiled, chunkSize);
        },
      };
      inners.set(wrapper, connection);
      return wrapper;
    },
    beginTransaction: (connection: DatabaseConnection, settings: TransactionSettings) =>
      driver.beginTransaction(inners.get(connection) ?? connection, settings),
    commitTransaction: (connection: DatabaseConnection) =>
      driver.commitTransaction(inners.get(connection) ?? connection),
    rollbackTransaction: (connection: DatabaseConnection) =>
      driver.rollbackTransaction(inners.get(connection) ?? connection),
    releaseConnection: (connection: DatabaseConnection) =>
      driver.releaseConnection(inners.get(connection) ?? connection),
    destroy: () => driver.destroy(),
  };
}

/** The last statement that reads `table` — the list SELECT, not its COUNT twin. */
export function lastSelectFrom(sink: SqlSink, table: string): string {
  const quoted = table
    .split('.')
    .map((part) => `"${part}"`)
    .join('.');
  const matches = sink.queries.filter(
    (sql) => sql.startsWith('select') && sql.includes(`from ${quoted}`) && !sql.startsWith('select count'),
  );
  const last = matches.at(-1);
  if (last === undefined) {
    throw new Error(`no select from "${table}" recorded; saw:\n${sink.queries.join('\n')}`);
  }
  return last;
}
