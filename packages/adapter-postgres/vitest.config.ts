// SPDX-License-Identifier: AGPL-3.0-only
import { coverage } from '@adminium/config/vitest';
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
    coverage: coverage({ statements: 92, branches: 81 }),
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
