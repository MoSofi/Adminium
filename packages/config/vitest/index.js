// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared coverage policy — 15-quality.md §1, task 15-T01.
 *
 * `include: ['src/**']` is LOAD-BEARING, not tidiness. vitest's default
 * `coverage.include` is `['**']`, which with `all: true` sweeps node_modules and
 * every workspace `dist/`. Measured: apps/server reports 81.2% that way, over
 * 2,787 files and 248,753 statements — 107,165 of them node_modules and 79,761
 * workspace dist. Scoped to its own src it is 90.54% over 212 files. An unscoped
 * number is not a weaker measurement of the same thing; it is a different metric.
 *
 * An `exclude` list cannot substitute for the allowlist. The default run also
 * MIS-ATTRIBUTES 219 apps/dashboard files into `apps/server/src/...` paths that
 * do not exist on disk (`apps/server/src/account/SecurityPage.tsx`), and no glob
 * can exclude a path that is a fiction.
 *
 * The allowlist also removes a source of NON-DETERMINISM. packages/ui's default
 * measurement counts ~82,000 statements of gitignored `storybook-static/`, which
 * exists in the `vrt` job and on a dev box but not in `verify` — so the same
 * commit measured 4.66% in one job and ~54.64% in another.
 *
 * `all: true` (vitest's default, kept explicit) is the other load-bearing line:
 * it counts src files no test imports. Under `all: false` a module with zero
 * tests is invisible, and DELETING its tests raises the number.
 *
 * `**\/*.stories.*` is excluded for the same reason i18n excludes its generated
 * catalogues: stories are never executed by vitest, so they sit at a permanent
 * 0% and swamp the real signal — 71 story files dragged @adminium/ui from 95.95%
 * to 54.64%. No package carrying a floor has a story file, so this changes no
 * gate; it stops two reported numbers being lies.
 */
import { coverageConfigDefaults } from 'vitest/config';

/**
 * Build a package's coverage block. Omit `statements`/`branches` to collect and
 * report without asserting — which is what 15-quality.md §1 prescribes for
 * `@adminium/ui`, `@adminium/widgets` and `@adminium/charts`, where screenshots
 * and axe are the meaningful signal rather than branch counts.
 */
export function coverage({ statements, branches, exclude = [] } = {}) {
  return {
    provider: 'v8',
    // OFF by default, ON via `--coverage` in each package's `test` script.
    //
    // Not a style preference: thresholds apply to whatever was collected, and a
    // deliberate subset legitimately has low coverage. With `enabled: true` here,
    // `vitest run one.test.ts` reported "12 passed" and then exited NON-ZERO on
    // "Coverage for statements (0.43%) does not meet global threshold (90%)" —
    // so every single-file debugging run looked like a failure. The full-suite
    // path (`pnpm test`, and therefore CI's `turbo run test`) passes `--coverage`
    // and is gated exactly as before.
    enabled: false,
    all: true,
    include: ['src/**'],
    // vitest REPLACES this list rather than merging it — it appends only setup
    // and test-file globs — so the defaults must be spread back in or `**/*.d.ts`
    // and virtual modules start counting. Verified: @adminium/charts reports 83
    // files without the spread (including a .d.ts) against 82 with it.
    exclude: [...coverageConfigDefaults.exclude, '**/*.stories.*', ...exclude],
    // No `html`: it would balloon every package's turbo cache entry.
    // `json-summary` carries per-file percentages, which is what makes a
    // threshold failure diagnosable.
    reporter: ['text-summary', 'json-summary'],
    ...(statements === undefined ? {} : { thresholds: { statements, branches } }),
  };
}

/**
 * Worker cap — `turbo run test` runs these suites CONCURRENTLY, and vitest sizes
 * its pool to the whole machine.
 *
 * Measured on an 8-core box during one `pnpm turbo run test --force`: up to 49
 * vitest processes alive at once, commonly 26–34. Eighteen packages have a
 * vitest `test` script and turbo's default concurrency is 10, so the machine
 * runs several full-size pools at the same time and every one of them believes
 * it has the whole CPU.
 *
 * What that costs is not just speed. `apps/dashboard/src/test/setup.ts` records
 * renders measured at ~380ms standalone taking ~3,400ms under this load, which
 * is why its `asyncUtilTimeout` was already raised 1,000 → 5,000ms — and CI
 * still lost a `verify` run to a lazily-mounted screen missing that raised
 * budget (`studioPages.test.tsx`, run 32377319647, green on a no-change re-run).
 * A timeout raised to outrun the scheduler stops measuring the thing it was
 * written to measure.
 *
 * `maxWorkers` rather than `poolOptions.{forks,threads}.max*`: it is
 * pool-agnostic, and vitest's default pool (`forks`) is deliberately not changed
 * here. A PERCENTAGE rather than a count so the cap follows the machine — CI's
 * runner and a dev laptop do not have the same core count, and a hardcoded 2
 * would be a throttle on one and a no-op on the other.
 */
export function workers(share = '50%') {
  // `ADMINIUM_TEST_WORKERS` is already inside turbo's `env` allowlist for the
  // test task, so overriding it busts the cache the way it should. It exists
  // because the right number is a property of the MACHINE: a 32-core CI box
  // wants a different share than a 4-core hosted runner, and neither should
  // need a commit to say so.
  const override = process.env.ADMINIUM_TEST_WORKERS;
  return { maxWorkers: override === undefined || override === '' ? share : override, minWorkers: 1 };
}
