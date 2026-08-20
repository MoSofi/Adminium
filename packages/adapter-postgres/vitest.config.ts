// SPDX-License-Identifier: AGPL-3.0-only
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

/**
 * The `*.live.test.ts` suites create and drop a throwaway Postgres database in
 * beforeAll/afterAll. Under `turbo run test` these run in parallel with the
 * server's own live-PG suites against one shared server, so on a cold-cache run
 * the teardown `dropTestDatabase` (default 10s) can flake with "Hook timed out"
 * while connections drain. The work is fast in isolation (<2s); raising only the
 * hook/test timeouts gives headroom under contention without touching any assertion.
 */
export default defineConfig({
  test: {
    ...workers(),
    /**
     * Measured in BOTH modes, because the live suites are probe-gated and the
     * previous floor was set blind to that (15-quality.md §1 asks 90/85):
     *
     *   psql reachable (as in CI)   99.82% statements / 98.86% branches
     *   psql absent (bare laptop)   99.82% statements / 98.42% branches
     *
     * The floor is the rounded-down MINIMUM of the two, so `pnpm test` is green
     * with or without a local Postgres. That is now possible because the
     * offline suites (adapter.offline / introspect.offline / serialization)
     * carry the package on their own — before them the no-server reading was
     * 90.35/90.98 and the live-only reading 92.23/81.71, which is why the old
     * floor sat at 90/79 with deliberate slack.
     *
     * Branches move DOWN as well as up when the live leg runs: it adds 20
     * branches to the denominator (query-engine's pool config paths) that a
     * skipped suite never counts. If CI (postgres:16, vs 18.3 locally) ever
     * lands under this, re-tighten from the green CI run rather than a laptop.
     */
    // MARGIN, NOT A HIGH SCORE. This floor sits ~1-2 points under the measured
    // value rather than rounded down from it. v8's branch TOTAL is not stable
    // run to run — adapter-sqlite measured the same suite reporting 582 then
    // 584 total branches on consecutive runs, ~0.3 of a point — so a floor a
    // quarter-point under the measurement is decided by noise, not coverage.
    // Every number here still clears 15-quality.md §1 with room.
    coverage: coverage({ statements: 98, branches: 97 }),
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
