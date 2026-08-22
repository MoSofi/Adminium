# @adminium/config

## 0.2.2

### Patch Changes

- Stop every vitest suite claiming the whole machine while the others do the same.
  
  `turbo run test` runs these suites concurrently and each one sizes its worker
  pool to the full CPU count. Measured on an 8-core box during a single
  `pnpm turbo run test --force`: up to **49 vitest processes alive at once**,
  commonly 26–34. Eighteen packages have a vitest `test` script and turbo's default
  concurrency is 10, so several full-size pools run at the same time and every one
  of them believes it has the machine to itself.
  
  The cost is not only speed. `apps/dashboard/src/test/setup.ts` already records
  renders measured at ~380ms standalone taking ~3,400ms under this load — the
  reason its `asyncUtilTimeout` was raised 1,000 → 5,000ms — and CI still lost a
  `verify` run to a lazily-mounted screen missing even that raised budget
  (`studioPages.test.tsx`, run 32377319647, green on a no-change re-run of the same
  tree). Raising a timeout again to outrun the scheduler makes the gate slower
  without making it truer, so the scheduler is what changed.
  
  `workers()` in `@adminium/config/vitest` sets `maxWorkers` to a **percentage**,
  applied in all 18 configs. Percentage rather than a count so the cap follows the
  machine — a hosted 4-core runner and a dev laptop should not need different
  commits. `maxWorkers` rather than `poolOptions.{forks,threads}.max*` because it
  is pool-agnostic; vitest's default pool (`forks`) is deliberately left alone.
  
  Measured at three settings, full suite, same machine:
  
  | share | wall clock | peak vitest processes |
  | 
   | 
   | 
   |
  | 100% (previous behaviour) | 151s | 49 |
  | **50% (new default)** | **139s** | **28** |
  | 25% | 153s | — |
  
  So the cap is not a speed-for-determinism trade at this size: less thrash made it
  slightly faster. `ADMINIUM_TEST_WORKERS` overrides the default and is already
  inside turbo's `env` allowlist for the test task, so changing it busts the cache
  correctly.
  
  What this does NOT claim: that the CI flake is fixed. The failure is rare, lives
  on a runner with a different core count, and one green run proves nothing. The
  mechanism it is blamed on is measurably reduced; whether that is enough is
  something only repeated CI runs can say, and the override is there to tune it
  without a commit.

## 0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

## 0.1.0
