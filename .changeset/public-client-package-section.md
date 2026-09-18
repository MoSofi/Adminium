---
'@adminium/docs': patch
---

**The packages page documents `public-client`, the one package it was missing.**

- **A new `@adminium/public-client` section** in [The packages, one by
  one](https://docs.adminium.dev/anatomy/packages/), placed at the end of the leaf block: the
  typed client for the scoped `/api/v1/public` surface, why it carries zero dependencies when it
  ships inside fifteen static SPAs, why `createPublicClient` returns `null` rather than throwing
  when a build has no server, the thirteen error codes and which one the client mints itself, the
  two refusals that are blunt on purpose, and the tenant-time and tenant-money helpers that exist
  because the obvious conversion reads the visitor's clock.
- **What keeps it in its lane, given that no dependency rule names it** — nothing in the
  repository imports it, it is the only package passing a `functions` coverage floor, and its
  published identity (`@adminiumjs/public-client`) is not its source name.
- **The page covered fifteen of the sixteen packages it claimed.** It now covers sixteen, with a
  summary-table row to match, and the snapshot date says which row was measured later.
