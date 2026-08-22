# @adminium/i18n

## 0.2.2

### Patch Changes

- 08df45d: Fix the accessibility violations the axe sweep had been hiding, and the two
  harness defects that hid them.
  
  `a11y-baseline.json` held 162 fingerprints for four weeks. 111 of them do not
  reproduce at all.
  The sweep runs over the Storybook build, and that build was measuring something
  the product does not look like: `storybook.css` `@source`d only `packages/ui`
  while `.storybook/main.ts` has loaded the widgets and charts stories since
  04-T17, so every widget story rendered unstyled; and nothing painted `--bg` on
  the preview body, so under `data-theme="dark"` stories drew dark-theme
  foregrounds on Storybook's white body — axe resolves `color-contrast` against
  the nearest opaque ancestor, so the translucent tone tints composited over white
  and reported pairs the product never renders.
  
  Fixing both exposed violations the unstyled build had concealed. 128 were found
  and fixed rather than baselined:
  
  - alpha-dimmed small text on the accent bubble and calendar chips
    (`text-accent-fg/70`, `opacity-80`) measured 3.1–3.9:1 and went to full
    opacity — `--accent-fg` on `--accent` is already gated at 4.5:1, the alpha was
    the whole failure;
  - six scrollable regions with no focusable content were mouse-only and now carry
    `tabIndex` with a labelled role (chat transcripts, the AI panel, the queue
    detail pane, three chart matrices, the calendar lists);
  - `role="row"` containers whose children carried no cell role made their whole
    table invalid to assistive tech, and now use `rowheader`/`cell`/`columnheader`;
  - the grouped-summary expander was `aria-expanded` on a row with a keydown shim,
    and is a real `<button>`;
  - a `<dl>` with a direct `<p>` child is corrected;
  - `ChipInput` and paused job rows dim to 40–55% and now say `aria-disabled`,
    which is what makes WCAG 1.4.3's inactive-component exemption apply rather
    than merely look as though it should.
  
  The **AuthLayout brand panel** is the one the sweep can never see — it is
  `aria-hidden`, so axe skips the subtree while a sighted low-vision user reads all
  of it. It painted `--accent`, which resolves to the dark ramp under
  `data-theme="dark"`; that ramp is a foreground colour, so it is light, and white
  copy on it measured **1.64–2.35:1** across the eight accents. It now paints
  `--accent-light` in both themes (5.90–18.88:1), with the white alphas raised and
  the testimonial card darkened rather than lightened. A new `brand-panel` group in
  the token contrast gate measures it, since nothing else can.
  
  Eight `ui.*` keys were added across all locales for the new region labels.
  
  The baseline now holds 112, and getting a trustworthy number took two wrong
  answers first. `data-vrt-ready` was a bare mount effect while widget bodies load
  as per-family lazy chunks, so the sweep raced the stories: a fast machine
  reported 1 violation and CI reported 111 on the same commit. The sweep and the
  VRT spec now navigate with `networkidle` and the flag waits for DOM quiescence,
  after which both agree. Against the original 162: 111 do not reproduce, 51 were
  real all along, and 59 more were exposed once the stories rendered styled.
- 66f0683: Stop bulk export silently dropping every row selected on an earlier page.
  
  `page-crud`'s selection survives paging, and the browser-side export — which is
  the path every user takes, because no host implements the optional
  `CrudApi.export` — filtered the CURRENTLY LOADED page by the selected ids.
  Select on page one, page forward, select again, export: page one's rows were
  gone from the file, with nothing on screen to say so. The toolbar still counted
  them.
  
  The template now snapshots each selected row as it is selected — from the rows
  the grid was rendering when the click happened, so a row that could be clicked
  can never be missed — and exports from that, in selection order. Membership is
  captured in the selection handler rather than in an effect keyed on the loaded
  page: an effect can only record rows that happen to be loaded when it runs,
  which would have made the snapshot depend on effect ordering against the list,
  the same class of bug as the one it exists to fix. Deselecting drops a row from the snapshot; deleting a
  row drops it from the SELECTION too, on the single-row path as well as the bulk
  one — a deleted row must not keep being counted, and must not turn up in a file.
  
  One new string, `templates.crud.toast.exportIncomplete`, covers the case the
  design makes unreachable: if the snapshot were ever short, the export says how
  many rows it wrote. The point of the fix is that a short export can no longer be
  a silent one.
  
  The queued server-side run is deliberately still not wired: `ExportSource` on the
  wire carries `{kind, table, viewId, filters}` and no row selection at all, so
  implementing `export` against it as it stands would widen a selection export to
  the whole table — trading a silent drop for a silent over-export.
- 586426a: Defer the two data-io route bodies, and make the `page-wizard` template split real.
  
  `app/router.tsx` imports `data-io/routes.tsx` statically — it has to, the routes
  are built at module scope — and that module imported `ImportWizardPage` and
  `DataExportsPage` statically, so both route bodies sat in the synchronously
  loaded set for every user on every route.
  
  `ImportWizardPage` is also the `page-wizard` template body, which made this
  worse than one heavy route. `pages/templates.tsx` registers all fourteen
  template bindings behind dynamic imports, and thirteen of them were genuinely
  deferred: the fourteenth's chunk held a 22-line wrapper while the body shipped
  on boot anyway, because this file had already pulled it into the entry. The
  accounting said fourteen. It is fourteen now.
  
  Entry chunk: **330,905 → 315,684 bytes gz, −14.9 KiB**, and
  `chunk-budget.json`'s ratchet comes down from 331,000 to 317,700 in the same
  change — the file's own rule, and the edit is the reviewable click. The 331,000
  was loose besides: nothing had raised it, but ordinary additions had spent
  ~1.4 KiB of its margin since 2026-08-18, which is the drift a stale ratchet
  hides. RELEASE-GATE.md recorded the entry as 321.3 KiB on one line and 321.4 on
  another for the same measurement; both now state the one number this build
  measures, and say out loud that the gate counts JS only — the entry stylesheet
  blocks paint, is uncounted, and is 20,955 bytes gz of the real payload.
  
  The cost is one chunk fetch the first time `/imports` or `/exports` is opened.
  The page surface and its topbar title stay outside the Suspense boundary, so the
  frame paints immediately and only the body waits behind a spinner.
  
  Both routes also have end-to-end coverage for the first time
  (`apps/e2e/tests/data-io.spec.ts`). `dataio.test.tsx` mounts the two components
  directly, which proves they render and says nothing about the route — and a
  lazily-loaded body fails in ways a direct mount cannot see.
- e15787b: Give the connect wizard's generate step the cancellation its two siblings already had.
  
  `GenerateStep.run()` is a click-started async chain — a staged delay, the
  generate POST, another delay — and it narrated straight into `setPhase`,
  `setResult`, `setError` and the log console with nothing checking whether the
  step was still mounted. Leave the wizard mid-generate and every one of those
  lands on a tree that is gone.
  
  `TestStep` and `EnrichDirectProgress` are the same wizard, with the same `wait()`
  helper copied into all three, and both carry a `cancelledRef` cleared in an
  effect. This step never got one. That asymmetry is what makes it an oversight
  rather than a decision, and it was found by grepping the dashboard for timers
  that outlive their component after two others turned up the same week.
  
  The ref is RE-ARMED on every effect setup rather than initialised once, because
  `main.tsx` renders under `React.StrictMode`: a setup→cleanup→setup double-invoke
  would otherwise leave it stuck `true` from the simulated cleanup, and the step
  would silently narrate nothing. `EnrichDirectProgress` carries that same comment
  for the same reason. The new test renders inside StrictMode precisely so it can
  fail on that mistake — a plain render passes either way.
  
  One call is deliberately left unguarded: the `bootstrap` invalidation after a
  successful generate. Those pages exist on the server whether or not the step is
  still on screen, so skipping it would leave a stale nav behind.
- 2dffc12: Stop a dead icon name costing a generated app its first paint, and put 64
  untranslated keys into the locale bundles.
  
  - `kanban-square` is not a lucide icon — it was renamed to `square-kanban`. It
    was emitted as `nav.icon` by the page generator, so any generated app with a
    workflow-shaped table fetched the entire ~137 KB icon catalogue on first paint
    to discover the name was dead, then drew the neutral `File` fallback anyway.
    A second instance, `bar-chart-3`, was found by the new gate.
  - `gen-icon-core.mjs` already computed the list of declared-but-unknown icon
    names and discarded it, printing only a count. It now fails in both `--check`
    and write mode, naming the offending file and the canonical rename.
  - `LUCIDE_ICON_NAMES` is now a real export. `allowedIcons` was documented as
    fed by it, that symbol existed nowhere, and nothing supplied the value — so
    the unknown-icon warning and the `table` fallback never fired and a model
    could store any hallucinated icon string on a table.
  - 64 `t()` keys existed in no locale bundle and rendered a hardcoded English
    default in all 8 locales, 56 of them the Settings → Languages & translations
    page itself — the one page whose keys the in-product translation editor
    cannot reach, because it refuses any key absent from the compiled bundle.
    All 8 bundles now carry them, translated rather than copied from English.
- 1d952df: Stop the hub's introspection poll running two minutes past the screen that started it.
  
  `awaitIntrospectJob` loops up to 100 times against `GET /jobs/:id`, so leaving
  the connections hub mid-introspection kept fetching for as long as two minutes
  and ended in a toast about a screen the user had left. It now takes an
  `AbortSignal` the card aborts on unmount — checked at the top of each iteration
  and inside the sleep, the same shape `waitForHealth` already uses in
  `studio/api.ts`, where the flag is read at the loop boundary rather than threaded
  into `fetch` (`app/api.ts` takes no signal, and one in-flight GET is not the
  problem).
  
  `aborted` is a THIRD outcome rather than being folded into `failed`. The job is a
  server job and carries on regardless; only the watching stopped. Reporting that
  as a failure would put "Introspection failed. Try again." in front of someone
  whose introspection is at that moment succeeding. On the aborted path the
  mutation pushes no toast at all, and `onSettled` still invalidates the
  connections query, so the new snapshot is there the next time the hub opens.
  
  This is the last of the four timers the dashboard sweep found outliving their
  component, after the `page-crud` search debounce, the two builder autosaves and
  the connect wizard's generate step.
  
  One inaccuracy in the same function is left alone deliberately: exhausting all
  100 iterations still returns `failed`, so a job that is merely slower than the
  client's ~2-minute budget is reported as a failure. Correcting that needs a
  distinct "still running" message in eight locales, which is a copy change rather
  than a timer fix.
- 2728dea: Give `GET|PUT /settings/security` a screen, and stop the 2FA switch overpromising.
  
  The three enforced `auth.*` knobs — `sessionTtlHours`, `require2fa`,
  `passwordMinLength` — had a route, a Zod schema, an RBAC gate and a full set of
  translated strings in all 8 locales, and no way to reach any of it short of
  curl. `settingsHub.security.*` had sat unused in `common.json` since M5, and
  the page's own test asserted the absence with a rationale ("no auth flow
  enforces them yet") that stopped being true when enforcement landed.
  
  Settings → Security is now a second card on the workspace settings form. It is
  the same form, deliberately: one Save button, one review-then-confirm modal
  listing the changed fields, and two independent section-puts underneath. Two
  save buttons on one screen is how half a settings change gets shipped.
  
  `auth.allowSignup` is still not surfaced — the route does not accept it, so a
  fourth control would save nothing. Its strings stay unused, as they were.
  
  The honesty problem, and what was done about it. The only existing description
  of the toggle was "Every member must enable 2FA to sign in." That is false.
  `auth.require2fa` is advisory: it flags un-enrolled accounts with
  `twoFactorSetupRequired` and refuses `POST /auth/2fa/disable`, and that is all
  it does. No preHandler blocks an un-enrolled principal, and API-key principals
  are outside the question structurally, because `plugins/auth.ts` resolves a
  bearer key and returns before a session exists. So one new key —
  `settingsHub.security.require2fa.note` — states the boundary next to the switch
  that throws it, in the same words as the `auth.require2fa` docblock in the
  settings registry:
  
      Advisory, not a barrier: members without 2FA are sent to set it up and can
      no longer turn it off, but their sign-in is never blocked, and API keys are
      unaffected.
  
  The existing `desc` is left alone. Rewording it costs 8 locales and buys
  nothing once the boundary is stated beside it.
  
  The two numbers are held as typed text rather than as `number` state, because
  `number` cannot express "momentarily empty while being retyped" — clearing 720
  to type 24 would otherwise snap the field to 0. Both mirror the route's bounds
  client-side, so an out-of-range value is refused on the field instead of coming
  back as a 422 over a save that also carried a logo.
- 4f297da: Give SMTP a screen, so the transport behind password reset and invites is not curl-only.
  
  `GET|PUT /api/v1/settings/email` had a Zod schema, an RBAC gate, an audit
  marker, a host guard and encryption at rest — and no surface anywhere in the
  product. The transport that gates password resets, user invites, the
  notification `email` channel and scheduled report delivery could be set only by
  hand-writing the PUT or importing a config bundle. The docs said so in a
  "what's absent" bullet, which is now no longer true and has been corrected.
  
  Email (SMTP) is a third card on the workspace settings form, on the same terms
  as Security: one Save button, one review-then-confirm modal, three independent
  section-puts underneath.
  
  The password is the part worth reading about. The GET returns no password in any
  form — not the value, not a masked copy, not a last-4 — so the field starts
  empty on every load and empty means "keep the stored one", which is what stops a
  port change from making an admin retype a production secret. Typing one replaces
  it. Emptying the USERNAME sends `pass: ''` and clears it, because a secret an
  open relay cannot use is one nobody will remember to revoke. The review modal
  lists the field as "Replaced" and never shows a value.
  
  Host, port and from-address bounds mirror the route's, including
  `assertSmtpHostAllowed`'s bare-hostname rule, so a pasted `smtp://host:587` is
  refused under the field instead of coming back as a 422 over a save that also
  carried a logo. An unconfigured workspace opens with empty boxes, a suggested
  port and a note saying what cannot be sent — not three red fields.
  
  `{smtp: null}`, the route's own way of spelling "no relay", is reachable through
  a staged Remove that mirrors the logo's. And `/studio/settings` now has e2e
  coverage at all: the form's stub-driven unit tests could only ever prove what
  body it builds, not that the server accepts it.
- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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

## 0.2.2-rc.0

### Patch Changes

- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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

## 0.2.1

### Patch Changes

- 4091a4f: Evict ICU format failures by recency, and hand out copies of them.

  The bounded ring evicted by insertion order rather than recency. A repeat updated its record in place without moving it, while eviction always took the first key — so the message failing most often was the first to go. One bad message in a render loop, which is the exact case the ring exists to surface, was evicted by 49 unrelated one-off failures before an admin could ever see it in the Translations editor. Repeats now re-insert, so key order is recency order and eviction takes the least recently seen.

  `formatFailures()` also handed out live references into the ring, typed `readonly FormatFailure[]` — which protects the array, not the entries. A held result changed under the caller on the next failure, and a caller could write straight into the ring; `GET /i18n/format-errors` was safe only because it serialises immediately. Entries are now copied and typed `readonly Readonly<FormatFailure>[]`. The copy is what provides the guarantee, since `readonly` is erased at runtime.

  Both paths are covered by tests, which this module previously had none of.

## 0.2.0

### Minor Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.
