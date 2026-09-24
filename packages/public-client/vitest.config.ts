// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Coverage floors for `@adminium/public-client`.
 *
 * `max(plan floor, measured rounded DOWN)` per axis, the convention this repo
 * already uses: green on arrival, and a ratchet that only moves up. Rounding
 * down is not cosmetic — v8 totals are not bit-stable between identical runs
 * (~0.03pt), which whole percents absorb.
 *
 * Measured 2026-08-20: statements 89.6, branches 81.33, functions 84.21.
 * The uncovered branches are the `?? undefined` fallbacks around optional
 * request options and the `supportedValuesOf`-absent path in
 * `isCanonicalTimeZone`, which needs a runtime this suite does not have.
 *
 * The `functions` floor was INERT from the day it was written until 2026-09-04:
 * the shared helper destructured only `statements`/`branches`, so 84 never
 * reached vitest. This is the only package in the monorepo that passes one, so
 * it was also the only one that could notice. Re-measured on the day it went
 * live: statements 90.18, branches 81.48, functions 85 (17/20) — ratcheted to
 * 85 per the convention above, which is the first time that axis has held
 * anything.
 *
 * 85 and the old 84 are the same gate *today* — 20 functions means the only
 * reachable values are multiples of 5, so both accept 17/20 and both reject
 * 16/20. They stop being the same the moment the denominator moves, which is
 * the case the ratchet is written for.
 *
 * Re-measured 2026-09-24, with the human check, the emailed code and booking
 * availability in: statements 99.47, branches 91.18, functions 100 (55/55) —
 * ratcheted to 99 / 91 / 100.
 */
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    ...workers(),
    coverage: coverage({ statements: 99, branches: 91, functions: 100 }),
  },
});
