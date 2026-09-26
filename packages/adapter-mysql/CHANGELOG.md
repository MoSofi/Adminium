# @adminium/adapter-mysql

## 0.3.4

### Patch Changes

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

- ba8a4f2: MySQL `TIMESTAMP` columns hold the right instant whatever zone the database server or Adminium runs in. Writing a date and time to one through the API or a form no longer fails, and "still ahead", time windows, "from today", filters, reminders and an app email's due and sent times compare against the right hour. Values read back are no longer shifted, and an undo puts back the time it read. Adminium's connections to MySQL and MariaDB now run their session in UTC, so `NOW()`, `CURRENT_TIMESTAMP` and triggers inside Adminium's own statements run in UTC too. A `DATETIME` column that defaults to `CURRENT_TIMESTAMP` or updates on `CURRENT_TIMESTAMP` gets the UTC time for rows Adminium writes. `{"$generate":"now"}` in a public scope writes this server's clock into a column with no zone, the way a column rule's `now` does.
- Updated dependencies [a038c9a]
- Updated dependencies [e1742aa]
  - @adminium/engine@0.3.2

## 0.3.1

### Patch Changes

- @adminium/engine@0.3.1

## 0.3.0

### Patch Changes

- a795485: **MySQL: an allowed value with an underscore is read whole.**
  
  Reading a MySQL table's list of allowed values cut the end off any value containing an underscore
  (`gift_card` read as `gift`, `no_show` as `no`), so Adminium refused values the column allows, and an
  app update tried to change lists that were already right.
- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [a795485]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
  - @adminium/engine@0.3.0

## 0.3.0-rc.4

### Patch Changes

- a795485: **MySQL: an allowed value with an underscore is read whole.**
  
  Reading a MySQL table's list of allowed values cut the end off any value containing an underscore
  (`gift_card` read as `gift`, `no_show` as `no`), so Adminium refused values the column allows, and an
  app update tried to change lists that were already right.
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

- d97ac21: Measure the ReDoS budgets on a warmed call so a cold JIT cannot fail the build
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
