// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Coverage floors only — this package had no vitest config, so it ran on
 * defaults and was measured by nothing (15-quality.md §1, task 15-T01).
 *
 * The numbers are `max(plan floor, measured rounded DOWN)` per axis: green on
 * arrival, and a ratchet that only moves up. Rounding down is not cosmetic —
 * v8 totals are not bit-stable between identical runs (~0.03pt), which whole
 * percents absorb.
 *
 * ── Why the statement floor jumped 66 → 99 ──────────────────────────────────
 *
 * The old 66 was not this package's coverage; it was an artefact of measuring
 * `src/testing/index.ts` — the conformance suites, the package's own product —
 * at a permanent 0%, because nothing in this repo ever ran them. That inverted
 * the gate. `ab6314e` added two conformance cases and DROPPED the measured
 * number from 70% to 65.85%, breaking the build: writing more of the thing the
 * package exists to ship made the package look worse, and the only move that
 * raised the number was to ship less.
 *
 * The fix was to run the suites (`test/conformance.test.ts`) against reference
 * implementations rather than to exempt them. An `exclude` glob would have made
 * the number go up while leaving the suites exactly as unexecuted as before —
 * and the shared helper's `exclude` option still has no users anywhere in the
 * monorepo, which is the right state for it. Excluding is for code vitest
 * CANNOT run (stories, generated catalogues); this is code it can.
 *
 * 99, not 100: one statement is `expect.unreachable()` inside a conformance
 * case, which by construction never executes while an implementation conforms.
 *
 * The branch floor stays at 88 even though the denominator changed underneath
 * it (18 branches → 69, since an unexecuted file reports none). The eight it
 * still misses are the suites' own FAILURE arms — `parsed.error?.issues` when a
 * schema check passed, the `expect.unreachable` guard — reachable only from a
 * deliberately non-conforming implementation, which is a fixture that would
 * make a passing run assert nothing.
 */
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    ...workers(),
    coverage: coverage({ statements: 99, branches: 88 }),
  },
});
