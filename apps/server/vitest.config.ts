// SPDX-License-Identifier: AGPL-3.0-only
import { coverage } from '@adminium/config/vitest';
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
    // Headroom below the local reading on purpose: 13 live-DB tests are skipped locally, so the local
    // number is not the one CI measures. adapter-mysql proved that gap can go
    // DOWN as well as up. Tighten from a green CI run.
    coverage: coverage({ statements: 88, branches: 79 }),
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
