# @adminium/adapter-postgres

## 0.3.4

### Patch Changes

- 4d26196: Updating an installed app in place now gives it what a fresh install of the new version has.
  
  - **New public access, with your say.** When a new version adds to what the app's customers can do (Client Portal 0.2.1's enquiry form, say), the update's check now shows what is new on the install's own "Allow this public access" card. Once you allow it, the app's own guest key gets exactly that. Before, the new endpoint was saved but the key never reached it, and there was no way to give it: the form answered nobody. Allowed, the key gains what the version declares and nothing else. Not allowed, it gains nothing, and the reply lists what was left out and why. A change the app's key may not take (seeing more columns of an entry it has) is shown as kept as it is. Only someone who may manage API keys can allow it; for anyone else the update goes ahead without it and says so. The box starts ticked for an app that has its public access, and unticked for one installed without it. Through the API, an update gives what a version adds only when it sends `publicAccess: true`: without it, nothing new is given (before, it was given unless the request said `false`). What a key gains or loses is in the audit log, written the moment it changes, even when a later step of the update fails.
  - **What a version drops is always taken back.** On every update, whatever you answer on the check, each of the app's keys loses the entries the new version no longer declares, and a second key whose name it no longer declares is revoked. Before, this happened only when the new version still declared some public access, when the guests' key had not been revoked, and when nothing else in the refresh failed first: an update to a version with no public access, or after you revoked the guests' key, left the app's keys serving every entry the old version had, and a shared link's key kept opening its rows. A key already holding something no longer allowed (a column a guest writes that Adminium has since started filling itself) still loses what the version drops; before, it kept everything.
  - **A staff screen's key never opens to a link on its own.** When a new version turns a key served only beside a staff sign-in into one a shared link opens, the update's check now says so, and the key stops asking for the sign-in only when you allow it. Before, it was unlocked silently.
  - **Shared links keep opening.** An update revoked the key a shared link opens its row with (a key declared with no staff sign-in, like Client Portal's `handover`), and never made it again. So every handover link a studio had already sent stopped opening. That key is now kept for as long as the version declares it, and taken back only when a version drops it. A staff-bound key (Clinic Desk's `kiosk`) was already kept and still is.
  - **New columns keep their rules.** A column an update adds now comes with its `unique` rule and its fixed default, as it does on a fresh install. Before, Client Portal's `invoice_lines.time_entry_id` let the same hours go on two invoice lines on an updated install, and a new count or switch stayed empty where a new install fills it. On SQLite the rule is a unique index, added in place: the table is not copied. An update or Studio edit that adds such a column to a table with rows is refused, before anything changes, if it would give every row the same default. Adding two such columns in one change no longer fails with "already exists" on Postgres and MySQL. Removing a column that has a unique rule in Studio's table designer no longer fails on Postgres and MySQL (it dropped the rule's index twice, or by a guessed name), and a MySQL table with a yes/no default can be saved there again: its default, read back as `0` or `1`, was refused as not a yes or no.
  - **Unique rules an install has, an update has too.** A column that is there without the unique rule its app declares (one an earlier update added without it, or a table you made) is given the rule by the next update. The check first makes sure no two rows already hold the same value, and names the column if they do; nothing changes until they differ. A number counted per parent row that an update adds is unique together with its parent, as on a fresh install. On MySQL, a unique text column longer than 768 characters, which MySQL cannot index, is refused on the check, at install and on update alike. Before, the install failed halfway, and the update added the column, failed at its rule, and succeeded on a second try without it.
  - **SQLite text defaults stay as they were.** Rebuilding a SQLite table, which an update does to add a choice value, declared `DEFAULT 'queued'` again as `DEFAULT '''queued'''`. So a row written outside Adminium read `'queued'` with its quotes, and every later rebuild added another pair. SQLite and Postgres defaults are now read as their values. A MySQL `tinyint(1)` whose default is true keeps it when the column is changed; it used to become false.
  - **Desktop local databases keep text defaults.** A local SQLite database the desktop app makes from a schema declared a text column's default `true`, `null` or `007` as the number 1, no default, and 7. Each default is now read by its column's type.
  - **Sample data after an update.** After an update added columns to a table, every sample row in it read as changed, so removing the sample kept all of them and everything they point at. A column added since the sample was written now counts as changed only when a value other than its default has been put there.
  
  Released apps lost no keys: Clinic Desk's kiosk key is staff-bound and was kept, and Point of Sale has no second key. No released update so far (Clinic Desk 0.2.0 to 0.2.1, Point of Sale 0.2.1 to 0.2.2) adds a public entry, a unique column or a column with a default either, so there is nothing to do after upgrading. One exception is a Point of Sale install first made at 0.1 and updated to 0.2. It never got the public access 0.2 added (its customers' table booking answers nobody), and 0.2's new columns came without their defaults, so a new ticket that leaves them out gets an empty `guests` or `held`. Allow the public access the next time you update the app. Set those defaults in Studio's table designer, or uninstall and install the app again.
- 4d26196: A date column now reads as `YYYY-MM-DD` text on every engine. Postgres and MySQL handed a `date` back as a JavaScript date at the server's local midnight, so its JSON spelling named the day before on a server east of UTC (`2026-08-14` read as `"2026-08-13T22:00:00.000Z"` in Berlin), and exports, API replies and anything that printed or compared it moved with the server's time zone. SQLite already answered `"2026-08-14"`; Postgres and MySQL now do too. For integrators: the REST API, the public API, webhooks, automations, exports and project code now receive a date column as `"2026-08-14"` from Postgres and MySQL where they received an ISO instant before. Code that did `new Date(value)` on it gets UTC midnight of that day, so read it as a day (split the text, or format it in UTC), not in the local zone. `timestamp`, `timestamptz`, `DATETIME` and `TIMESTAMP` columns are unchanged. Sample data added before this version still removes cleanly: a sample row is measured the way it was recorded, so only a row whose date was really changed is kept.
  
  Automations read a date column as its day too. A condition such as "within the last 3 days", "more than 7 days ago" or "in the next 2 days" on a date column compares calendar days on the server's clock, the same whether it is checked when a record changes or by a schedule's scan, on every engine; it used to compare the date as midnight UTC when a record changed, so on a server west of UTC an invoice due on the 14th counted as past from the evening of the 13th while the scan disagreed, and SQLite's scan used the UTC day. A rule watching a date "updated" column carries on where it stopped: its stored position and the records it already ran for are read as they were stored, so the first check after upgrading neither reads the day again nor runs a rule twice for the same change.
  
  The page a sign-in link opens greets the person by the first word of the name the app declares for them (its outbox recipient's `name`), and with none declared by the first text column the entry shows that is not the address. It used to read the entry's first column, so an entry listing `id` first greeted nobody, and one listing a company first greeted by the company. It never reads a number, a date, the address, a key (the entry's own, even a text one, or one naming another row) or a column the entry does not show, and it still finds the declared name after `/apps/:key/rename-tables` has moved an old install's tables to the app's prefix: a table rename now carries the new name into the app's stored outbox as well.
  
  An app installed on one connection can no longer be installed again on another. The plan for the second connection says so, naming the connection it is on, and an install sent anyway is refused `409` `APP_INSTALLED_ELSEWHERE` before anything is written. It used to move the app's record to the second database and leave the first one's tables, customer key and links serving on their own. Updating it where it is works as before.
  
  An app's email template that asks a column for a form its type does not have (`{{invoice.due_on.date}}` on a date column, which has only `{{invoice.due_on}}`, `.day_month` and `.days_since`) is refused at install and on update with `EMAIL_TEMPLATE_INVALID`, naming the template, its language and the variable. It used to install, and every message it made then failed at send with "nothing fills". Client Portal 0.2.0 has eight such variables and is now refused; 0.2.1 reads them correctly. Point of Sale and Clinic Desk are unaffected.
  
  A refusal because a row is linked from another (`lockLinked`) names that table by its own name in `details.linkedFrom`, and a child row refused for its parent's state names the parent the same way in `details.parent`, never with a schema in front (`main.`, `public.`, a MySQL database name). And a `lockLinked` link that can no longer be followed (its relation removed in Studio, its foreign key or a kept column dropped) no longer stops keeping anything without a word: nothing new may be linked through it, refused `409` `RECORD_LOCKED` with `details.unresolved: true`, until the relation is put back or the states are changed.
  
  A zip export works on a server west of UTC. Each entry is stamped with a fixed time so two exports of the same config are identical; that time was midnight UTC on 1 January 1980, which is still 1979 in the Americas, where the zip writer refused it and the export failed. The stamp is now noon on that day in the server's own time, which a zip stores the same in every time zone.
- Updated dependencies [4d26196]
  - @adminium/engine@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [22f5722]
  - @adminium/engine@0.3.3

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
