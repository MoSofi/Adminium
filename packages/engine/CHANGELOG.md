# @adminium/engine

## 0.2.2-rc.0

### Patch Changes

- 2684976: Infer the relations a schema implies but never declares, and let an accepted one
  survive the next regeneration.
  
  `RELATION_KINDS` has always listed `inferred-name` and `inferred-join-table`, and
  five consumers branch on them — `detectDomains` unions relations at confidence
  0.8, the column classifier promotes an accepted one to the `fk` semantic,
  `detectHierarchy` looks for a self-referential edge, the Studio remap editor
  renders an "inferred" bucket, and the LLM normalizer builds its heuristic
  baseline from them — but nothing ever wrote one. `model.relations` came
  exclusively from declared foreign keys. On a schema that declares none (MyISAM,
  legacy SQLite, most ORM-generated MySQL) that emptiness cascaded all the way to
  the screen: domains shattered into singletons so every table landed in
  "General", dashboards were skipped for want of a joined time axis, and every
  `*_id` column fell through to `external-id` — a monospaced string where an
  entity chip belonged.
  
  `applyInference` fills that in. Rule 1 resolves `customer_id` onto `customers`,
  scoring the evidence: an exact singular/plural match on an agreeing declared key
  reaches 0.90 and behaves like a declared FK everywhere, while every weakening — a
  role prefix dropped from `shipping_address_id`, a cross-schema hop, a name two
  tables answer to, types that merely rhyme — costs enough to land in the 0.5–0.79
  band instead. That band is the point: all four 0.8 gates exclude it, so a weak
  guess is visible to the remap editor as a suggestion without acting on anything.
  Rule 2 then reads the graph rule 1 just seeded and emits the many-to-many for a
  table that is nothing but two foreign keys. Hierarchy vocabulary (`parent_id`,
  `reports_to`) resolves to its own table, which is what finally lets the tree and
  org-chart triggers fire on a schema with no declared self-FK.
  
  Order is load-bearing and looks circular: join detection reads the `fk` semantic,
  which the column classifier derives from `model.relations`. So inference runs
  first, as its own function — `applyInference` then `applyClassification` — and
  deliberately not inside the classifier, which spreads `...model` and rebuilds
  only `tables`, discarding anything added within it. It runs in exactly one place,
  at introspection, so the snapshot carries the result and a `relation.remove`
  override stays removed instead of being re-derived on every run. A schema that
  declares its foreign keys is left untouched; nothing here ever emits 1.0.
  
  The second half closes a loop that was open at one end. The `relation.add` /
  `relation.remove` overrides were folded in on the read path only, so a relation a
  user accepted in Studio appeared in the schema browser and the data API — and
  then the next regeneration re-parsed the raw snapshot, saw none of it, and
  emitted pages with no FK chip, no related list, and no join. The user's
  correction was visible everywhere except the thing it was made to correct.
  Accepted relations now reach `generatePages` at confidence 1.0 with
  `kind: 'override'`, ahead of the wizard's table filter so an override into an
  excluded table is dropped by the same rule that drops a declared FK. One whose
  table or column the schema has since dropped is skipped with a warning naming it,
  rather than generating a page that cannot load.
- ef1c300: Let admins create and edit pages from Studio, and give every screen one gutter.
  
  Pages are now a first-class thing an admin can make. Studio gains a pages
  section — create, duplicate, reorder columns, pick an icon, choose a template —
  backed by page lifecycle routes on the server and the page repo and permission
  checks in `@adminium/meta`. Until now a page existed only as something the
  generator emitted from a schema snapshot, so a hand-made page had no way to
  fill its own body.
  
  `@adminium/engine` gains the entry point that makes that possible.
  `generatePages` composes a whole app and picks every template itself;
  `composeRequestedArchetype` composes one page but only for the nine archetypes,
  because it delegates to `buildArchetypeEnvelope` and that returns null for
  anything else. Neither serves an admin who picked `page-crud` for a table by
  hand, which is the most common choice. `recompose` is the missing third door:
  the same classify → candidates → compose prelude, dispatching to
  `buildCrudEnvelope` or `buildArchetypeEnvelope` as the template demands, so the
  server can rebuild a page's body from live schema instead of leaving it empty.
  Templates that are not table-bound — `page-dashboard` composes from a domain,
  and `page-builder`/`page-wizard`/`page-settings` are tool surfaces whose bodies
  the renderers ignore — return `bindable: false` with a null envelope, so the
  caller keeps whatever the page already had rather than blanking it.
  
  The second half is `PageSurface`. Every routed screen used to invent its own
  gutter — `p-6` here, `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing
  at all on the templates that forward straight to `@adminium/widgets` — so the
  padding changed every time you moved between two screens of the same app. Now
  each screen renders exactly one `PageSurface`, which owns the inner main
  section and is the only thing that can set the gutter; the shell's sidebar and
  topbar sit outside it and are unaffected. It takes `standard` (the density-scaled
  `--main-pad`), `none` for templates that draw their own full-bleed chrome, or an
  explicit x/y pair from a page's stored config, with `width: 'content'` as an
  independent knob for screens that are a short stack of controls rather than a
  grid.
  
  Chart and KPI text now has a legibility floor held by a test rather than by
  eye, and the theme control moved out of the header into the account menu as a
  verb-labelled item ("Light mode" / "Dark mode") that keeps its ⌘⇧L shortcut.
- Updated dependencies [ef1c300]
  - @adminium/widgets@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/widgets@0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Rework the CLI setup wizard's prompts, output, and ending.

  The wizard now has a visual grammar: one continuous vertical rail down the left margin with a glyph per step — `◇` settled, `◆` current, `▲` wants attention. Previously every line printed at column 0, so a seven-step flow read as an undifferentiated transcript with no way to tell decisions from narration. Adds width-correct clipping (styling applied after the clip, since escape codes otherwise measure as visible columns and can be severed mid-sequence), word-boundary wrapping for prose, and a scrolling viewport for long pickers — a frame taller than the terminal cannot be rewound without the redraw eating the lines above it.

  Also lifts the wizard's pre-hidden-table rule into `@adminium/engine` as `isPreHiddenTable`. The Studio hid Adminium's own `adminium_*` store, other tools' migration bookkeeping, and join tables from its first commit, while the CLI wizard was still offering `adminium_users` as a table to build an admin panel over — generation declines to page all three regardless, so that selection could never be honoured. One rule, beside the classifier that assigns the roles, shared by both front doors.

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- Updated dependencies [1d7c7b4]
  - @adminium/widgets@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/widgets@0.1.0
