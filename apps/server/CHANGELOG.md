# @adminium/server

## 0.2.1

### Patch Changes

- 4091a4f: Evict ICU format failures by recency, and hand out copies of them.

  The bounded ring evicted by insertion order rather than recency. A repeat updated its record in place without moving it, while eviction always took the first key — so the message failing most often was the first to go. One bad message in a render loop, which is the exact case the ring exists to surface, was evicted by 49 unrelated one-off failures before an admin could ever see it in the Translations editor. Repeats now re-insert, so key order is recency order and eviction takes the least recently seen.

  `formatFailures()` also handed out live references into the ring, typed `readonly FormatFailure[]` — which protects the array, not the entries. A held result changed under the caller on the next failure, and a caller could write straight into the ring; `GET /i18n/format-errors` was safe only because it serialises immediately. Entries are now copied and typed `readonly Readonly<FormatFailure>[]`. The copy is what provides the guarantee, since `readonly` is erased at runtime.

  Both paths are covered by tests, which this module previously had none of.

- Updated dependencies [4091a4f]
  - @adminium/i18n@0.2.1
  - @adminium/engine@0.2.1
  - @adminium/llm@0.2.1
  - @adminium/adapter-mysql@0.2.1
  - @adminium/adapter-postgres@0.2.1
  - @adminium/adapter-sqlite@0.2.1
  - @adminium/schema-import@0.2.1
  - @adminium/meta@0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Rework the CLI setup wizard's prompts, output, and ending.

  The wizard now has a visual grammar: one continuous vertical rail down the left margin with a glyph per step — `◇` settled, `◆` current, `▲` wants attention. Previously every line printed at column 0, so a seven-step flow read as an undifferentiated transcript with no way to tell decisions from narration. Adds width-correct clipping (styling applied after the clip, since escape codes otherwise measure as visible columns and can be severed mid-sequence), word-boundary wrapping for prose, and a scrolling viewport for long pickers — a frame taller than the terminal cannot be rewound without the redraw eating the lines above it.

  Also lifts the wizard's pre-hidden-table rule into `@adminium/engine` as `isPreHiddenTable`. The Studio hid Adminium's own `adminium_*` store, other tools' migration bookkeeping, and join tables from its first commit, while the CLI wizard was still offering `adminium_users` as a table to build an admin panel over — generation declines to page all three regardless, so that selection could never be honoured. One rule, beside the classifier that assigns the roles, shared by both front doors.

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

### Patch Changes

- 1d7c7b4: Parse Postgres `int8` as a JS number on the meta pool.

  `createPostgresMetaDb` documented that its pool must decode int8 as a number but shipped nothing that could satisfy it, so callers either forgot — every `ts` column arrived as a string and `GET /api/v1/bootstrap` failed against its own reply schema — or reached for a process-global `pg.types.setTypeParser`, which masked the callers that had. `postgresInt8AsNumber(pgModule)` is now exported next to the contract it satisfies: `new Pool({ …, types: postgresInt8AsNumber(pg) })`.

  Scoped to the one pool deliberately. The META schema pins `ts` to epoch milliseconds and `bigint` to values under 2^53, but the server reads the user's own tables through the same `pg` module and their `bigint` ids carry no such promise — a global parser there would be a data-integrity bug in waiting. Structurally typed over the module, so `@adminium/meta` still declares no driver dependency.

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0
  - @adminium/meta@0.2.0
  - @adminium/i18n@0.2.0
  - @adminium/adapter-postgres@0.2.0
  - @adminium/adapter-mysql@0.2.0
  - @adminium/adapter-sqlite@0.2.0
  - @adminium/llm@0.2.0
  - @adminium/schema-import@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/adapter-mysql@0.1.0
  - @adminium/adapter-postgres@0.1.0
  - @adminium/adapter-sqlite@0.1.0
  - @adminium/engine@0.1.0
  - @adminium/llm@0.1.0
  - @adminium/meta@0.1.0
  - @adminium/schema-import@0.1.0
