// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Coverage floors, gated on the same condition the SUITE is gated on.
 *
 * This package's live suite is skipped unless `TEST_MYSQL_URL` is set, which CI
 * provides and a laptop usually does not. That makes a single fixed floor
 * impossible to write honestly:
 *
 *   without the live DB   66.74% statements / 79.82% branches
 *   with it (CI)          92.07% statements / 77.35% branches
 *
 * Statements move 25 points UP once `src/index.ts`, `errors.ts` and
 * `query-engine.ts` actually execute — and BRANCHES move DOWN, which is the
 * direction nobody predicts and which reddened CI on the first push after a
 * floor was set from a local run.
 *
 * So the floor applies only when the suite that earns it has run. Skipping the
 * live leg is not a coverage failure; it is a different, smaller test run, and
 * failing it would mean nobody could run this package's tests without a MySQL
 * server. When the leg does run, the CI numbers are enforced exactly.
 */
import { coverage } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

const live = process.env.TEST_MYSQL_URL !== undefined && process.env.TEST_MYSQL_URL !== '';

export default defineConfig({
  test: {
    coverage: coverage(live ? { statements: 92, branches: 77 } : {}),
  },
});
