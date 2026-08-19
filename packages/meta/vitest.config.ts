// SPDX-License-Identifier: AGPL-3.0-only
import { coverage } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

/**
 * The repo tests (bootstrap, migrator, and every repos.* suite) run against a
 * REAL Postgres and MySQL when TEST_POSTGRES_URL / TEST_MYSQL_URL are set (CI's
 * `verify` job provides both). Each test provisions and drops a throwaway
 * database (test/helpers/db.ts), and a full run applies all ten migrations —
 * on CI's MySQL that is 3–11s per test, and a migrator/bootstrap test can take
 * longer. Vitest's 5s default was marginally enough until a slow runner tipped
 * a batch of `[mysql]` tests into "Test timed out in 5000ms".
 *
 * These are the SAME numbers @adminium/adapter-postgres already uses for the
 * same reason; the meta suite simply never carried a config. The sqlite leg is
 * unaffected — it finishes in tens of milliseconds and never approaches these
 * ceilings; they only give the live-DB legs headroom under CI contention,
 * without touching a single assertion.
 */
export default defineConfig({
  test: {
    coverage: coverage({ statements: 93, branches: 84 }),
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
