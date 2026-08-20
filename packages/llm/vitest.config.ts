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
 * Nothing here touches a database, a clock or a network, so unlike the
 * dialect-parameterized packages the local reading IS the CI reading; there is
 * no measurement gap to leave headroom for. 15-quality.md §1 requires 90/85.
 */
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // MARGIN, NOT A HIGH SCORE. This floor sits ~1-2 points under the measured
    // value rather than rounded down from it. v8's branch TOTAL is not stable
    // run to run — adapter-sqlite measured the same suite reporting 582 then
    // 584 total branches on consecutive runs, ~0.3 of a point — so a floor a
    // quarter-point under the measurement is decided by noise, not coverage.
    // Every number here still clears 15-quality.md §1 with room.
  test: {
    ...workers(),
    coverage: coverage({ statements: 94, branches: 86 }),
  },
});
