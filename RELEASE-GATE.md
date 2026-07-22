# v1.0 Release Gate

The checklist that must be fully checked before a `v1.*` tag may publish.
CI enforces it: the `release-gate` job in `.github/workflows/release.yml`
fails any `v1+` tag build while an unchecked `- [ ]` item remains here, and
every publish job depends on it. `v0.x` tags are exempt.

Rules: check an item only when it is verifiably true on `main` (test, CI job,
or recorded decision). An item that stops being true gets unchecked. Deciding
to waive an item means rewriting it to record the waiver and its rationale,
not deleting it.

## Performance

- [ ] Dashboard entry chunk meets its budget (350 KB gz target; ~648 KB today)
- [ ] Bundle-size gate runs in CI so the entry chunk cannot regress silently
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
- [ ] Decision recorded on `system:schema:remap` being able to disable PII
      masking (unmask escalation)
- [ ] External pentest booked, or explicitly waived with rationale

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
- [ ] Final locale/RTL audit pass over v1 surfaces
- [ ] Translated-but-unwired widget-chrome keys (~500) wired or removed

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
- [ ] macOS desktop artifacts signed + notarized in CI (Apple secrets), or the
      unsigned state is re-waived explicitly for v1
- [ ] A `v1.0.0-rc.*` rehearsal ran the full npm + ghcr + Releases pipeline
      green before the final tag
- [x] This gate is enforced by CI on `v1+` tags
