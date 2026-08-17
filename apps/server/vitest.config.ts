// SPDX-License-Identifier: AGPL-3.0-only
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
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
