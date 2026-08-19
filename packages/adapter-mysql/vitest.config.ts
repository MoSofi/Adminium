// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Coverage floor — 15-quality.md §1 asks 90% statements / 85% branches.
 *
 * THIS FLOOR IS UNCONDITIONAL, and that is the change. It used to be gated on
 * the same `TEST_MYSQL_URL` the live suite is gated on:
 *
 *     coverage(live ? { statements: 92, branches: 77 } : {})
 *
 * which had two holes. Without the env var there was NO floor at all, so a
 * laptop run enforced nothing; and the live figure it did enforce — 77%
 * branches — was itself below the §1 requirement, so neither mode actually
 * gated on §1.
 *
 * The gate existed because the two modes genuinely disagreed:
 *
 *     without the live DB   66.74% statements / 79.82% branches
 *     with it (CI)          92.07% statements / 77.35% branches
 *
 * Statements moved 25 points UP and branches moved DOWN, which is why a single
 * number looked impossible to write honestly. The cause was not the live DB
 * itself: `index.ts`, `errors.ts` and `query-engine.ts` were imported by
 * NOTHING offline, and v8 reports an unexecuted file as a single placeholder
 * branch. Executing them for the first time replaced that placeholder with
 * their real branches, so the denominator jumped and the percentage fell.
 *
 * Those three modules now have offline suites of their own (errors /
 * query-engine / adapter.offline, driven by a mocked `mysql2`), so the
 * denominator is already in its fully-executed shape and the divergence is
 * gone. Measured here with the live suite SKIPPED:
 *
 *     100% statements (1212/1212) / 96.22% branches (510/530)
 *
 * The floor sits a point below that. The live/CI reading could not be measured
 * on this machine (no MySQL, no Docker), so the margin is deliberate rather
 * than a rounded-down measurement; the postgres adapter, where both modes WERE
 * measurable, gained coverage under the live leg rather than losing it.
 * Tighten to the rounded-down CI number from the first green run.
 */
import { coverage } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: coverage({ statements: 99, branches: 95 }),
  },
});
