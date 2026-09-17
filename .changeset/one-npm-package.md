---
'@adminium/server': patch
---

**`@adminiumjs/adminium` now installs as one package.** The CLI carries the eleven internal
packages it loads inside its own tarball: engine, meta, i18n, llm, schema-import, manifest,
add-on-contracts, widgets and the three database adapters. An install no longer downloads
fourteen other `@adminiumjs/*` packages from the registry.

The bundled copies have no dependency lists, and the CLI declares only the third-party libraries
the server actually loads. So React, Radix, Leaflet, lucide-react, dnd-kit and TanStack Table,
which the dashboard uses and ships pre-built, are no longer installed with it. A fresh install is
about 170 packages and 150 MB, down from 245 packages and 220 MB.

- `npm install --omit=optional` now really gives a SQLite-only install. Before, pg and mysql2
  always came in through the adapter packages.
- The internal packages are no longer published. Their versions already on npm stay there for
  now. `@adminiumjs/public-client`, `@adminiumjs/manifest` and `@adminiumjs/add-on-contracts` are
  still published, for the repos that install them on their own.
