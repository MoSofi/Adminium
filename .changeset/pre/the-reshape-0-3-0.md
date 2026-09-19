---
'@adminium/server': minor
---

**0.3.0 — add-ons own pages, and 0.2.10 through 0.2.12 are withdrawn.**

The three releases between 0.2.9 and this one were cut as patches while a much
larger change was still landing, and each shipped a partial version of it. The
worst of them, 0.2.12, removed the invoices screen and bundled an add-on that
could not yet render its replacement. They have been unpublished. **0.2.9 is the
stable line**, and this release candidate is the whole change rather than a
fraction of it — everything those three releases described is in here.

What this release is:

- **An add-on can own a dashboard page.** A page declares a `ref`, the client
  bundle that renders it, and where it would like to sit in the navigation — a
  built-in group, or one the add-on brings with it. The host mounts it at
  `/add-ons/<key>/<ref>`, gives it a rail row, and publishes a versioned runtime
  for it to render against. Add-ons register their own message catalogues, so a
  page speaks the operator's language rather than falling back to English.

- **Invoices left the engine and became that add-on's page.** Ninety-seven
  files, eight locale catalogues and the end-to-end specs moved out. **The
  documents did not move** — same rows, same meta table, same routes; only the
  screen that opens them arrives differently. A workspace with invoice rows has
  the add-on adopted for it on the first boot after upgrading, with nobody
  present and nothing to click.

- **A page assistant that drafts in the page's own format.** The pages that
  build documents read the page you opened it from and the connection's
  readable tables through grant-checked tools, draft in that page's document
  format, and preview with that page's own renderer. It saves nothing until an
  operator enables actions and confirms, and the confirmation leaves an audit
  row.

- **A project folder developers can open, edit and commit.** The generated app
  becomes a directory on disk you can put under version control, rather than
  something that only exists inside the instance.

- **Designed create dialogs, column rules, filters and line items.** The create
  path across the product now matches the comps it was designed from.

- **An installed app or add-on survives a deploy that empties the data
  directory.** On a container without a volume, every deploy used to lose every
  package that the image did not happen to bundle at exactly the installed
  version. When a storage destination is configured, Adminium now keeps a copy
  of each installed package there and stages it back at boot.

Also in here: trusted proxies are configured explicitly rather than by hop
count, email links resolve against a configured public origin, and a revoked
role grant is no longer re-granted by the next boot's seed backfill.

This is a release candidate. It publishes under the `next` dist-tag, so
`npx @adminiumjs/adminium` still installs the stable line; reach it with
`@adminiumjs/adminium@next`.
