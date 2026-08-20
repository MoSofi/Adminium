---
'@adminium/i18n': patch
---

Defer the two data-io route bodies, and make the `page-wizard` template split real.

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
