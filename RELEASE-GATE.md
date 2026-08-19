# v1.0 Release Gate

The checklist that must be fully checked before a `v1.*` tag may publish.
CI enforces it: the `release-gate` job in `.github/workflows/release.yml`
fails any GA `v1+` tag build while an unchecked `- [ ]` item remains here, and
every publish job depends on it. `v0.x` tags are exempt.

A `v1.x` **prerelease** (`v1.0.0-rc.1`) is reported on but NOT blocked — it
prints the unchecked rows and proceeds. That exemption exists because the last
row below requires an rc rehearsal, and gating the rehearsal on a fully-checked
list made that row unsatisfiable by itself. Prereleases publish to npm under
the `next` dist-tag and never move Docker's `:latest`.

Rules: check an item only when it is verifiably true on `main` (test, CI job,
or recorded decision). An item that stops being true gets unchecked. Deciding
to waive an item means rewriting it to record the waiver and its rationale,
not deleting it.

## Performance

- [x] Dashboard entry chunk meets its budget — **321.3 KiB gz (329,014 bytes)
      against the 350 KiB target, 2026-08-18.** Down from 655.1 KiB, a 51%
      reduction, in three changes: the fourteen page-template bindings are lazy
      (`pages/templates.tsx`, −97.0 KiB — a page renders one template and
      downloaded all fourteen); the lucide catalogue is no longer imported as a
      map (`scripts/gen-icon-core.mjs` + `packages/ui/.../icon-resolver.ts`,
      −112.6 KiB — all 1,611 icon modules were in the entry for the ~136 the
      product draws); and eleven route components are lazy (`app/router.tsx`,
      −62.7 KiB — `EmailTemplatesPage` alone reached `PageBuilder` →
      `WidgetHost` → the whole widget registry).
      **The six earlier raises blamed the wrong thing.** They attributed the
      growth to the en-US i18n catalogue and named 10-T06 as the fix. Measured:
      deleting `EN_US_RESOURCES` entirely is worth 48.7 KiB gz — a seventh of
      what was available, and it was not needed. The full record, including why
      the i18n split was deliberately NOT taken, is in
      `apps/dashboard/chunk-budget.json`
- [x] Bundle-size gate runs in CI so the entry chunk cannot regress silently
      (`apps/dashboard/scripts/check-entry-budget.mjs` runs at the end of the
      dashboard build, which the CI verify job executes)
- [x] `count=estimated` is backed by catalog statistics with an exact fallback,
      never a blind exact `COUNT(*)` (`apps/server/src/crud/list.ts`,
      proven live in `apps/server/test/crud-estimated-count.test.ts`)

- [x] Every package meets the coverage floor 15-quality.md §1 specifies —
      **closed 2026-08-19.** All 12 floored packages now configure a threshold at
      or above their §1 number on both axes, and all 12 pass it. The three §1
      exempts (`ui`, `widgets`, `charts`) collect and report without asserting,
      which is what §1 prescribes — screenshots and axe are the signal there.
      Configured floor / §1 / measured:
      engine 94-88 / 90-85 · config 95-88 / 90-85 · i18n 91-90 / 90-85 ·
      tokens 90-85 / 90-85 (100/100) · llm 94-86 / 90-85 (95.41/87.70) ·
      meta 93-90 / 90-85 (94.37/91.60) · schema-import 97-90 / 90-85 (98.67/91.91) ·
      adapter-sqlite 98-90 / 90-85 (99.91/91.95) · adapter-postgres 98-97 / 90-85
      (99.82/98.86 live) · adapter-mysql 99-95 / 90-85 (100/96.22 offline) ·
      server 88-80 / 85-80 (90.54/81.31) · dashboard 75-82 / 75-70 (75.47/84.25).
      **Two structural defects closed with it.** `packages/tokens` declared a
      90/85 floor and enforced nothing: its test script never passed
      `--coverage`, and the shared helper sets `enabled: false` so that flag is
      what turns it on — it was the one package whose floor equalled its §1
      number on paper and could not fail. `packages/adapter-mysql` carried NO
      floor unless `TEST_MYSQL_URL` was set, so a laptop run enforced nothing;
      its floor is now unconditional, which became safe once every one of its 7
      source files is executed offline (verified: zero placeholder-shaped files,
      so the denominator is already in its fully-executed shape and the live leg
      can only add covered branches).
      **Floors carry deliberate margin rather than being rounded down from the
      measurement.** v8's branch TOTAL is not stable run to run — the same
      adapter-sqlite suite reported 582 and 584 total branches on consecutive
      runs, ~0.3 of a point — so a floor a quarter-point under the reading is
      decided by noise. Every floor here still clears §1 with room.
      **The one number not measured in CI's own configuration** is `apps/server`
      with the MySQL leg: re-measured here with a real pg16 and CI's
      `TEST_POSTGRES_URL`/`PGUSER`/`PGPASSWORD` (1477 tests, 7 skipped) at
      90.54/81.31, but this machine has no MySQL and no Docker. That leg is why
      fb8b2ae lowered this floor to 79 off a CI reading. Server's denominator is
      close to fully expanded — 4 of 211 files unexecuted, all four entrypoints
      no database leg reaches — so MySQL should add covered branches rather than
      expand the total. If `verify` reddens on coverage, that is the line to
      re-check, and this row gets unchecked per the rule above.
- [x] Performance budgets — **9 of the 10 rows in 15-quality.md §5 are WAIVED
      for v1.0** (owner decision 2026-08-19). The tenth is measured and gated and
      stays that way: the dashboard entry chunk, 321.4 KiB gz against 350, by
      `apps/dashboard/scripts/check-entry-budget.mjs` at the end of the dashboard
      build.
      **Rationale.** v1 is a free, self-hosted, source-available admin tool with
      no hosted multi-tenant surface, so there is no fleet whose p95 anyone is
      accountable for; an operator runs it against their own database at their
      own scale. Building nine benchmark harnesses to confirm limits that nothing
      suggests are being exceeded is not the best use of the remaining v1 time.
      Same shape as the external-pentest waiver above, and for the same reason.
      **What the waiver rests on, stated honestly, because two of these are
      different in kind.** Spot-measured and NOT violated today: the per-family
      widget chunk ceiling (largest real family chunk 61.5 KiB gz against 120)
      and the per-locale ceiling (31.8–36.4 KiB). Genuinely UNKNOWN, with no
      measurement of any kind ever taken: 500-table introspection on sqlite,
      postgres and mysql (3 rows), peak engine memory under 256 MB, record-list
      p95 at 1M rows, and deep-offset degradation. A spot measurement is not a
      gate, and "unknown" is not "fine" — this waiver says those five are not
      worth measuring BEFORE v1, not that they pass.
      **Un-deferral triggers.** Revisit before any hosted/Cloud GA (where the p95
      becomes someone's SLO); on the first user report of slowness at scale; or
      if `DataGrid` gains virtualization, since the 1M-row row exists precisely
      because it renders unwindowed today and every shipped call site caps it at
      200–1,000 rows.
      Do not read this row as "performance is handled". Read it as "one budget is
      enforced, two are spot-checked, five are unknown, and that was a decision".

## Security

- [x] CodeQL (js/ts) analysis runs on push, PR, and weekly schedule
- [x] `pnpm audit --prod --audit-level high` gates CI; production advisories
      fixed (fast-uri, @fastify/static)
- [x] Dependabot opens weekly grouped updates (npm, actions, docker)
- [x] Formal security review pass: 10-dimension adversarial review
      (authn/session, RBAC, injection, PII masking, secrets, headers, SSRF,
      upload/IO, validation, realtime/jobs); 5 confirmed findings all fixed
      with regression tests (2026-07-23)
- [x] `system:schema:remap` unmask escalation closed (decision 2026-07-23):
      turning PII masking ON stays open to remap holders; an explicit
      `column.pii masked:false` (the only op that unmasks a classified column)
      requires Super Admin (`apps/server/src/routes/schema/index.ts`, tested in
      `connections.test.ts`)
- [x] External pentest — **WAIVED for v1.0** (owner decision 2026-07-23). v1
      is a free, self-hosted, source-available admin tool with no hosted
      multi-tenant surface; the in-repo 10-dimension adversarial review stands
      in for v1. Revisit before any hosted/Cloud GA (un-deferral).

## Accessibility

- [x] Token contrast gate: every gated fg/bg pair passes WCAG AA in both
      themes, strict (0 failures)
- [x] axe sweep gated in CI by a grow-only fingerprint baseline (no new
      violation kinds can land)
- [x] axe fingerprint baseline burned down to zero — **162 → 0, 2026-08-19.**
      The count is honest only with its composition, so: 92 of the original 162
      were never real (artifacts of an unstyled, white-bodied Storybook), and the
      remaining 70 were fixed in component code across seven passes — a wrapper
      `role="button"` that stripped whole tables from the a11y tree, a tab strip
      pointing `aria-controls` at panels that never existed, a phantom scroll
      from one unclamped marker, wrapper opacity taking text beside live controls
      to 2.2:1, a progress label at 1.01:1, table rows missing their header
      roles, an interactive row that flattened its own controls, and a Radix
      trigger rendered onto a `div`.
      **Five of the last nine were never live.** They were already fixed and only
      still reported because widget stories bundle `@adminium/ui` from its BUILT
      `dist` while ui stories use `src`, and the Storybook build predated the dist
      rebuild — one sweep measuring two different implementations of the same
      component. Rebuild the package before rebuilding Storybook; it is recorded
      in the baseline's `howToMeasure`.
      **What the gate still cannot see**, recorded rather than left implied: it
      does not model a soft tint composited over ANOTHER soft tint. Measured
      across the full cross product, 2,969 of 28,224 such pairs fail with a floor
      of 3.47:1, and `--fg-subtle` already sits at 4.557:1 on one tint over
      `--surface-3` — so closing it is a palette decision, not a gate change.
      `acceptedWithRationale` is empty: nothing is accepted, everything is fixed.
- [x] The axe sweep and the VRT matrix measure a story that has finished
      rendering — `scripts/a11y-sweep.mjs` and `vrt/vrt.spec.ts` both navigate
      with `networkidle`, and `.storybook/preview.tsx` stamps `data-vrt-ready`
      only after the story subtree stops mutating. Before this the result
      depended on machine speed, which is almost certainly the source of the
      intermittent widget-render failures this repo has been re-running past —
      and it means no VRT baseline captured earlier would have been worth
      keeping
- [x] AuthLayout brand-panel contrast resolved — **it WAS a token swap, just not
      the one that had been tried.** The panel painted `--accent`, which resolves
      to the DARK ramp under `data-theme="dark"`; that ramp is a foreground
      colour, so it is light, and white copy on it measured **1.64–2.35:1**
      across the eight accents. It now paints `--accent-light`, the same variable
      in both themes, making the panel one fixed dark brand surface at
      5.90–18.88:1 that still follows `data-accent`. The white alphas went with
      it (description and trust badges 80%/60% → 90%, the testimonial card from
      `bg-white/10` to `bg-black/15`). The panel is `aria-hidden`, so the axe
      sweep skips the whole subtree and always will — it is gated instead by a
      new `brand-panel` group in `packages/tokens/scripts/contrast-check.mjs`
      (3,088 → 3,328 gated pairs, all passing) and pinned from the component side
      in `AuthLayout.test.tsx`
- [x] Accessibility is checked on ASSEMBLED pages, not only in isolation
      (`apps/e2e/tests/a11y.spec.ts`): the sign-in screen, the generated
      dashboard, a page-crud list, a record detail and an admin settings surface,
      each scanned with `@axe-core/playwright` — which was a devDependency of one
      package and appeared in no test. No baseline there, deliberately: it starts
      clean and must stay clean
- [x] A keyboard-only journey spec exists (`apps/e2e/tests/keyboard.spec.ts`):
      tab from the top of the document into the nav and follow a link, the
      account menu's open/arrow/Escape-restores-focus cycle, the command palette
      on its shortcut, and reaching a grid's sort control — all driven with the
      keyboard alone, no `.click()` and no `.focus()`. axe cannot supply any of
      it: it reads a snapshot, so it cannot tell you that tabbing never reaches
      something or that Escape strands you
- [ ] VRT baselines regenerated on the CI platform after the token changes.
      **2026-08-18: the harness is now wired** — `vrt` is a turbo task and a job
      in `ci.yml`, after being complete-but-unreferenced (no workflow, no turbo
      task, never executed once) for the whole of M1–M11. It currently reports
      **0 committed baselines** loudly into the job summary rather than passing
      silently. Capture them with the `vrt-baselines` workflow
      (`workflow_dispatch`, runs on the same image, uploads the PNGs as an
      artifact to review and commit) — deliberately AFTER the accessibility
      burn-down below, or the whole matrix gets recorded twice

## i18n / RTL

- [x] 8 locale bundles with parity tests; RTL audit and numeral policy done
- [x] Native locale review — **WAIVED for v1.0** (owner decision 2026-08-18):
      "I don't have the capacity to do that, so we don't want this to be a
      blocker." Native review of the machine-translated strings across the seven
      non-English locales is external work measured in weeks, not engineering
      days. What makes the waiver defensible rather than a shrug: the product
      already ships an honest unreviewed-locale affordance, so a user is told
      what they are looking at rather than being shown a machine translation
      presented as a reviewed one. Revisit per-locale as reviewers become
      available (un-deferral).
      **This waiver covers TRANSLATION ONLY.** The engineering half of the same
      area is NOT waived and is tracked as ordinary work, because none of it
      needs a native speaker: key parity across all 8 locales (test-enforced),
      the 62 product keys that exist in no bundle at all and render hardcoded
      English in every locale including ar-EG, the 8 aria-label keys that shipped
      as literal English into seven locales while labelled machine-translated,
      the stale generated accessible-name list (458 entries against a regenerated
      669), the 34 outdated keys, and RTL layout correctness. Do not let this
      checked row imply those are done.
- [x] Translated-but-unwired widget-chrome keys wired or removed — **RESOLVED
      2026-07-28: WIRED (owner decision: full localization).** All 605
      `ui.widgets.*` keys plus every hardcoded chrome string in widget
      families, page templates, WidgetFrame/WidgetHost, grid edit chrome, and
      chart primitives now resolve through `useMaybeT` (bundle under
      `I18nProvider`, ICU-formatted English fallback outside). ~520 new keys
      authored across `widgets.*`/`templates.*`/`frame.*`/`charts.*` in all 8
      locales; date names derive from Intl, not keys. Enforced by
      `packages/widgets/src/qa/widget-i18n-coverage.test.ts` (0 dead keys, 0
      dangling refs across the four owned namespaces, comment/id-shape aware)
      and per-family provider-vs-bare localization tests. The
      registry-parity quarantine of 35 dangling descriptions is emptied, and
      WidgetHost resolves `descriptionKey` through the translator (raw-key
      leak in the info popover fixed; browser-verified in de-DE against the
      seeded e2e app).

## Topology

- [x] Data-plane e2e matrix: sqlite / postgres / mysql, in CI on every push
- [x] Postgres-gated live suites run in the CI verify job (service container)
- [x] Desktop (Electron) e2e runs in CI
- [x] MySQL-as-meta-store leg boots a real server in CI: the composed server
      runs against pg and mysql meta stores with authenticated meta-backed
      traffic (`apps/server/test/meta-store-boot.test.ts`)

## Release engineering

- [x] Shipped migration checksums pinned against the published
      `@adminiumjs/meta@0.1.0` artifact (`migration-checksums.test.ts`)
- [x] Upgrading a store created by the released 0.1.0 build is proven:
      opens clean, applies only newer migrations, idempotent
      (`meta-upgrade-from-released.test.ts`)
- [x] Server update check reads only `v*` releases (other tag series, drafts,
      and prereleases excluded), selects by highest version
- [x] macOS signing — **the 2026-07-23 waiver is SUPERSEDED: macOS now ships
      signed.** The `desktop-v0.2.1` tag run signed both app bundles with a
      Developer ID, notarized and stapled both DMGs in a dedicated step (
      electron-builder's `mac.notarize` covers the `.app` only), and passed the
      strict verifier with zero warnings. All five Apple secrets live in the
      `desktop-release` environment; the repo-level secret count is zero. The
      verifier is fail-closed with no secret guard, so a cert-less tag produces
      an ad-hoc build, trips the check, and starves the release job.
      **Windows stays unsigned by the original waiver** — a SmartScreen
      trade-off, recorded in `docs/contributing/release-desktop.md`.
      **`desktop-v0.2.1` is PUBLISHED** (2026-08-18T14:53:22Z, 17 assets). The
      text here said it was still a draft for several hours after it went
      public; corrected 2026-08-18.
- [x] The desktop auto-updater resolves a release that carries installers —
      **it did not, for every shipped install on all three platforms, until
      2026-08-19.** electron-updater's GitHub provider resolves through
      `/releases/latest`, which is ONE stored pointer for the whole repository;
      it sat on `v0.2.1`, an npm release with zero assets, so every install
      404'd on `latest-mac.yml`. The failure was in TAG resolution, before a
      platform channel file is chosen, so Windows and Linux failed identically.
      Closed on three fronts: `apps/desktop/src/main/updates.ts` now resolves
      `desktop-v*` itself from the paginated releases LIST endpoint and pins a
      `generic` feed to that one release; `release.yml` creates `v*` releases
      with `--latest=false` so they cannot reclaim the pointer, pinned by
      `docker-contract.test.ts`; and the pointer was moved to `desktop-v0.2.1`,
      which rescues installs already in the field — their resolution is frozen
      in the binary and only the pointer can reach them. Verified:
      `gh api repos/MoSofi/Adminium/releases/latest --jq .tag_name` →
      `desktop-v0.2.1`, and all three channel files answer 200 under it.
- [x] An rc rehearsal ran the full npm + ghcr + Releases pipeline green before
      the final tag — **`v0.2.2-rc.0`, 2026-08-18, run 32132761130**, all four
      jobs green. 15/15 packages published under the `next` dist-tag with
      `latest` held at 0.2.1 and SLSA provenance present (so OIDC trusted
      publishing, not a hand publish); ghcr logged `move :latest = false`; the
      GitHub Release was created with `prerelease: true`.
      **Caveat, deliberately recorded rather than glossed:** `v0.2.2-rc.0` is a
      `v0.x` tag, and `v0.x` is exempt from this gate — so the prerelease
      *bypass* added for `v1.x` (see the note at the top of this file) did NOT
      execute on this run. What is proven is the publish pipeline, not the v1
      gate path; that still needs a real `v1.x` prerelease. Rehearsing at 1.0.0
      was rejected because reaching it needs a `major` bump the patch-only
      version policy forbids, and would declare v1.0 intent while the rows above
      are open.
- [x] This gate is enforced by CI on `v1+` tags
