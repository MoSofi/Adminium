// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Coverage floors only — this package had no vitest config, so it ran on
 * defaults and was measured by nothing (15-quality.md §1, task 15-T01).
 *
 * The numbers are `max(plan floor, measured rounded DOWN)` per axis: green on
 * arrival, and a ratchet that only moves up. Rounding down is not cosmetic —
 * v8 totals are not bit-stable between identical runs (~0.03pt), which whole
 * percents absorb.
 */
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    ...workers(),
    coverage: coverage({ statements: 90, branches: 85 }),
  },
});
