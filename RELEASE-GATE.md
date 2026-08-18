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

- [ ] Dashboard entry chunk meets its budget (350 KB gz target; ~648 KB today)
- [x] Bundle-size gate runs in CI so the entry chunk cannot regress silently
      (`apps/dashboard/scripts/check-entry-budget.mjs` runs at the end of the
      dashboard build, which the CI verify job executes)
- [x] `count=estimated` is backed by catalog statistics with an exact fallback,
      never a blind exact `COUNT(*)` (`apps/server/src/crud/list.ts`,
      proven live in `apps/server/test/crud-estimated-count.test.ts`)

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
- [ ] axe fingerprint baseline burned down to zero or each remaining
      fingerprint individually accepted with rationale
- [ ] AuthLayout brand-panel contrast resolved (needs a design decision —
      no token swap fixes it)
- [ ] VRT baselines regenerated on the CI platform after the token changes

## i18n / RTL

- [x] 8 locale bundles with parity tests; RTL audit and numeral policy done
- [ ] Final locale/RTL audit pass over v1 surfaces — **scheduled after the
      2026-08-03 translation pass** (all chrome is wired; ~520 new keys carry
      English placeholders in the 7 non-en locales until then; worklist in the
      owner's planning docs)
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
- [x] macOS signing — **WAIVED for v1.0, ship unsigned** (owner decision
      2026-07-23). Both desktop platforms ship unsigned for v1 (Windows already
      is); users see a Gatekeeper/SmartScreen prompt. The signing + notarization
      steps and the verify gate remain in desktop-release.yml, so enabling them
      later is a secrets change, not a code change.
- [ ] A `v1.0.0-rc.*` rehearsal ran the full npm + ghcr + Releases pipeline
      green before the final tag
- [x] This gate is enforced by CI on `v1+` tags
