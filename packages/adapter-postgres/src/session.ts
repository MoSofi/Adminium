// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Session rails shared by the two pools this package opens.
 *
 * Both the `PostgresAdapter` pool (catalog + statistics) and the
 * `createQueryEngine` pool (CRUD row reads) have to apply the same limits, spot
 * the same connection-pooler refusal, and resolve an `options=` in the DSN the
 * same way. They live here rather than in `index.ts` so `query-engine.ts` can
 * reach them without importing its own importer.
 */

import pg from 'pg';

/** `pg`'s OID for `date`. */
const PG_DATE_OID = 1082;

/**
 * The `types` both pools read values with: a `date` as the `YYYY-MM-DD` text
 * Postgres sends, everything else as `pg` reads it.
 *
 * A `date` is a calendar day with no clock. `pg` made it a Date at this
 * process's local midnight, so its ISO spelling named the day before on a
 * server east of UTC (`2026-08-14` read as `2026-08-13T22:00:00.000Z` in
 * Berlin), and a day it compared or printed moved with the server's zone. As
 * text it reads the same on every server and every engine: SQLite and MySQL
 * hand a date back the same way. Scoped to the pools, never `pg.types`'s
 * process-wide parser, which other code in the process shares.
 */
export const DATES_AS_TEXT: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === PG_DATE_OID && format !== 'binary' ? (value: string) => value : pg.types.getTypeParser(oid, format)) as pg.CustomTypesConfig['getTypeParser'],
};

/**
 * A connection pooler refusing the startup `options` packet.
 *
 * Neon (the pooled `…-pooler.…neon.tech` host its dashboard hands you by
 * default) answers `unsupported startup parameter in options: statement_timeout`;
 * pgbouncer in transaction mode says `unsupported startup parameter: options`.
 * Matching the shared prefix covers both without pinning either vendor's exact
 * wording, and the check is deliberately on the MESSAGE — the SQLSTATE varies
 * between poolers, and Neon reports this as a plain connection failure.
 */
const POOLER_REJECTS_STARTUP_OPTIONS = /unsupported startup parameter/i;

/** Does `error` (or anything it wraps) carry the pooler's refusal? */
export function isPoolerStartupRejection(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && POOLER_REJECTS_STARTUP_OPTIONS.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The session settings, in both shapes: the startup-packet form (zero round
 * trips, preferred) and the `SET LOCAL` prelude used when a pooler refuses
 * it. They are built together so the two can never drift into enforcing
 * different limits.
 */
export function buildSessionSettings(
  statementTimeoutMs: number,
  introspect: boolean,
): { startupOptions: string; prelude: string } {
  const pairs: [string, string][] = [['statement_timeout', String(statementTimeoutMs)]];
  if (introspect) {
    pairs.push(['lock_timeout', '2s'], ['idle_in_transaction_session_timeout', '10s']);
  }
  return {
    startupOptions: pairs.map(([k, v]) => `-c ${k}=${v}`).join(' '),
    // Quoted values: `2s` is not a valid bare token for SET, unlike in `-c`.
    prelude: pairs.map(([k, v]) => `SET LOCAL ${k} = '${v}';`).join(' '),
  };
}

/**
 * Pull an `options=` parameter out of a DSN so it cannot silently outrank the
 * session settings we add to it.
 *
 * `pg` resolves its connection parameters as `Object.assign({}, config, parse(
 * connectionString))` — the DSN wins. So passing `options` alongside a
 * connection string that carries its own means OURS are the ones dropped, on
 * every connection, with no error and nothing in the log: `statement_timeout`
 * and `lock_timeout` simply never apply. Splitting the two here makes the
 * precedence ours to decide (see {@link PostgresAdapter.#buildPool}) instead
 * of `pg`'s.
 *
 * The DSN is only rewritten when there is something to remove, so an ordinary
 * connection string is passed through byte-for-byte. One that `URL` cannot
 * parse — the `host=… port=…` keyword form — is left alone: nothing to collide.
 */
export function splitDsnOptions(dsn: string): { dsn: string; options: string | null } {
  if (!dsn.includes('options')) return { dsn, options: null };
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return { dsn, options: null };
  }
  const options = url.searchParams.get('options');
  if (options === null) return { dsn, options: null };
  url.searchParams.delete('options');
  return { dsn: url.toString(), options };
}
