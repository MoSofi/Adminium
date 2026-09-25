# @adminium/adapter-postgres

## 0.3.2

### Patch Changes

- Updated dependencies [a038c9a]
- Updated dependencies [e1742aa]
  - @adminium/engine@0.3.2

## 0.3.1

### Patch Changes

- @adminium/engine@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [a795485]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
  - @adminium/engine@0.3.0

## 0.3.0-rc.4

### Patch Changes

- Updated dependencies [a795485]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
  - @adminium/engine@0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- @adminium/engine@0.3.0-rc.3

## 0.3.0-rc.2

### Patch Changes

- @adminium/engine@0.3.0-rc.2

## 0.3.0-rc.1

### Patch Changes

- @adminium/engine@0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- @adminium/engine@0.3.0-rc.0

## 0.2.9

### Patch Changes

- @adminium/engine@0.2.9

## 0.2.8

### Patch Changes

- @adminium/engine@0.2.8

## 0.2.7

### Patch Changes

- 5445805: **A dropped Postgres connection no longer takes the server down.** Reported
  against 0.2.6: onboarding moved the meta store onto a remote Postgres, and a
  while later the process died with
  
      Error: read EADDRNOTAVAIL
      Emitted 'error' event on BoundPool instance at: Client.idleListener
  
  `pg` reports a connection that dies as an `'error'` event, and an `'error'`
  event with no listener is an uncaught exception, so the process exits. Anything
  that ends a connection can trigger it: a laptop's network changing (macOS raises
  EADDRNOTAVAIL), a provider's idle cutoff, a failover, `pg_terminate_backend`.
  Which emitter reports the death depends on where the client was:
  
  - **idle in the pool**: the pool emits. The meta store's pool had no listener at
    all, and this was the reported crash. The data pool that reads rows already
    had one.
  - **checked out**: the client itself emits. pg-pool detaches its own listener
    for the checkout and kysely never attaches one, so a connection lost under a
    running statement, inside a transaction, or handed out again before the pool
    noticed crashed the process through **both** pools. The meta store holds a
    client for a whole migration pass and for a relocation's copy.
  
  Both pools now listen on the pool and on every client. A statement that was
  running still rejects with the error, where it is reported, and the next checkout
  opens a fresh connection. MySQL is unaffected: every `mysql2` pool connection
  already listens for its own errors.
- @adminium/engine@0.2.7

## 0.2.6

### Patch Changes

- 65f69df: **The Postgres session settings now actually apply.** Three ways they did not,
  all silent, all on connections Adminium opens to your own database.
  
  **An `options=` in the DSN outranked ours.** `pg` resolves connection parameters
  as `Object.assign({}, config, parse(connectionString))`, so the parsed
  connection string wins — the opposite of what this adapter's own comment
  claimed. A source DSN carrying `options=` therefore dropped `statement_timeout`
  and `lock_timeout` entirely, on a direct endpoint as much as a pooled one, with
  no error raised and nothing in the log: the rails were simply absent on every
  connection. The DSN's `options` is now lifted out of the connection string and
  re-joined after ours, so ours win a conflict — a repeated `-c key=value`
  resolves to the final assignment — while anything else the operator set, a
  `search_path` say, still survives. Theirs is kept across the pooler downgrade
  too, deliberately: a pooler refuses their startup options exactly as it refuses
  ours, and such a DSN should fail with a hint naming `options=` rather than have
  a setting discarded behind their back.
  
  **The pool that reads rows had no budget at all.** `createQueryEngine` built its
  pool bare while the adapter's own pools have carried rails since M3, so a runaway
  CRUD query — a bad filter over a large table — had nothing to stop it scanning
  until the client gave up. It now sends the data role's settings, through the same
  `buildSessionSettings` call the adapter makes, so the two cannot drift apart.
  
  `SET LOCAL` is not available as the pooler fallback there. Kysely speaks the
  extended query protocol, one statement per Parse, so there is no multi-statement
  message to carry a prelude in and the trick `PostgresAdapter` uses does not
  transfer. `query_timeout` is no substitute either: it abandons the client's wait
  and leaves the backend running, which is the opposite of the guarantee. So behind
  a transaction pooler that pool keeps working without a server-side budget, exactly
  as it did before — every mechanism that would impose one sets the timeout on a
  backend the pooler then hands to somebody else, which is precisely what refuses to
  do. Direct endpoints, and session poolers, get it. The connect guide now says
  which is which.
  
  Kysely holds a facade rather than the pool itself, because the refusal lands
  inside `connect()` and that is where the one-time downgrade has to live; handing
  it the raw pool would have turned the refusal into a hard failure and stopped
  Adminium reading rows from a Neon database at all. A refusal is attributed to
  the pool that was *used*, not to global state, so checkouts racing a rebuild
  retry against the new pool instead of failing outright.
  
  **And the pooled-endpoint hint sent you to fix the wrong thing.** It still read
  "use the direct/unpooled connection string" — copy from before the adapter
  learned to downgrade to a `SET LOCAL` prelude on the first refusal. That
  downgrade means a pooled string simply works and the hint is unreachable on that
  path: it can only fire *after* the retry, on a pool that no longer sends options
  of its own, so what was refused is the DSN's own `options=`. That is what it
  names now. The Neon and Supabase host rewrites stay on as the fallback, since
  they still resolve it.
- @adminium/engine@0.2.6

## 0.2.5

### Patch Changes

- @adminium/engine@0.2.5

## 0.2.4

### Patch Changes

- @adminium/engine@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [ac3f5e7]
  - @adminium/engine@0.2.3

## 0.2.2

### Patch Changes

- e52d7da: Recover schemas that four import paths were silently losing.
  
  - TypeORM: every entity declared with the documented `@Entity({ name: '...' })`
    object form was dropped, and a file using only that form failed outright with
    "no @Entity classes found in input". The decorator scan ended its search at the
    last `}`, which is the options object's own closing brace.
  - SQL: MySQL makes the constraint symbol optional, so `CONSTRAINT FOREIGN KEY
    (a) REFERENCES b(id)` parsed `FOREIGN` as the symbol and produced an index
    named `FOREIGN` instead of a relation.
  - SQL: `bit varying` / `varbit` mapped to `unknown` despite the parser building
    that two-word spelling exactly as it does `character varying`.
  - Postgres: `CREATE TYPE x AS ENUM ()` is legal, and the empty enum failed IR
    validation — one of them anywhere made the whole database un-introspectable.
    Valueless enums are now dropped with an `enum-empty` warning.
  - SQLite: CHECK-to-enum synthesis compared column names case-sensitively against
    case-insensitive identifiers, so `status TEXT CHECK (STATUS IN (...))`
    synthesized no enum and the column rendered as free text.
- d97ac21: Measure the ReDoS budgets on a warmed call so a cold JIT cannot fail the build
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
- Updated dependencies [2dffc12]
- Updated dependencies [08df45d]
- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/engine@0.2.2

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

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
