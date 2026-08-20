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
 */
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    ...workers(),
    coverage: coverage({ statements: 89, branches: 81, functions: 84 }),
  },
});
