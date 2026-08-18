# @adminium/adapter-postgres

## 0.2.2-rc.0

### Patch Changes

- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
- aabc4e1: Diagnose transaction-pooling (PgBouncer) Postgres endpoints. Adminium sets its
  session timeouts in the startup packet, which Neon `-pooler` hosts and Supabase's
  port-6543 pooler reject with a bare `08P01: unsupported startup parameter in
  options: statement_timeout`. That failure now maps to `UNSUPPORTED` with a hint
  naming the fix — use the direct/unpooled connection string — and the connect
  wizard shows the adapter's hint instead of the generic "verify the DSN" copy.
  
  Adapter remediation hints are now persisted alongside the driver message
  (`adminium_connections.last_error_hint`, migration `0013`), so a failing
  connection still explains itself on the Hub after a reload.
- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/engine@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/engine@0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/engine@0.1.0
