/**
 * Connection-pooler fallback (`src/index.ts`).
 *
 * 05 §4.1's session settings are sent in the startup packet because that costs
 * no round trips and cannot race the pool's hand-off. A transaction-pooling
 * proxy refuses that packet outright — and the connection string Neon shows you
 * first is exactly such a proxy, so the refusal made Adminium unable to read a
 * Neon database at all:
 *
 *   postgres query failed: unsupported startup parameter in options:
 *   statement_timeout. Please use unpooled connection or remove this parameter
 *   from the startup package.
 *
 * The fallback moves the same settings into a `SET LOCAL` prelude carried on
 * each query. What has to be true for that to be a real substitute — and not
 * just an error that stops appearing — is that the limits are STILL ENFORCED.
 * The live cases below prove that against a real server rather than asserting
 * the SQL string looks right.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSessionSettings, isPoolerStartupRejection } from '../src/index.js';
import { createTestDatabase, dropTestDatabase, dsnFor, pgDriverAvailable, psqlAvailable } from './harness.js';

const driverReady = psqlAvailable && (await pgDriverAvailable());

describe('isPoolerStartupRejection', () => {
  it('recognises Neon’s refusal verbatim', () => {
    expect(
      isPoolerStartupRejection(
        new Error(
          'unsupported startup parameter in options: statement_timeout. Please use unpooled connection or remove this parameter from the startup package.',
        ),
      ),
    ).toBe(true);
  });

  it('recognises pgbouncer’s wording too', () => {
    expect(isPoolerStartupRejection(new Error('unsupported startup parameter: options'))).toBe(true);
  });

  it('finds it through a wrapped cause', () => {
    const wrapped = new Error('postgres query failed', {
      cause: new Error('unsupported startup parameter: options'),
    });
    expect(isPoolerStartupRejection(wrapped)).toBe(true);
  });

  it('does not fire on unrelated failures', () => {
    // A downgrade triggered by the wrong error would silently drop the
    // startup-packet fast path for everyone.
    expect(isPoolerStartupRejection(new Error('password authentication failed'))).toBe(false);
    expect(isPoolerStartupRejection(new Error('role "u" does not exist'))).toBe(false);
    expect(isPoolerStartupRejection(undefined)).toBe(false);
    expect(isPoolerStartupRejection(null)).toBe(false);
  });

  it('terminates on a self-referencing cause chain', () => {
    const loop = new Error('a') as Error & { cause?: unknown };
    loop.cause = loop;
    expect(isPoolerStartupRejection(loop)).toBe(false);
  });
});

describe('buildSessionSettings — the two shapes cannot drift', () => {
  it('carries the same keys in both forms', () => {
    const { startupOptions, prelude } = buildSessionSettings(15_000, true);
    for (const key of ['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout']) {
      expect(startupOptions).toContain(key);
      expect(prelude).toContain(key);
    }
  });

  it('limits the data role to the statement timeout', () => {
    const { startupOptions, prelude } = buildSessionSettings(15_000, false);
    expect(startupOptions).toBe('-c statement_timeout=15000');
    expect(prelude).toBe("SET LOCAL statement_timeout = '15000';");
  });

  it('quotes prelude values — `2s` is not a bare SET token', () => {
    expect(buildSessionSettings(15_000, true).prelude).toContain("lock_timeout = '2s'");
  });
});

// ── the part that matters: does the prelude actually enforce anything? ────────

describe.skipIf(!driverReady)('the SET LOCAL prelude against a real server', () => {
  let pg: typeof import('pg').default;
  let db = '';
  let pool: import('pg').Pool;

  beforeAll(async () => {
    pg = (await import('pg')).default;
    db = await createTestDatabase(false);
    // No `options` — this pool stands in for the post-downgrade one.
    pool = new pg.Pool({ connectionString: dsnFor(db), max: 2 });
  });

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    if (db !== '') await dropTestDatabase(db);
  });

  it('enforces the statement timeout it sets', async () => {
    // The whole point. A prelude that parsed but did not apply would leave
    // every introspection query unbounded on exactly the hosted databases
    // most likely to be slow.
    const { prelude } = buildSessionSettings(60, false);
    await expect(pool.query(`${prelude} SELECT pg_sleep(2);`)).rejects.toThrow(
      /statement timeout|canceling statement/i,
    );
  });

  it('returns the final statement’s rows, not the SET’s', async () => {
    // `#run` reads `result.at(-1)`; if that were `result.rows` the caller would
    // silently get [] for every catalog query and introspection would report an
    // empty database rather than fail.
    const { prelude } = buildSessionSettings(15_000, false);
    const result = await pool.query(`${prelude} SELECT 42 AS answer;`);
    const rows = Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows;
    expect(rows).toEqual([{ answer: 42 }]);
  });

  it('scopes the setting to the batch — nothing leaks to the next query', async () => {
    // This is why it is SET LOCAL: under transaction pooling the backend is
    // handed to somebody else afterwards, and a leaked 60ms statement_timeout
    // would break their session instead of ours.
    await pool.query(`${buildSessionSettings(60, false).prelude} SELECT 1;`);
    const after = await pool.query('SHOW statement_timeout;');
    const rows = Array.isArray(after) ? (after.at(-1)?.rows ?? []) : after.rows;
    expect((rows[0] as { statement_timeout: string }).statement_timeout).not.toBe('60ms');
  });

  it('applies the introspect role’s extra guards too', async () => {
    const { prelude } = buildSessionSettings(15_000, true);
    const result = await pool.query(`${prelude} SHOW lock_timeout;`);
    const rows = Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows;
    expect((rows[0] as { lock_timeout: string }).lock_timeout).toBe('2s');
  });
});
