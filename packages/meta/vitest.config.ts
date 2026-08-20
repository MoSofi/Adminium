// SPDX-License-Identifier: AGPL-3.0-only
import { coverage, workers } from '@adminium/config/vitest';
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
    ...workers(),
    /**
     * Floors are the WEAKEST configuration's reading, rounded down.
     *
     * The gap this leaves used to be guesswork — the local run skips the pg and
     * mysql legs, so nobody had measured which direction the CI number moves.
     * It has now been measured on both sides:
     *
     *   sqlite only        94.37 statements / 91.59 branches   ← the floor
     *   sqlite + postgres  95.22 statements / 92.24 branches
     *
     * Adding a live dialect RAISES both axes (a leg reveals more branches, but
     * it covers more of them than it reveals), so the sqlite-only reading is
     * the low-water mark and every richer configuration clears it. Only the
     * mysql leg is still unmeasured here; tighten from a green CI run if it
     * proves to add margin too.
     *
     * 15-quality.md §1 requires 90/85 for this package.
     */
    // MARGIN, NOT A HIGH SCORE. This floor sits ~1-2 points under the measured
    // value rather than rounded down from it. v8's branch TOTAL is not stable
    // run to run — adapter-sqlite measured the same suite reporting 582 then
    // 584 total branches on consecutive runs, ~0.3 of a point — so a floor a
    // quarter-point under the measurement is decided by noise, not coverage.
    // Every number here still clears 15-quality.md §1 with room.
    coverage: coverage({ statements: 93, branches: 90 }),
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
