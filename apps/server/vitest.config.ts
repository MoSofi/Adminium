// SPDX-License-Identifier: AGPL-3.0-only
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Several suites here exercise a live Postgres (Northwind) through per-suite
 * beforeAll/afterAll hooks (create test DB, build the app, introspect, drop DB).
 * Under `turbo run test` the whole monorepo runs these live-PG suites in
 * parallel against one shared server, so a cold-cache run can push an individual
 * setup/teardown hook past vitest's 10s default and flake with "Hook timed out".
 * The work itself is fast in isolation (<1s); raising only the hook/test
 * timeouts gives headroom under contention without touching any assertion.
 */
export default defineConfig({
  test: {
    ...workers(),
    // 15-quality.md §1 asks 85 statements / 80 branches. The statements floor
    // keeps its existing 88 ratchet; branches move 79 -> 80 because 79 was the
    // one configured floor in the repo sitting BELOW its §1 number, which is
    // what kept the gate's coverage row unchecked.
    //
    // WHAT IS MEASURED, AND WHAT IS NOT. Re-measured in CI's own `verify`
    // configuration as far as this machine allows — TEST_POSTGRES_URL against a
    // real pg16, PGUSER/PGPASSWORD set, 1477 tests, 7 skipped: 90.54% statements
    // / 81.3% branches, so 80 clears with 1.3 points of margin. What could NOT be
    // reproduced is the MySQL leg (no MySQL, no Docker here), and that leg is
    // precisely why fb8b2ae lowered this floor from 81 to 79 off a CI reading.
    // The denominator is close to fully expanded — 4 of 211 files are unexecuted
    // and all four are entrypoints (index, start, cli/index, rbac/index) that no
    // database leg reaches — so MySQL should add covered branches rather than
    // expand the total, which is the adapter-mysql effect in reverse. That is a
    // reasoned expectation, not a measurement: if `verify` reddens on coverage,
    // this line is the first place to look.
    coverage: coverage({ statements: 88, branches: 80 }),
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
