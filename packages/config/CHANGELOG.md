# @adminium/config

## 0.3.0-rc.0

## 0.2.12

## 0.2.11

## 0.2.10

### Patch Changes

- 86535d5: **Comments stop pointing at documents a reader cannot open.**
  
  - **A new gate**, `pnpm check-private-citations`, in `pnpm preflight` and in CI's `verify` job. It
    reads six forms — a plan document filename, a bare plan number with a section or decision, a
    bare section, a plan or milestone task id, a design comp file, a research annex — and holds
    every file with no baseline entry at zero, so new code cannot add one. A recorded count may
    only shrink, and progress has to be recorded, which is what stops it being given back.
  - **13,115 of 16,293 such references are gone**, across 1,679 of the 2,450 files that had one.
    Where the reference was provenance the sentence now stands on its own; where it was doing the
    work of a subject it was reworded. No behaviour changed: a rewrite is refused unless the file's
    compiled output is byte-identical before and after.
  - **The reasoning lives in public now**, one short page per decision under
    [/anatomy/decisions/](https://docs.adminium.dev/anatomy/decisions/), which is what a comment
    links to instead of carrying a backstory.
  - **A citation of something a reader can open spells the section out** — `AGPL section 13`, not
    the section sign, which is the glyph the gate reads.
  - **Two generated files were regenerated from fixed templates** rather than hand-edited:
    `packages/i18n/src/a11y-keys.ts` and the icon core and name list.
  
  **The strings a person actually reads went with them**: the two "not in this build yet" messages
  in all 8 locales (and the dashboard's inline fallbacks, which a gate holds character-identical to
  the bundle), the 31 widget-suggestion reasons Studio shows, the engine's generation notes, the
  three adapters' role hints and not-implemented message, and a handful of validation errors. Six
  lint rules now link the decision page instead of citing a document nobody has.
  
  **A third pass took the count from 3,210 to 1,493**, with non-code, markdown and user-visible
  strings all at zero: 658 test names (AST-precise, so only a test declaration's own name is
  touched), every CHANGELOG — each now carrying a note that its older entries were reworded — the
  CI workflows, CSS, HTML, ignore files and `package.json` prose, and the engine's classification
  reasons, which Studio shows a person to explain why a column was classified as it was.
  
  **The last 1,443 went by hand, and the surface is now 36 references in 10 files** — every one of
  them inside a migration `up`/`down` body, where the bytes are part of a checksum a deployed
  instance verifies at boot, so editing one would refuse to start. Those 36 are what the baseline
  records. The hand pass also repaired what the earlier sweeps had left mid-sentence: a preposition
  or an article against the next punctuation mark, two clauses welded together where the citation
  had joined them, 45 comp markers whose document name had been removed from around them, and
  three widget-suggestion reasons that lost a real descriptor (`team workload`, `shift scheduler`,
  `directory trigger`) along with the citation beside it.

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

## 0.2.3

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
