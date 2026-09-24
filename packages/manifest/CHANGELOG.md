# @adminium/manifest

## 0.3.0

### Patch Changes

- 64a1f12: **Apps send their own emails, and the log is a table you can read.**
  
  An app declares an outbox: its own table where every email is a row, the templates it ships (in
  every language it speaks), and what queues one — a row created, a column changed to a value, or a
  reminder a number of hours before a moment, at each person's chosen lead. Adminium sends them in
  the person's language, on the venue's clock and in its currency, and writes `sent`, `failed` or
  `skipped` with the reason on each row; a message that cannot be delivered after every try turns
  the row `failed`, and the desk can queue it again. Sample data, imports and undo never send mail,
  example addresses are never mailed, and a template given an HTML block is not sent. Templates are
  installed as the app's; an operator's edit is kept across updates. A column that holds nothing
  reads as empty, so a paragraph holding only an optional value is left out instead of printing its
  placeholder.
- d3a8058: **An app's own roles can see personal data where their work needs it, and an edit can be limited to some columns.**
  
  Personal columns (a patient's mobile, email, address, an allergy note) used to be shown in clear
  only to people who manage database connections, so an app's staff roles read them as empty and a
  clinic's reception could not ring anyone. A new table permission, `read_pii`, shows one table's
  personal columns: an app grants it as `table:@patients:read_pii`, and **People → Roles &
  permissions** has a **See personal data in records** row that grants it on every table. The table
  asked about is the one the value lives in, so a lookup from appointments to a patient's mobile
  needs it on patients. It applies to lists, single records, lookups, measures, dashboard cards,
  record pages and exports. A `*` action never includes it, so no existing role gains it. Live
  updates stay masked for everyone, and the public API is unchanged.
  
  An app role can limit what its edit permission on a table may change: `limits` on the role, per
  table, with `writable` columns and `writableValues`, the names public access uses. A clinician
  may move a visit from roomed to ready and nothing else; anything outside the limit is refused
  `403` `COLUMN_FORBIDDEN`, naming the column and the value. It covers editing one record, many at
  once, and rows edited from another record's form. Someone who also holds a role with an
  unlimited edit on the table, an Admin or Super Admin, is not limited. Saving the role in the
  permissions matrix keeps its limits, and an app update writes the new version's.
- 64a1f12: **Apps can take bookings against people's hours, not just seats per slot.**
  
  A table may carry a booking rule: the practice's opening hours and breaks, each person's own hours,
  closures (for everyone or one person), how many days ahead and how much notice, the slot grid, and
  which kinds of visit each person offers. Every write — a guest's, the desk's, an import's — is held
  to it on the venue's clock, and two people booking the last time at once get one booking. "Anyone"
  picks the first person free in the app's order. Availability answers free or full per time, and a
  strip of days open, full or closed; a person moving their own visit is not blocked by it
  (`exclude`). A cancellation inside the notice window is flagged on the row, and a guest cannot move
  a visit that late. `@adminium/public-client` gains `bookingTimes()` and `bookingDays()`.
- d3a8058: **Calendar pages plot by the right columns and open the page's own form; a few app fixes.**
  
  - A calendar opens on the month today falls in, and its day list on today. It used to open on a
    fixed month from the demo data, or on the month most rows were in.
  - An app can name a calendar's columns in its page's `config.calendar` (`start`, `end`, `title`,
    which may read through a foreign key such as `patient_id.name`, and `category`). Without it, a
    table with a booking rule is plotted by the booking's start instead of the first date in the
    table. On a page with a form, **Add event** and a click on an empty day open that form, with the
    day filled in.
  - KPI cards on calendar, scheduler, board, queue, log and directory pages read money in the
    connection's currency, as dashboard cards already did.
  - A link table with its own `id` and two foreign keys counts as a link between the two tables, so
    a chips field over it ("Visit types they do") reads and saves its rows. A form field may name
    the link table. A designed field that cannot be shown now says so in the form, and the install
    report and the server log name a field the install could not bind.
  - A create replies with the row as stored, its totals and balance included. It used to reply
    before they were added up, so a new visit showed no balance.
  - An app's email with no address on the row goes to the person the row links (or a first visit's
    own address), and the address is written into the row. A recipient whose language is not one of
    Adminium's gets the nearest template, with dates and times written their own way: `en-GB`
    reads "09:30".
- 64a1f12: **Columns Adminium fills in: stamps, balances, unique values and relative filters.**
  
  - A **stamp** writes the time, or who did it, when a row is made or a column changes to a value
    ("checked in at", "cancelled by"); a guest's write can stamp something else than the staff's.
  - A total can count only some child rows (`where`) and keep a **balance** (a fee less payments and
    write-offs). With **`cap`**, a change that would take a balance below zero is refused with
    `BALANCE_EXCEEDED`; a payment taken while another is being written waits for it.
  - A column can be **unique**, enforced by the database under the real table's name.
  - Public endpoints can filter on the venue's **today** or the days from today, allow a column only
    certain values, and change a row only while it is in a given state or still ahead.
  
  Studio's column inspector shows each of these rules.
- 64a1f12: **An app can have a second key for a kiosk, bound to a signed-in staff member.**
  
  A kiosk's key is served only to the screen of a staff member holding the app's kiosk role (a
  screens-only role with no data), and answers only beside that sign-in, from the same page, with
  its CSRF token on writes, and on the app's own staff host when one is mapped. The app switches it
  off from its settings row (`PUBLIC_KEY_OFF`); it stops with the staff side. Sessions found at a
  kiosk last three minutes, ask no proof of work, and count per screen. An app update rebinds it,
  revokes it when the app drops it, and never re-makes one an operator revoked. The API keys page
  marks it "Staff screen only".
  
  Also fixed: a staff member signed in on the same browser no longer breaks an app's public pages
  (the public API's requests are the key's, not the cookie's), and a screens-only person may call the
  public API.
  
  An app's staff screens also learn what the signed-in person may do: the staff config carries
  `access`, their read / create / update / delete on each of the app's tables and the app's roles
  they hold, so a screen can leave out a button whose write the server would refuse.
  
  A check-in can wait for its time: `writableWhen` takes a window on a time,
  `{starts_at: {within: 60}}`, meaning no more than 60 minutes ahead (a late arrival always
  passes). An earlier change is refused `409` `PUBLIC_TOO_EARLY` with the row's time and when the
  window opens (`params.at`, `params.from`), and only when the row is the caller's own and nothing
  but the window stood in the way; every other miss is still `404`. The public client reads them as
  `error.tooEarly`.
- 64a1f12: **An app's guests can find themselves, prove it by email, and see only their own rows.**
  
  - An app declares one **identity** per key (a patient found by mobile and date of birth); its other
    endpoints open that person's own rows, at the level each asks: found (`lookup`) or proved by a
    six-digit **code emailed** to them (`verified`). Codes last 10 minutes and take 5 tries; the
    requests and wrong tries are limited per session and per person; a person locked out by wrong
    tries is shown to the desk, which can lift it (`GET`/`DELETE
    /api/v1/data/:connectionId/:table/:recordId/claim-lock`). A person with a fresh code may change
    their address; the old address is told, and every session of theirs ends.
  - A signed-in person may hold only so many open rows (`PUBLIC_LIMIT_REACHED`), and a create can say
    where the new row stands (a waiting-list place).
  - A **human check** (a small proof of work) can guard a stranger's create and every claim.
  - A stranger's create can be limited per phone number or address a day and per key an hour, with
    names held to plain text.
  - Writes can be switched off from the app's settings row (`PUBLIC_SWITCHED_OFF`).
  - Email sign-in codes sent through an app's own key are signed with the app's name for its venue.
  - The notice to an old address after a change of email gives the practice's number to ring, when
    the app's outbox names a `phone` column of its settings row (`outbox.settings.phone`, a `text`
    column) and the row holds one; otherwise it still says to get in touch.
  
  `@adminium/public-client` gains `requestCode()`, `verifyCode()`, `session()`, `solveChallenge()`
  with a `humanCheck` option that answers the server, `createWithRank()`, and the new error codes.
- 64a1f12: **Sample data that follows the clock.**
  
  Sample rows can land on working days (`@workdays`), name a calendar day in the venue's zone, take
  a different status depending on whether their time has passed (`@byClock`), or be left out
  (`@skip`). Totals are settled after the load, so sample fees, payments and balances agree.
  
  A sample row that would repeat a unique value one of the operator's own records already holds (a
  weekday's opening hours, say) now stops the add with `SAMPLE_ROW_CLASH`, naming the table, the
  column and the value, instead of the database's own error. Nothing of the add is kept.
- ab31a89: **Apps can ask for public access for their guests, and staff sign in on the app's own address.**
  
  At install you see — and may untick — what an app's guests will be able to do (allowing it needs
  **Manage API keys**): which tables
  they read or write, through which methods and fields. Adminium makes the app its own browser
  key and endpoints; the key cannot be widened to unsafe methods. Availability endpoints answer
  "free" or "full" per time and nothing more; two guests booking the last seats at once get one
  confirmation and one "full". A guest finds their own booking by its code and mobile number (the
  number compared by its digits, however it was typed). Public replies give times as instants, so
  a guest in another time zone sees the venue's time. `@adminium/public-client` gains
  `availability()`, `fromTenantLocal()` and the new error codes (`PUBLIC_SLOT_FULL`,
  `PUBLIC_SLOT_BUSY`, `PUBLIC_TOO_LATE`, `APP_DISABLED`, `SURFACE_OFF`).
  
  On a domain mapped to an app's staff screens, the sign-in page is the venue's: its name and the
  app's, and "Opening <app>…" while the app loads. A first visit in a right-to-left language is laid
  out right to left before anyone signs in.
- ae41762: **Uninstalling an app now removes its domains and placement. An install now
  names a leftover table that belongs to a different app.**
  
  Uninstall removed the app's row and its bytes, but left its entries in
  `surfaces.domains` and `surfaces.apps` in place. The domains editor validates
  the whole map on every save. So one host still mapped to the removed app
  refused every later save with `unknown_surface`, including the save that
  maps that host to the app installed in its place. The only fix was editing
  the settings row by hand. Uninstall now drops every host mapped to the app,
  plus its placement, name, connection and instances, and lists the removed
  hosts in the `app.uninstalled` audit row.
  
  Installing an app over a same-named table from another app was refused as
  `COLUMNS_REQUIRED`, which suggested adding the missing columns. Adding them
  could not help: a client-portal `payments` table requires `invoice_id`, which
  the point-of-sale app never writes, so every payment it saved would still be
  refused. The planner now raises a `FOREIGN_TABLE` problem for an app when a
  reused table has a NOT NULL column with no default that the app does not
  declare. The problem names the column and says the table may belong to
  another app. Add-ons are exempt, because they reuse their host's tables.
- a795485: **An app update can add a link to a table it already has.**
  
  A new version of an app that adds an optional link column to one of its existing tables (an order
  pointing at a customer, say) used to be refused with "cannot be added to a table that already
  exists". It now installs: the column is added empty and linked to its table, on SQLite, PostgreSQL
  and MySQL alike, and on SQLite without copying the table. A link every row must have is still
  refused before anything changes, because the rows already there would have nothing to point at.
- ab31a89: **Installing an app checks every table first, and never writes anything you have not seen.**
  
  Before **Install**, the new **Check the tables** step lists each table the app needs: **New**,
  **Yours from an earlier install**, **Shared with another app** or **Name taken**. For a taken
  name you choose: use the table as it is (offered only when it is safe — a table with a required
  column the app never fills cannot be reused, and the page says why), rename the existing table
  out of the way (Adminium repairs its own pages, grants, label overrides and public endpoints
  that named it), or give the whole app a different prefix. Apps that ask for it get their tables
  under their own prefix (`pos_menu_items`), so another app's plain `payments` is never in the way.
  
  An install that stops part way answers `409 APP_INSTALL_INCOMPLETE` naming the stage and the
  tables already made; nothing is removed, and **Try again** finishes from where it stopped.
  Updating runs the same check for new tables and keeps the names an install already has; an
  update that cannot run lists every reason. An install made before its app used a prefix is
  offered **Rename to <prefix>…**, which previews every table and then renames them, with pages,
  grants, overrides and endpoints following.
  
  Uninstalling keeps your data unless a Super Admin ticks **Also delete its tables and data** and
  types the app's key; only tables the app created and no other app uses are dropped. Pages you
  edited stay as ordinary pages, the app's key is revoked at once, and a domain that pointed at the
  app answers `503 SURFACE_UNAVAILABLE` until you map it again. A reinstall recognises the tables
  it left.
- ab31a89: **App manifests can name their tables and columns in every language, and dashboards gain a day control.**
  
  A manifest's tables take `label`, `labelPlural` and `keyField`, its columns a `label`, and enum
  columns a label per value — plain text or a map keyed by language. Forms, grids, filters and
  dashboard cards use them, in the viewer's language.
  
  A dashboard page can show **Today / Yesterday / This week / Pick a day**; every card reads the
  chosen day on the venue's clock, and hourly bars are labelled by hour. `SegmentedControl` takes
  an `itemClassName`.
  
  Fixes: SQLite boolean updates, a SQLite `now` default on the server's wall clock, SQLite schema
  edits after another program changed the database, a public key's scope refreshing when the
  connection's time zone or currency changes, and a revoked key no longer answering after an
  uninstall.
- @adminium/add-on-contracts@0.3.0

## 0.3.0-rc.4

### Patch Changes

- ab31a89: **Apps can ask for public access for their guests, and staff sign in on the app's own address.**
  
  At install you see — and may untick — what an app's guests will be able to do (allowing it needs
  **Manage API keys**): which tables
  they read or write, through which methods and fields. Adminium makes the app its own browser
  key and endpoints; the key cannot be widened to unsafe methods. Availability endpoints answer
  "free" or "full" per time and nothing more; two guests booking the last seats at once get one
  confirmation and one "full". A guest finds their own booking by its code and mobile number (the
  number compared by its digits, however it was typed). Public replies give times as instants, so
  a guest in another time zone sees the venue's time. `@adminium/public-client` gains
  `availability()`, `fromTenantLocal()` and the new error codes (`PUBLIC_SLOT_FULL`,
  `PUBLIC_SLOT_BUSY`, `PUBLIC_TOO_LATE`, `APP_DISABLED`, `SURFACE_OFF`).
  
  On a domain mapped to an app's staff screens, the sign-in page is the venue's: its name and the
  app's, and "Opening <app>…" while the app loads. A first visit in a right-to-left language is laid
  out right to left before anyone signs in.
- a795485: **An app update can add a link to a table it already has.**
  
  A new version of an app that adds an optional link column to one of its existing tables (an order
  pointing at a customer, say) used to be refused with "cannot be added to a table that already
  exists". It now installs: the column is added empty and linked to its table, on SQLite, PostgreSQL
  and MySQL alike, and on SQLite without copying the table. A link every row must have is still
  refused before anything changes, because the rows already there would have nothing to point at.
- ab31a89: **Installing an app checks every table first, and never writes anything you have not seen.**
  
  Before **Install**, the new **Check the tables** step lists each table the app needs: **New**,
  **Yours from an earlier install**, **Shared with another app** or **Name taken**. For a taken
  name you choose: use the table as it is (offered only when it is safe — a table with a required
  column the app never fills cannot be reused, and the page says why), rename the existing table
  out of the way (Adminium repairs its own pages, grants, label overrides and public endpoints
  that named it), or give the whole app a different prefix. Apps that ask for it get their tables
  under their own prefix (`pos_menu_items`), so another app's plain `payments` is never in the way.
  
  An install that stops part way answers `409 APP_INSTALL_INCOMPLETE` naming the stage and the
  tables already made; nothing is removed, and **Try again** finishes from where it stopped.
  Updating runs the same check for new tables and keeps the names an install already has; an
  update that cannot run lists every reason. An install made before its app used a prefix is
  offered **Rename to <prefix>…**, which previews every table and then renames them, with pages,
  grants, overrides and endpoints following.
  
  Uninstalling keeps your data unless a Super Admin ticks **Also delete its tables and data** and
  types the app's key; only tables the app created and no other app uses are dropped. Pages you
  edited stay as ordinary pages, the app's key is revoked at once, and a domain that pointed at the
  app answers `503 SURFACE_UNAVAILABLE` until you map it again. A reinstall recognises the tables
  it left.
- ab31a89: **App manifests can name their tables and columns in every language, and dashboards gain a day control.**
  
  A manifest's tables take `label`, `labelPlural` and `keyField`, its columns a `label`, and enum
  columns a label per value — plain text or a map keyed by language. Forms, grids, filters and
  dashboard cards use them, in the viewer's language.
  
  A dashboard page can show **Today / Yesterday / This week / Pick a day**; every card reads the
  chosen day on the venue's clock, and hourly bars are labelled by hour. `SegmentedControl` takes
  an `itemClassName`.
  
  Fixes: SQLite boolean updates, a SQLite `now` default on the server's wall clock, SQLite schema
  edits after another program changed the database, a public key's scope refreshing when the
  connection's time zone or currency changes, and a revoked key no longer answering after an
  uninstall.
- @adminium/add-on-contracts@0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- ae41762: **Uninstalling an app now removes its domains and placement. An install now
  names a leftover table that belongs to a different app.**
  
  Uninstall removed the app's row and its bytes, but left its entries in
  `surfaces.domains` and `surfaces.apps` in place. The domains editor validates
  the whole map on every save. So one host still mapped to the removed app
  refused every later save with `unknown_surface`, including the save that
  maps that host to the app installed in its place. The only fix was editing
  the settings row by hand. Uninstall now drops every host mapped to the app,
  plus its placement, name, connection and instances, and lists the removed
  hosts in the `app.uninstalled` audit row.
  
  Installing an app over a same-named table from another app was refused as
  `COLUMNS_REQUIRED`, which suggested adding the missing columns. Adding them
  could not help: a client-portal `payments` table requires `invoice_id`, which
  the point-of-sale app never writes, so every payment it saved would still be
  refused. The planner now raises a `FOREIGN_TABLE` problem for an app when a
  reused table has a NOT NULL column with no default that the app does not
  declare. The problem names the column and says the table may belong to
  another app. Add-ons are exempt, because they reuse their host's tables.
- @adminium/add-on-contracts@0.3.0-rc.3

## 0.3.0-rc.2

### Patch Changes

- @adminium/add-on-contracts@0.3.0-rc.2

## 0.3.0-rc.1

### Patch Changes

- @adminium/add-on-contracts@0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- @adminium/add-on-contracts@0.3.0-rc.0

## 0.2.9

### Patch Changes

- @adminium/add-on-contracts@0.2.9

## 0.2.8

### Patch Changes

- @adminium/add-on-contracts@0.2.8

## 0.2.7

### Patch Changes

- @adminium/add-on-contracts@0.2.7

## 0.2.6

### Patch Changes

- 8fb86bf: The contract registry gains a fourth entry: `document-render@1` (bought
  2026-09-02), with two implementations in the same wave — `invoices` and `barcode-labels`
  — which is what gate asks of a new contract.
  
  It is the first contract an add-on uses to hand Adminium **bytes**. Every other
  one describes a conversation with a service: a carrier quotes and books, a
  personalizer prices an option, a transport delivers a message. This one takes a
  `DocumentSubject` — values only, no database handle, no connection, no clock —
  and returns rendered files. The subject is the only door, and it is frozen into
  the register row at render time, so a document stays what it was after the row
  it was drawn from is edited or deleted.
  
  What the conformance suite (`describeDocumentRenderer`) holds an implementer to:
  
  - every kind it names must `describe()`, with `label` and `help` as **records in
    all eight compiled locales** — never a key. There is no add-on bundle in the
    dashboard to resolve one against, so a `{key, fallback}` label would ship its
    English fallback to eight languages.
  - rendering the same subject twice is **byte-identical**. A renderer that stamps
    a clock or a random id fails here rather than on somebody's invoice.
  - money arrives as **integer minor units** and percentages as **basis points**;
    the arithmetic law itself belongs to the implementer, not the contract.
  - HTML output carries no `<script>`; PDF output is `%PDF-1.4` with a byte-exact
    xref table, asserted by parsing it back over a subject containing `é ß ø €` —
    and a kind declaring `coverage: 'ascii'` must REFUSE those glyphs rather than
    drop them silently.
  - a locale the implementer cannot draw refuses with `LATIN_ONLY` and names what
    it `dropped`; a missing required slot refuses `MISSING_SLOT`; an unknown kind
    refuses `UNSUPPORTED_KIND`.
  
  `@adminium/manifest` moves with it: an add-on may now declare
  `provides: [{contract: 'document-render', version: 1}]` and be installed, a
  setting may carry `help` beside its `label`, and `dashboard` joins the reserved
  key set — it is the host an add-on attaching to `*` is mounted under on a
  deployment with no host app, so an app of that name would make the attachment
  ambiguous.
  
  **No new slots.** `document-render@1` is drawn through the two ids that already
  existed, `record.actions` and `settings.add-on.panel`.
- Updated dependencies [ab6314e]
- Updated dependencies [8fb86bf]
- Updated dependencies [ce438a0]
  - @adminium/add-on-contracts@0.2.6

## 0.2.5

### Patch Changes

- @adminium/add-on-contracts@0.2.5

## 0.2.4

### Patch Changes

- @adminium/add-on-contracts@0.2.4

## 0.2.3

### Patch Changes

- 4d68dc9: Add-ons can now be installed, attached to a host, switched off per host, and
  uninstalled — and `manifests.manage` became a real permission.
  
  Plan 32 got a verified package onto local disk and stopped there. This is the
  first half of what happens next: the meta surface, the install planner, and the
  routes. It is deliberately not the whole runtime — see the end for what still
  refuses.
  
  **`adminium_manifests` already existed.** It has shipped since migration 0006
  with no repo, no writer and zero rows, and three planning documents recorded it
  as absent. So migration 0020 ALTERs rather than creates, adding `kind`, and
  `licenseKeyEncrypted` — a column plan 17 defers by name — is left in place and
  read by nothing rather than dropped, because it is empty and dropping a column
  is the one thing a migration cannot take back.
  
  **Attachments are a join table.** The wave's plan originally recommended two manifest rows keyed
  `(manifest_key, attached_to)` for an add-on attached to two hosts; that recommendation was withdrawn and the
  join table ratified. Three costs argue against it, and the third only became visible once the table turned
  out to be shipped: two rows mean two copies of the manifest document, which an upgrade must then rewrite
  atomically or leave one host on an older version; the credential FK becomes ambiguous, since a DHL API key
  belongs to the add-on rather than to one of its attachments, so disconnecting "the other one" either orphans
  a secret or deletes a live one; and it requires dropping and recreating the shipped
  `uq_adminium_manifests_manifest_key` across three dialects, against own "never edit a shipped migration". An
  attachment is a many-to-many fact and now has the table that models one. `disabledAt` lives there rather than
  on the manifest, so an add-on can be live on one host and off on another — which a single flag could not
  represent.
  
  **Credentials get their own key, not the DSN's.** `deriveKey`'s `info` parameter
  exists to keep purposes apart, and these are genuinely different: a DSN opens
  the operator's own database, an add-on credential opens a third party's API on
  their behalf. Sharing a key would mean a leak of either is a leak of both, and
  rotating one to contain an incident would silently invalidate the other. The
  ciphertext column is called `payload`, which none of the log-redaction patterns
  matched — `payload` is now redacted, along with `refreshToken` and `accessToken`.
  That will redact some innocent job payloads too; an un-redacted credential in a
  log costs more than a debugging session does.
  
  **`planInstall` is a document, not a step.** The consent dialog is the security
  surface, so what it shows had to be computable without side effects and
  renderable even when the answer is no — a refusal is data, not an exception that
  leaves the dialog with nothing to draw. The case that makes it non-trivial is
  the foreign key pointing *out*: two of the three shipped add-ons that declare
  tables reference tables they do not own (`design-studio.job_id → jobs`,
  `personalizer.product_id → products` and `order_line_id → order_lines`). Those
  belong to the host, so a reference resolves as internal, host, or unresolved,
  and only the third stops an install. A planner that only emitted DDL would find
  that at `CREATE TABLE`, having already created the other tables — on MySQL,
  which has no transactional DDL, permanently.
  
  **`manifests.manage` is grantable, in the same change that landed its first
  enforcement point** — which is the rule its own reserved list documents. It went
  to `operations` rather than `workspace`: installing an add-on runs its server half
  in this process, which is closer to starting a job than to changing a setting,
  exists precisely to stop it riding on `settings.manage`. The reserved set had four
  hard-coded copies rather than the two that were expected, and one of them is
  production code — `RESERVED_GRANTS` in the dashboard's `rolesApi.ts`, which the
  dashboard cannot import from `@adminium/meta`, so nothing detects drift and a key
  left there is silently dropped from the matrix with no error and no failing test.
  
  Applying a plan that needs new tables lands in the same release — see the
  add-on schema changeset — so an add-on whose tables the host database already
  has and one that brings its own both install completely.
  
  Uninstall deletes the meta rows and the package directory and touches the data
  source not at all, so every table an add-on brought stays with its rows; the
  reply says so, rather than leaving the UI to assert it. And 26's acceptance #8 —
  "a composeServer-level test that fails if a route is exported but unregistered"
  — finally has one. Nothing enforced it before: the M10 regression test checks a
  hard-coded URL list, audit coverage only sees routes that are registered, and
  the OpenAPI check reads the built spec. All three are blind to exactly the gap
  that shipped green twice.
- Updated dependencies [78cf75f]
  - @adminium/add-on-contracts@0.2.3

## 0.2.2

### Patch Changes

- @adminium/add-on-contracts@0.2.2

## 0.2.2-rc.0

### Patch Changes

- @adminium/add-on-contracts@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/add-on-contracts@0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

### Patch Changes

- Updated dependencies [1d7c7b4]
  - @adminium/add-on-contracts@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
