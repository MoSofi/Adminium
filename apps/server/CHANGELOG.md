# @adminium/server

## 0.2.2

### Patch Changes

- d0e2031: Stop an apt outage from taking required CI checks down with it, and stop the VRT
  job from reddening `ci` while it cannot detect anything.
  
  `playwright install --with-deps chromium` stalled on an unreachable Ubuntu mirror
  on 2026-08-18 and ran to the 30-minute job timeout in three jobs at once — `ci`'s
  vrt, and e2e's postgres and mysql legs, two of which are required checks. The
  runs reported as `cancelled`, which reads like "superseded by a newer push", so
  main sat with no green run at HEAD and the summary did not say why.
  
  Caching the browsers is not the fix and `e2e.yml` proves it: it already cached
  `~/.cache/ms-playwright` and hung anyway, because `--with-deps` shells out to apt
  on every run regardless of whether the browser is present. A new composite action
  splits the two halves — apt is one bounded, best-effort attempt that warns and
  continues, and the browser install is required but apt-free and left unwrapped,
  since Playwright's downloader already retries across mirrors and fails fast on
  its own. All seven install sites use it, bounded from the caller.
  
  The vrt job now checks for committed baselines before spending anything. It used
  to install dependencies, install a browser and build the workspace to reach a
  step whose only action at zero baselines is to print a warning — so a job that is
  not a required check, and that cannot detect a regression, was the sole reason
  `ci` was red.
  
  Adds a contract test over `.github/actions/*/action.yml`. `timeout-minutes` is
  not a legal key on a composite-action step and the runner rejects the entire
  manifest when it sees one, so a single bad key breaks every workflow using the
  action. A draft of this change had exactly that and would have hard-failed five
  required checks. Nothing caught it: `actionlint` never visits `.github/actions/`,
  and pointed at an `action.yml` it parses the file as a workflow and exits 0.
- 00f435f: Build the coverage harness 15-quality.md §1 has specified since M0 (task 15-T01)
  and nothing implemented: no `coverage` key in any of the 9 vitest configs, no
  provider installed, nothing in CI.
  
  Every package with tests now carries `coverage.thresholds`, from a shared base at
  `@adminium/config/vitest`. Nine packages that had tests and no vitest config at
  all — engine, schema-import, llm, tokens, adapter-mysql, adapter-sqlite,
  manifest, add-on-contracts and config — get one.
  
  **The first measurement was wrong, and the reason is the interesting part.**
  Measured with vitest's default excludes, apps/server reports 81.2% over 2,787
  files: 107,165 statements of node_modules and 79,761 of workspace `dist/` are in
  the denominator, and 219 apps/dashboard files are mis-attributed to
  `apps/server/src/...` paths that do not exist on disk. Scoped to its own src it
  is 90.54% over 212 files. `packages/ui` was worse than wrong — it counted ~82,000
  statements of gitignored `storybook-static/`, which exists in the `vrt` job and
  not in `verify`, so the same commit measured 4.66% in one job and 54.64% in
  another. An `exclude` list cannot fix either case; `include: ['src/**']` can, and
  is why it is there.
  
  Floors are `max(§1 floor, measured rounded down)` per axis: green on arrival and
  ratcheting upward only. A floor set at §1's numbers would have been red on
  arrival — which is how the VRT and axe gates died the first time. Rounding down
  is not cosmetic: v8 totals are not bit-stable between identical runs.
  `@adminium/ui`, `@adminium/widgets` and `@adminium/charts` collect and report but
  assert nothing, per §1.
  
  Two RELEASE-GATE rows record what is still owed, both unchecked: the gap between
  the ratchet and §1's floors, and the fact that 9 of 10 performance budgets have
  no harness and no recorded decision either way. The previous state was worse than
  an unmet criterion — with no row, the gate could not fail on it.
  
  Coverage adds ~15% to the test leg, so `verify`'s timeout goes 20 → 25 minutes,
  and summaries upload as an artifact on failure only.
  
  Coverage is enabled by `--coverage` in each package's `test` script rather than
  unconditionally in the config. Thresholds apply to whatever was collected, so a
  deliberate subset legitimately has low coverage: with it always on,
  `vitest run one.test.ts` printed "12 passed" and then exited non-zero on
  "Coverage for statements (0.43%) does not meet global threshold (90%)" — every
  single-file debugging run looked like a failure. The full-suite path, and
  therefore CI's `turbo run test`, is gated exactly as before.
- ca0aa06: Make `source.kind = "view"` exports work, and stop advertising a kind no payload can express.
  
  `exportSourceSchema` accepts three kinds — `table`, `view`, `page` — and the
  OpenAPI document offers all three to clients. Only `table` ever worked. The
  route answered the other two with "Only `source.kind = "table"` exports are
  supported", and `export-run` carried a second copy of the same refusal that
  would throw on any row that reached it another way.
  
  **`view` is now real.** A saved view names no table of its own: it names the PAGE
  it was saved on, and the page carries the binding. So the route resolves view →
  page → `config.source.table`, checks the per-table export grant on the RESOLVED
  table exactly as a direct table export does, and stores the resolved table on the
  row. `export-run` then keys off that resolved table instead of the kind — which
  is what stopped it throwing on a row the route had already accepted and
  authorized. A saved view is a shortcut through the same door, never a way around
  it: an unauthorized caller still gets `TABLE_FORBIDDEN`, and someone else's
  private view is reported absent rather than forbidden, because whether it exists
  is the owner's business.
  
  **A view with a search term is refused, not silently widened.** An export source
  has nowhere to carry a search, so exporting such a view would hand back MORE rows
  than the view displays under the view's own name — the same silent-over-export
  failure the queued path is deliberately unwired to avoid. Sort is dropped
  silently by contrast: ordering changes how the same rows are arranged, not which
  rows they are.
  
  **`page` is refused with the actual reason.** An export source carries `table`,
  `viewId` and `filters` and no field that identifies a page, so the kind cannot be
  satisfied by any payload. It still answers 422, but now says why and points at
  the two kinds that work. Removing it from the vocabulary is a schema change and
  therefore an OpenAPI regeneration, which is left for a commit that can regenerate
  the document cleanly.
- 0dc38fb: Stop secrets surviving the log. The redaction set only ever protected one depth.
  
  `REDACT_PATHS` reads as though `*.password` covers "password at any level".
  It does not — pino's `*` is exactly one level. Measured against the installed
  pino 10.3.1:
  
      { password }             depth 1  -> NOT redacted
      { a: { password } }      depth 2  -> redacted
      { a: { b: { password }}} depth 3  -> NOT redacted
      { users: [{ password }]} array    -> NOT redacted
  
  So every `*.`-prefixed entry — `*.token`, `*.secret`, `*.apiKey`, `*.dsn`,
  `*.bootToken`, `*.ADMINIUM_SECRET` — guarded depth 2 and nothing else.
  `@pinojs/redact`'s own README says "redacts password at any level", which is
  very likely how the list came to be written that way. The obvious repair is a
  trap: `'**.pass'` is accepted by pino's path validator and matches nothing at
  any depth, so it would look applied and redact nothing.
  
  Redaction is now a rule rather than a list: a `formatters.log` hook walks the
  whole object to any depth and through arrays. The path list is kept — it is
  exact for `req.headers.*` and costs nothing — but it is no longer the guarantee.
  
  Fields that were covered at NO depth and now are: `pass` and `passEncrypted`
  (the SMTP credential — the stored ciphertext AND the decrypted plaintext, which
  is the more valuable of the two), `otpauthUrl` (a string carrying the full TOTP
  seed), `recoveryCodes`, `challengeToken`, `secretEncrypted`, and `lastError`
  (driver errors routinely quote the whole connection string — `export/redaction.ts`
  already refused to export it for that reason while the log had no equivalent).
  
  The comment in `email/config.ts` asserting pino redacted the SMTP password is
  corrected. It was false, and it is the kind that stops the next person checking —
  `app.ts` had already documented the very rule it violated, in the `bootToken`
  note directly above the list.
  
  The scrub returns class instances by reference, so the `req` and `err`
  serializers still see real objects (pino runs formatters before serializers, so
  cloning an Error would have cost its message and stack). It is total against
  throwing getters, circular references and depth, and returns the same reference
  when nothing matched. `test/log-redaction.test.ts` drives the real `buildLogger`
  and asserts on the bytes it writes — four of its cases fail against the previous
  state.
- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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
- c2e3c6e: Let a v1 prerelease tag run the release pipeline, and never let it take `latest`
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
- Updated dependencies [08df45d]
- Updated dependencies [66f0683]
- Updated dependencies [586426a]
- Updated dependencies [e15787b]
- Updated dependencies [2dffc12]
- Updated dependencies [1d952df]
- Updated dependencies [e52d7da]
- Updated dependencies [08df45d]
- Updated dependencies [d97ac21]
- Updated dependencies [c09848a]
- Updated dependencies [2728dea]
- Updated dependencies [4f297da]
- Updated dependencies [81394c0]
- Updated dependencies [00cd08f]
- Updated dependencies [2684976]
- Updated dependencies [aabc4e1]
- Updated dependencies [ef1c300]
  - @adminium/i18n@0.2.2
  - @adminium/engine@0.2.2
  - @adminium/llm@0.2.2
  - @adminium/schema-import@0.2.2
  - @adminium/adapter-postgres@0.2.2
  - @adminium/adapter-sqlite@0.2.2
  - @adminium/adapter-mysql@0.2.2
  - @adminium/meta@0.2.2

## 0.2.2-rc.0

### Patch Changes

- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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
- c2e3c6e: Let a v1 prerelease tag run the release pipeline, and never let it take `latest`
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
- Updated dependencies [00cd08f]
- Updated dependencies [2684976]
- Updated dependencies [aabc4e1]
- Updated dependencies [ef1c300]
  - @adminium/i18n@0.2.2-rc.0
  - @adminium/meta@0.2.2-rc.0
  - @adminium/adapter-postgres@0.2.2-rc.0
  - @adminium/adapter-mysql@0.2.2-rc.0
  - @adminium/adapter-sqlite@0.2.2-rc.0
  - @adminium/engine@0.2.2-rc.0
  - @adminium/llm@0.2.2-rc.0
  - @adminium/schema-import@0.2.2-rc.0

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
