# @adminium/adapter-sqlite

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

- @adminium/engine@0.2.7

## 0.2.6

### Patch Changes

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
- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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
- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/engine@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/engine@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/engine@0.1.0
