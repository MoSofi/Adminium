# @adminium/engine

## 0.3.24

### Patch Changes

- @adminium/widgets@0.3.24

## 0.3.23

### Patch Changes

- @adminium/widgets@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies [1ae61f2]
  - @adminium/widgets@0.3.22

## 0.3.21

### Patch Changes

- @adminium/widgets@0.3.21

## 0.3.20

### Patch Changes

- e663535: Three things an app's update to a larger version ran into:
  
  - An update may add up to 400 columns in one go (50 before). An app that gained 51 planned as installable and then stopped half-way at the tables step.
  - An update takes a column whose name the database reserves (`left`), as the app's first install does: every statement quotes its names. Before, the plan said installable and the update stopped with `RESERVED_IDENTIFIER`. Studio still tells a person who picks such a name.
  - A row that posts for itself (a posting with no `via`) is left out by its `unlessSet` or `only`, as a line under a parent is. Before, a refund line marked "not put back" still put one back on the shelf.
- @adminium/widgets@0.3.20

## 0.3.19

### Patch Changes

- 5cfc90d: An app update gives a column its foreign key when the app now declares it `fk` and the table kept it as a plain number (a column first written `"type": "int"` and later made a link, as Adminium Designer does when it adds an add-on's rule to it). Before, the update changed nothing in the database, so nothing that follows the link found the row's parent: a rule that posts a ticket's lines to an add-on never fired, and said nothing. The check lists the change and refuses it, by name, while rows point at a row that does not exist (`LINK_ORPHANS`). A line whose rule still has no link behind it is now refused when it is saved, instead of being saved and never posted.
  
  On SQLite, adding the link rebuilds the table, and the rebuild ended by checking every foreign key in the whole database: a row in some other table that already pointed at nothing stopped the update halfway. The rebuild now refuses only what it would break itself; what was already there is left as it was.
- Updated dependencies [be78bbb]
  - @adminium/widgets@0.3.19

## 0.3.18

### Patch Changes

- e27492d: An add-on may keep tables of its own. It is installed the way an app is: its tables under its own prefix in one database, its pages in a section of the sidebar, its roles, lists, starting rows, emails and sample data, with a check that shows all of it first. It can be updated and removed from Studio, and removing it keeps its tables unless you ask otherwise. Its public entries are served through the key of an app that names it, only once someone who may manage API keys allows it, and leave that key the moment the add-on is switched off for the app. A row can be opened by its own code. `adminium app check` reads the same vocabulary.
- Updated dependencies [ba7049f]
- Updated dependencies [ebf296b]
  - @adminium/widgets@0.3.18

## 0.3.18-rc.0

### Patch Changes

- e27492d: An add-on may keep tables of its own. It is installed the way an app is: its tables under its own prefix in one database, its pages in a section of the sidebar, its roles, lists, starting rows, emails and sample data, with a check that shows all of it first. It can be updated and removed from Studio, and removing it keeps its tables unless you ask otherwise. Its public entries are served through the key of an app that names it, only once someone who may manage API keys allows it, and leave that key the moment the add-on is switched off for the app. A row can be opened by its own code. `adminium app check` reads the same vocabulary.
- Updated dependencies [ba7049f]
- Updated dependencies [ebf296b]
  - @adminium/widgets@0.3.18-rc.0

## 0.3.17

### Patch Changes

- Updated dependencies [5209454]
  - @adminium/widgets@0.3.17

## 0.3.16

### Patch Changes

- @adminium/widgets@0.3.16

## 0.3.15

### Patch Changes

- @adminium/widgets@0.3.15

## 0.3.14

### Patch Changes

- @adminium/widgets@0.3.14

## 0.3.13

### Patch Changes

- 60e321d: An app that runs from its project folder now loses what you take out of its manifest. A page you delete is removed (one somebody edited is kept as an ordinary page), a role is removed with its grants, and the terminal says who held it. A table or a column that holds data is never dropped on the way: everything else is applied, and the question waits in Studio → Apps, where "Keep the data" leaves it in the database and out of the app, and "Remove them" (Super Admin, two clicks) drops it. The same question can be read and answered with `GET` and `POST /api/v1/project/apps/:key/removals`. A table or column that holds nothing is dropped without a question. A column that holds less than it did (a shorter text, a removed option, a value now required) is never changed in the database: the rows that no longer fit are counted and stay. A server (`adminium start`) never drops and never asks: it keeps the data, releases the table from the app and says so.
  
  The schema editor's edit document gains `dropColumns`, a narrow way to drop a column from a table that stays. Two fixes came with it: dropping a foreign key from an existing table now compiles on Postgres and MySQL, and on SQLite a column under a unique rule or a link is dropped in the table's rebuild instead of failing halfway.
- df91e11: Close what the review of running an app from its project folder found. A
  SQLite table rebuild that drops a column now needs Super Admin, as a plain
  column drop always did. A removal question is answered against the manifest
  the app runs on now, never an older one; a column of a table another app or an
  add-on uses is never dropped; a failed read is never taken for an empty table.
  A column the app stops declaring and keeps is made optional, so it cannot
  refuse new rows. A project's `.env` cannot switch a server into dev mode.
  Setting `apps.<key>.publicAccess` is applied on the next start by itself, and a
  server says when an app has public access its config does not allow.
- @adminium/widgets@0.3.13

## 0.3.12

### Patch Changes

- @adminium/widgets@0.3.12

## 0.3.11

### Patch Changes

- Updated dependencies [a63590a]
- Updated dependencies [a63590a]
- Updated dependencies [3e9fc5b]
  - @adminium/widgets@0.3.11

## 0.3.10

### Patch Changes

- @adminium/widgets@0.3.10

## 0.3.9

### Patch Changes

- Updated dependencies
  - @adminium/widgets@0.3.9

## 0.3.8

### Patch Changes

- 56c75af: An app's records page can open already filtered: `config.defaultFilters` lists up to six conditions (a column, an op and a value), used when nobody has chosen filters yet — a saved view, or the filters someone left the page in, still win. Online Ordering's Messages page can now hide the skipped rows every phone order without an email writes. An install refuses default filters it cannot read or that name a column the page's table does not have.
- Updated dependencies [83bc23e]
- Updated dependencies [56c75af]
  - @adminium/widgets@0.3.8

## 0.3.7

### Patch Changes

- @adminium/widgets@0.3.7

## 0.3.6

### Patch Changes

- 765bc4f: Adminium now has the shared core that apps for online ordering, event tickets and hotel stays are built on. An app can put a limit on what it sells (the orders in a pickup slot, the tickets of a type, a room type's nights), take an order together with its lines and price it before it is saved, move a record on its own once a time has passed, let a guest find their own orders by address or by a link of their own, send emails that list an order's rows with a QR code for each ticket, and show dashboard cards that count what is left. It is all declared in the app's manifest and checked wherever a row is written. Every released app still validates and installs on SQLite, Postgres and MySQL. What a running install will notice is listed at the end.
  
  **For app makers: the manifest.** The reference and six new app guides (orders with their lines, identity and own links, timed moves, undo of a status move, a shared menu, public pictures) cover each key. In short:
  
  - **Tables and columns.** A table's `unique` holds 1–8 sets of 2–4 columns that no two rows may share, made on install and on update. `index: true` puts a plain index on a foreign key that a limit or a total counts by. An install's check lists both (`add-unique`, `add-index`). New column rules: `lookup` (a code a guest types, such as a discount or presale code, finds its row), `normalize: "code"`, `code.renew` (a new code when a row changes hands), `copy.follow`, `perNight` (a stay's price night by night, with weekday and date adjustments), `rollup.count`, and totals that climb up to three rows high (options into a line, the line into the order). New formulas: `daysBetween` and `join`. Stamps gain `addMinutes`, `deadline` and `moment` (each with an optional `notAfter`), `on` a column's change, and `clearOnBack`.
  - **Limits.** `capacity` takes up to three rules of three kinds: `slot` (a rule with no `kind` reads as it always has), `parent` (a limit held on the row a line points at, with `window`, `perWrite`, `also`, `day`, `lockBy` and `reserved`), and `night` (rooms of a type, counted per night, with `pool`, `outOfService`, `fits`, `given`, `nights` and `arrived`). Any kind can take a `hold` that counts a row only until it runs out.
  - **Moments and states.** A moment is a time worked out from a row or a row it links to (`column`, `via`, `time`, `plus`/`minus`, fallbacks in `or`), and a time of day may be kept on the row (`time: { column }`). States gain `strict` (a ticket let in once is refused a second time), `late` (flag or refuse a move made close to a moment), `timed` (moves Adminium makes once a moment has passed, checked every minute), `effects` (a move, or a change of a link, that moves the linked row), `create.requires`, move conditions `requires.linked`, `requires.time` and `requires.setting`, `undo: true` moves, and `createIn`/`changeIn` for a parent's child rows.
  - **Public entries.** A create may carry its child rows two levels down (`children`, `agrees`, `counts`, `sumMax`, `plainText`) and may be tried without saving (`dryRun`). `expect` holds a save to the price the guest was shown, and `clientKey` makes a retried create land on the order already made. Also new: `identity` (find or make the person by the address typed), `shareLink` and `newLink` (a row's own link), `forget` ("delete my details", with `links: true` to stop their own links), `withhold` (with `unlessHolder` and `when`), `limits` on a guest's change, `unlockBy` (rows read only with a code), `pictures`, windows keyed to a moment, availability entries per limit kind (`rule`, `showLeft`, `under`), and `anonymous.perIpHour`. A token claim takes `own` and `address`.
  - **Emails and documents.** Outbox producers gain `onChange.changed`, `repeat`, `repeatBy`, `was` (`{{was.<column>}}`), `holdSeconds`, `recipient: { setting }` and `before.lead.at`. There is also `outbox.settings.replyTo`, `attach.optional` with blocks marked `withAttachment`, a rows block that lists an order's lines, `{{<link>.<column>.qr}}` and `.grouped` on code columns. Documents gain a nightly source, `collections`, `where`/`unless` on a collection and `form: "grouped"`, and add-on renderers get a `qr` slot type (`documentQrValueSchema` in `@adminium/add-on-contracts`).
  - **Roles, shared tables, sample data.** `roles[].limits[table].readable` limits what a role reads of a table, and `writable` is now optional. `shape: "menu@1"` lets two apps use one table; uninstalling either names the other and hands its rules over, and `SHAPE_IN_USE` refuses an update that would drop a shape the other app still uses. Sample data gains `weekAnchor` with `@week`, `@byStay`, `@slot` and `skipWhenShared`.
  - **Cards.** Filter groups (`or`/`and`, two deep, 16 conditions) and `day: "today" | "today±n" | "YYYY-MM-DD"`. Rankings with two or more figures answer paired bars (`values`, `aggregates`), and a ranking's `orderBy` can name a figure, the group or a column of the linked row. There are capacity KPIs (`taken`, `held`, `left`, `size`, `occupancy`, `earnings`), a list's `counts` with a `capacity-bar` cell ("N over" when over-sold), an `hour-of-day` bucket, `mini-table.secondary`, and nine new KPI icons. `subtitles`, `metricLabels`, `emptyState.titles`/`bodies` and `series[].labels` translate like `titles`, and an install checks a card's filters as every read does.
  
  **The public API and `@adminiumjs/public-client`.** `POST /api/v1/public/records/:ref` takes `children`, `expect` and, on an entry that keeps one, a retry key in its `clientKey` column (22–64 letters, digits, `-` or `_`); the reply carries `children` and `replayed`. Also new: `POST /public/records/:ref/dry-run` and `/:ref/:id/dry-run`, `POST /public/records/:ref/:id/new-link` (a verified sign-in, 5 a day per row), `POST /public/session/revoke-all` (sign out everywhere), `DELETE /public/account` (delete my details), the picture route, and availability per limit kind. New codes: `PUBLIC_SOLD_OUT`, `PUBLIC_NO_ROOM` (`night`), `PUBLIC_TOO_EARLY` (`at`, `from`) and `PUBLIC_PRICE_CHANGED` (`total`, and `lines` on a create). A refusal about a child row names it by `child`, `index` and `path`. A code a guest types travels in the `x-adminium-code` header, and a session ended from elsewhere is told once by `x-adminium-session-ended` (`elsewhere` or `forgotten`). The client adds `createTree`, `quote`, `quoteChange` (`{ data, exact, nights, children }`), `slotDays`, `parentAvailability`, `nightAvailability`, `newLink`, `signOutEverywhere`, `forgetMe`, `sessionEnded`, `adoptSession`, `now()`, the `session`, `onSessionChange` and `onSessionEnded` options, `newClientKey()`, `pictureUrl()`, and a `./qr` entry that draws a code as SVG.
  
  **Staff routes and the dashboard.** New data routes: `POST /api/v1/data/:connectionId/:table/dry-run` and `/:recordId/dry-run` (a create or change quote that takes no lock and keeps nothing; each night carries `base`), `GET …/capacity-counts` (`under=<column>&value=<v>`, or `ids=`), `GET …/:recordId/nightly` and `POST …/person` (the desk's find or add person). Creates and changes take `expect` (409 `PRICE_CHANGED`, with `column` and `total`), `clientKey` (answers `replayed: true`), `occurredAt` (a device's own time for a write sent late: at most six hours back and a minute ahead, kept in the audit row), and a PATCH takes `from`, the state the writer saw. New staff codes: `STATE_UNCHANGED`, `STATE_TOO_LATE`, `WRITE_WINDOW_CLOSED`, `FOLLOW_TOO_MANY`, `NIGHTLY_RATE_UNREADABLE`, the `CAPACITY_*` reasons on `VALIDATION_FAILED`, `UNIQUE_VIOLATION.details.columns`, and `COLUMN_FORBIDDEN` with `reason: "read-limit"`. The new Error codes page lists them all. A read limit holds on every staff read: lists, exports, search, cards, documents, the audit log, files and live updates. In the dashboard a record says when it will move on its own, and to what. The install wizard offers a menu another app already keeps, the page builder warns before it drops a card's day, counts or capacity binding, and every chart and map card has a **Show data** button that swaps the chart for a table of its figures (and a table screen readers read). The words of widgets and templates now load just after boot, which makes the dashboard's first download about 18 KB (gzip) smaller. Every new screen and message is in all eight languages.
  
  **Changes a running install will notice**
  
  - **Upgrading is one way.** Two meta migrations run on the first start: `0045_app_table_shapes` records the shape of each app table (and fills it in for apps installed before, so a Point of Sale menu is found by the next app that shares it) and `0046_public_sessions_ended` keeps why a guest's session ended. Once they have run, 0.3.4 refuses to start on that meta store ("migrated by a newer Adminium"). Going back means restoring the backup taken before the upgrade, so take one. Adminium snapshots only an embedded SQLite meta store for you: on Postgres or MySQL, run `pg_dump` or `mysqldump` of the meta database before you start this version.
  - **Deploy every server at once.** A slot limit now locks a whole venue day, not one slot, under a new lock name, so while servers of both versions run a slot can be oversold. An older server still running also drops an email's Reply-To, fails a template that reads `{{was.*}}` ("nothing fills"; set the message back to `queued` once every server is upgraded), and does not know a role's read limit. Emails with a QR code are queued in a newer form that an older worker dead-letters; every other email stays in the form both versions deliver.
  - **A lost race answers 409 `PUBLIC_SLOT_BUSY`.** A public write that lost to another writer at the same instant (the next number of a series, two writers on one row, a deadlock) used to answer 400 `PUBLIC_WRITE_REFUSED`; send it again. A public batch whose row is refused answers 400 `PUBLIC_WRITE_REFUSED` rather than 503. `PUBLIC_TOO_LATE` now reads "It is too late to make this change online."
  - **Lock waits end.** On Postgres, a write waiting for a slot's or a booking day's lock gives up after 10 seconds with 409 `CAPACITY_BUSY` or `BOOKING_BUSY`, as on MySQL. It used to wait as long as it took.
  - **`?code=` is refused.** A public list or availability read with `?code=` answers 400 `PUBLIC_QUERY_REFUSED`; a list used to ignore it. On Point of Sale's table availability, the new availability parameters are refused after the key is checked, so a bad key with one of them now answers 401.
  - **Point of Sale's slot limit.** A status step on a slot that is already over a lowered limit now goes through, and so does a bulk cancel. Everything else is judged as in 0.3.4.
  - **Creates nobody signed in for** through an entry with `anonymous` caps are also limited to 60 an hour from one visitor (409 `PUBLIC_LIMIT_REACHED`), and a per-address cap counts `ana+1@…` and Gmail's dotted spellings as one mailbox.
  - **Database details stay out of refusals.** On the staff data routes `UNIQUE_VIOLATION.details.detail` is always `null`: on Postgres it spelled out the other row's values, masked ones included. `constraint` stays.
  - **A child row under a locked parent** (Client Portal, Invoices) is refused with "…can be added only while…" when it is new, and `RECORD_LOCKED` carries `on: "create" | "change"`. The code and status are unchanged.
  - **A records-page save that changes a state** sends the state the form loaded. A row another screen has moved since is refused `STATE_MOVE_REFUSED`, where before it moved from wherever it was.
  - **`POST /exports` with an API key** answers 403 `FORBIDDEN`, not 500: an export belongs to a person.
  - **`GET /public/config`** answers `now`, the server's clock, and is never cached (`cache-control: no-store`).
  - **Three new reply fields.** `GET /bootstrap` answers `hasConnections`, true once any database is connected, so an empty home says there are no pages yet rather than asking for a database. A connection's schema lists each table's limits in `capacityRules`, each with its kind. In `GET /public/config`, an availability entry over a limit says which kind it answers in `capacity` (`slot`, `parent` or `night`); an app installed before this version answers without it until the app is next updated, and an update to the same version will do.
  - **Live updates follow role changes at once.** Each live update of a table is checked against the subscriber's roles when it is sent, so a role taken away holds from the next update. Card answers are also cached per venue day, so "today" moves at the venue's midnight.
  - **Grants for a least-privilege Postgres role.** A limit now reads the app's settings row whole (`SELECT *`), so a role granted only some of its columns needs `SELECT` on the whole table. The rows a limit counts from (ticket types, room types, a slot limit's hours) are read whole too. A total that climbs writes its parents' columns, and needs `UPDATE` on them: a write the role cannot finish is refused 403 `READ_ONLY_MODE` with `details.reason: "privileges"` before its first statement.
  - **Stricter manifest check.** An entry anyone may call cannot select a column marked personal, or read as personal by its name (say `personal: false` on one that is not). A copy, a stamp's copy or a formula that reads such a column lands it only in a column kept the same way, as the install already required: the check used to pass it, and the install then skipped the rule. Every released app passes.
  - **Packaging.** The npm package grows from about 19.3 MB to 20.2 MB. The server has a new runtime dependency, `qr`, and `@adminiumjs/public-client`, which had none, takes it for its new `./qr` entry; a page that does not import `./qr` bundles nothing more. Three dependencies move up a major version: nodemailer 10, intl-messageformat 12, and Electron 44 in the desktop app.
  - **Fixes.**
    - Installing an app that renames one of your tables out of its way no longer points the app's new links at your renamed table: Online Ordering over a Northwind-shaped database failed on Postgres and MySQL and was half-installed on SQLite.
    - A code rule on a column whose name reads as a secret (`link_token`) now makes its code. No released app is affected.
    - A formula, a copy or a stamp's copy into a column marked personal, reading personal data, is now written on install and on update. It was skipped when the column's own mark came after it, so the column stayed empty (a joined guest name, say). No released app is affected.
    - On SQLite a total over child rows is added up exactly: 1.500 × 0.33 now totals 0.50, as on Postgres and MySQL. A stored total is set right the next time one of its rows changes.
    - On Postgres an empty figure ranks last in a chart, as on MySQL and SQLite; it used to rank first. A ranking's `orderBy` now sets the main order; before, it only broke ties.
    - On MySQL and SQLite, hour and day buckets on the venue's clock stay right across a daylight-saving change.
    - Renaming a table in Studio carries the new name into the dashboard cards that read it.
    - A labelled KPI card at the default size keeps its value inside the card.
    - A board card with an empty `format.locale` no longer crashes, and an impossible `format.referenceTime` is refused instead.
- f14031f: Adding a column given "the current date and time" to a SQLite table that has rows works now. SQLite refuses to add such a column to a table with rows, whether it is required or not, so Studio's "add column" failed with "Cannot add a column with non-constant default". The table is now rebuilt with the new column instead: every row already there gets the current time as it is copied, and the review shows the rebuild. A table Adminium knows is empty still gets the column added in place. A SQLite rebuild that adds a time column is no longer reported as failed after it has already run: SQLite stores that column as a plain timestamp, and the check that compares the rebuilt table with the plan now accepts that.
  
  Installing an app on MySQL no longer stops halfway when the app reuses one of your tables whose key has to start numbering itself, and one of the app's new tables links to that table. MySQL will not change a key that a link already points at ("Cannot change column … used in a foreign key constraint"), and the install made the app's tables and their links first. It now changes the reused tables first (making the key number itself, widening a column, adding choices), then makes the app's tables, then adds any missing columns to the reused tables. A new table's link takes the key's type as it is after that change.
- Updated dependencies [d2abd74]
- Updated dependencies [765bc4f]
  - @adminium/widgets@0.3.6

## 0.3.5

### Patch Changes

- 77aba9a: A Postgres connection whose role may read and write rows but not create tables — the least-privilege role recommended for a production database — is no longer read-only. Adminium decided a connection was read-only when its role could not create a table in the default schema, so such a role could never save a row, even on tables it was granted `INSERT`, `UPDATE` and `DELETE` on. A connection is now read-only only when the role can write no table at all (and cannot create one), or when the server is a standby or the role's transactions are read-only by default. Where a role may write some tables and only read others, Adminium reads its grants per table: a table it may not change offers no New, Edit or Delete, a write to it is refused with 403 `READ_ONLY_MODE` before it reaches the database, and an import into it is refused before it starts. A write the database itself refuses for want of a right — a grant revoked in the last minute, a link row, a parent's total, an undo, or a MySQL table-access refusal — is the same 403 instead of a 500. Loading a page never waits on the source database to learn its grants. A connection added before this release keeps the read-only flag its last test gave it: press Test on the connection once to have it read again.
- 045e3ab: A Postgres `text[]` or `varchar[]` column is edited as a list. The form showed it as a plain text box holding the array's text, and saving anything typed there failed, because Postgres reads `red,blue` as no array at all. Such a column is now marked a list when its page is generated or its table's facts are read, the form edits it as chips — one per item, duplicates refused, at most fifty — and it is saved as the database's own array. MySQL and SQLite have no array columns, so nothing changes there.
- Updated dependencies [dd1c9c0]
- Updated dependencies [d12f866]
- Updated dependencies [045e3ab]
  - @adminium/widgets@0.3.5

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
  - @adminium/widgets@0.3.4

## 0.3.3

### Patch Changes

- 22f5722: A time written to a column that keeps a zone (a Postgres `timestamptz`, a MySQL `TIMESTAMP`) now keeps its zone for the whole write, on every engine: a `now` stamp or fill is the instant itself, and MySQL's UTC wall time is spelled only as the value reaches the database. A time sent without a zone for such a column is read on the Adminium server's clock — the clock Adminium already keeps zone-less times on — rather than in whatever zone the database's session was in: on Postgres that zone was never set by Adminium, and on MySQL it was UTC. Stamps, date bounds, slot and booking guards, and formulas all read the moment that is stored, and a filter on such a column with a time sent without a zone reads it on the same clock.
  
  A `default: "now"` in an app's manifest is filled by Adminium on every create, on every engine. On MySQL the table gets no database default for it any more (nor does a timestamp given "the current date and time" in Studio): the column is a `DATETIME` kept on the server's clock, and the database, its session in UTC, filled UTC's wall time instead — hours off wherever the server is not in UTC. A row written to such a table outside Adminium that leaves the column out now gets nothing there: it stays empty, or is refused if the column may not be empty. Adminium also fills a MySQL `DATETIME` whose database default is `CURRENT_TIMESTAMP` (one made before this, or one of your own) on its own creates, with the Adminium server's own time. Before, the database filled it, and since Adminium's session is in UTC it filled UTC's time. So on a server that is not in UTC, a row Adminium makes now holds a different time from a row another program writes to the same column, which the database still stamps in UTC. Adding a required time given "the current date and time" to a MySQL table that has rows adds the column empty, gives every row already there the server's current time, and then makes the column required: the review shows the two steps and says the rows are filled.
  
  A yes or a no is stored as the answer it names on every engine (SQLite used to keep `on` or ` true` as text), and `y` and `n` are read as Postgres reads them. Renaming a column in Studio now also renames it inside the rules of its table that read it: a `requiredWhen`, a `copy`'s link, a `notBefore` date, a formula. A public batch update reads the row through the caller's scope whenever a rule needs it, so a refusal never tells a stranger what a row they cannot see holds.
- Updated dependencies [1e00e94]
  - @adminium/widgets@0.3.3

## 0.3.2

### Patch Changes

- a038c9a: Removing an index in Studio drops that index by its own name on every database. It used to guess a name, so the drop failed on any index Adminium had not named itself.
- e1742aa: On SQLite, a change that has to rebuild a table with a unique column no longer fails with "object name reserved for internal use". An app update that adds a column or a choice value to such a table now goes through, and the column stays unique afterwards. Turning "Unique" off in the table designer now really lets duplicates in; before, the rebuild put the unique back and said the change was applied. A rebuild now puts a partial unique index (`WHERE deleted_at IS NULL`) and an index on an expression back as they were, and refuses, naming the column or the index, rather than quietly lose a column's collation (`COLLATE NOCASE`), a unique's `ON CONFLICT` rule, or a partial index on a column the change drops.
- @adminium/widgets@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [b1e2d35]
- Updated dependencies [9733a1c]
  - @adminium/widgets@0.3.1

## 0.3.0

### Patch Changes

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
- 64a1f12: **Dashboard cards speak the page's language and lead somewhere.**
  
  - A KPI card with a link is one button that opens it; nine new icons for front-desk cards.
  - A chart grouped by a link names each group by the row it points at ("Dr Rao", not 7), under
    your read and masking; a choice column's groups and record-list cells use its labels.
  - Money cards use the connection's currency unless they name their own.
  - A dashboard can end its day controls with one link ("Open the desk").
  - Card titles can carry translations, picked by the page's language.
  - A choice column's value labels an app ships in several languages are read in each person's own:
    a status pill, a chart legend and a form's choices say "Wartend" to a German reader and
    "Waiting" to an English one. A card that lists its own columns takes them from the answer too.
    Labels installed before stay as they were until the app is updated. A page's list, record,
    master-detail, queue and calendar say them too, as do the words of an inline list of allowed
    values in the form, the filters and the list; a page that names its own words keeps them.
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
- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [ab31a89]
  - @adminium/widgets@0.3.0

## 0.3.0-rc.4

### Patch Changes

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
- Updated dependencies [ab31a89]
  - @adminium/widgets@0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- @adminium/widgets@0.3.0-rc.3

## 0.3.0-rc.2

### Patch Changes

- @adminium/widgets@0.3.0-rc.2

## 0.3.0-rc.1

### Patch Changes

- @adminium/widgets@0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- @adminium/widgets@0.3.0-rc.0

## 0.2.9

### Patch Changes

- @adminium/widgets@0.2.9

## 0.2.8

### Patch Changes

- @adminium/widgets@0.2.8

## 0.2.7

### Patch Changes

- @adminium/widgets@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies [9f47a62]
  - @adminium/widgets@0.2.6

## 0.2.5

### Patch Changes

- @adminium/widgets@0.2.5

## 0.2.4

### Patch Changes

- @adminium/widgets@0.2.4

## 0.2.3

### Patch Changes

- ac3f5e7: FK chips in generated grids now show the referenced record's display value
  ("Drift & Fern") instead of the raw foreign-key id ("5"), wired through the
  existing `lookup=` machinery — no new server surface.
  
  The grid spec's `fk` block always defined `displayKey` (a row key carrying a
  pre-joined display value) but nothing ever populated it, so `FkChipCell` fell
  back to the raw id on every generated page and owners added a separate linked
  column just to see who a row points to. The missing fact was the referenced
  table's display column, which only the generator knows:
  
  - The crud composer stamps a new optional `fk.display` — the referenced
    table's classified display column — into each FK column spec, from a
    `displayColumns` map (`crudDisplayColumns`) built over the included
    candidate model. Stamping is pre-checked at generation time: skipped when
    the referenced display column is secret (the server hard-422s lookups on
    secret identifiers), when it IS the referenced column, and when the derived
    alias would shadow a real source-table column or break the server's alias
    grammar.
  - The dashboard interpreter (`withFkDisplay`) turns each `fk.display` into a
    `lookup=<name>__display:<name>.<display>` read param and stamps
    `fk.displayKey` so the chip picks the joined value up — on list pages,
    record pages, and record-page related tabs. Explicit lookup columns keep
    absolute priority inside the server's MAX_LOOKUPS=12 budget; derived params
    only spend what is left and drop deterministically (with a console note)
    beyond it. A column already covered by an explicit single-hop lookup of the
    same display value reuses that alias instead of spending budget on a twin.
  - Masking degrades honestly: a PII display column the caller may not read
    arrives as `null` + `_masked`, and the chip falls back to the raw id —
    never a blank chip.
  
  The field is optional and regeneration-composed: stored pages predate it and
  keep today's raw-id fallback untouched until their next regeneration (whose
  `generatedHash` move rewrites untouched generated pages in place — that hash
  move is the delivery mechanism, and the northwind baseline was re-recorded in
  this change to pin it). Columns re-added through the Studio column manager
  stay unstamped until regeneration — the schema reply does not carry the
  referenced table's display-column pick.
- Updated dependencies [7e5f704]
- Updated dependencies [8ed7972]
- Updated dependencies [ac3f5e7]
- Updated dependencies [9e1adf7]
  - @adminium/widgets@0.2.3

## 0.2.2

### Patch Changes

- 2dffc12: Stop a dead icon name costing a generated app its first paint, and put 64
  untranslated keys into the locale bundles.
  
  - `kanban-square` is not a lucide icon — it was renamed to `square-kanban`. It
    was emitted as `nav.icon` by the page generator, so any generated app with a
    workflow-shaped table fetched the entire ~137 KB icon catalogue on first paint
    to discover the name was dead, then drew the neutral `File` fallback anyway.
    A second instance, `bar-chart-3`, was found by the new gate.
  - `gen-icon-core.mjs` already computed the list of declared-but-unknown icon
    names and discarded it, printing only a count. It now fails in both `--check`
    and write mode, naming the offending file and the canonical rename.
  - `LUCIDE_ICON_NAMES` is now a real export. `allowedIcons` was documented as
    fed by it, that symbol existed nowhere, and nothing supplied the value — so
    the unknown-icon warning and the `table` fallback never fired and a model
    could store any hallucinated icon string on a table.
  - 64 `t()` keys existed in no locale bundle and rendered a hardcoded English
    default in all 8 locales, 56 of them the Settings → Languages & translations
    page itself — the one page whose keys the in-product translation editor
    cannot reach, because it refuses any key absent from the compiled bundle.
    All 8 bundles now carry them, translated rather than copied from English.
- 08df45d: Publish the IR JSON Schema the import guide has always pointed at, and accept the
  `$schema` key it tells you to write.
  
  `guides/schema-import/json-ir.md` has advertised
  `https://adminium.dev/schemas/ir-v1.json` since the page was written and no such
  document was ever generated — the URL 404'd. It is now derived from
  `databaseModelSchema` itself (`packages/engine/scripts/ir-json-schema.mjs`,
  committed as `ir-v1.schema.json` and served at
  `https://docs.adminium.dev/schemas/ir-v1.json`), so the published contract cannot
  disagree with the parser that enforces it. `--check` and a unit test both gate
  the artifact, for the same reason `openapi.json --check` exists.
  
  The page also told readers to reference it with `"$schema": "…"`, which made the
  document unimportable: every IR object is a Zod `strictObject`, so the key the
  guide recommended failed at `<root>: Unrecognized key: "$schema"`. `parseJsonIr`
  now strips a top-level string `$schema` — and only there, so snapshots and LLM
  responses keep the strict path. A non-string `$schema` is still someone's data
  and still fails loudly.
- 2684976: Infer the relations a schema implies but never declares, and let an accepted one
  survive the next regeneration.
  
  `RELATION_KINDS` has always listed `inferred-name` and `inferred-join-table`, and
  five consumers branch on them — `detectDomains` unions relations at confidence
  0.8, the column classifier promotes an accepted one to the `fk` semantic,
  `detectHierarchy` looks for a self-referential edge, the Studio remap editor
  renders an "inferred" bucket, and the LLM normalizer builds its heuristic
  baseline from them — but nothing ever wrote one. `model.relations` came
  exclusively from declared foreign keys. On a schema that declares none (MyISAM,
  legacy SQLite, most ORM-generated MySQL) that emptiness cascaded all the way to
  the screen: domains shattered into singletons so every table landed in
  "General", dashboards were skipped for want of a joined time axis, and every
  `*_id` column fell through to `external-id` — a monospaced string where an
  entity chip belonged.
  
  `applyInference` fills that in. Rule 1 resolves `customer_id` onto `customers`,
  scoring the evidence: an exact singular/plural match on an agreeing declared key
  reaches 0.90 and behaves like a declared FK everywhere, while every weakening — a
  role prefix dropped from `shipping_address_id`, a cross-schema hop, a name two
  tables answer to, types that merely rhyme — costs enough to land in the 0.5–0.79
  band instead. That band is the point: all four 0.8 gates exclude it, so a weak
  guess is visible to the remap editor as a suggestion without acting on anything.
  Rule 2 then reads the graph rule 1 just seeded and emits the many-to-many for a
  table that is nothing but two foreign keys. Hierarchy vocabulary (`parent_id`,
  `reports_to`) resolves to its own table, which is what finally lets the tree and
  org-chart triggers fire on a schema with no declared self-FK.
  
  Order is load-bearing and looks circular: join detection reads the `fk` semantic,
  which the column classifier derives from `model.relations`. So inference runs
  first, as its own function — `applyInference` then `applyClassification` — and
  deliberately not inside the classifier, which spreads `...model` and rebuilds
  only `tables`, discarding anything added within it. It runs in exactly one place,
  at introspection, so the snapshot carries the result and a `relation.remove`
  override stays removed instead of being re-derived on every run. A schema that
  declares its foreign keys is left untouched; nothing here ever emits 1.0.
  
  The second half closes a loop that was open at one end. The `relation.add` /
  `relation.remove` overrides were folded in on the read path only, so a relation a
  user accepted in Studio appeared in the schema browser and the data API — and
  then the next regeneration re-parsed the raw snapshot, saw none of it, and
  emitted pages with no FK chip, no related list, and no join. The user's
  correction was visible everywhere except the thing it was made to correct.
  Accepted relations now reach `generatePages` at confidence 1.0 with
  `kind: 'override'`, ahead of the wizard's table filter so an override into an
  excluded table is dropped by the same rule that drops a declared FK. One whose
  table or column the schema has since dropped is skipped with a warning naming it,
  rather than generating a page that cannot load.
- ef1c300: Let admins create and edit pages from Studio, and give every screen one gutter.
  
  Pages are now a first-class thing an admin can make. Studio gains a pages
  section — create, duplicate, reorder columns, pick an icon, choose a template —
  backed by page lifecycle routes on the server and the page repo and permission
  checks in `@adminium/meta`. Until now a page existed only as something the
  generator emitted from a schema snapshot, so a hand-made page had no way to
  fill its own body.
  
  `@adminium/engine` gains the entry point that makes that possible.
  `generatePages` composes a whole app and picks every template itself;
  `composeRequestedArchetype` composes one page but only for the nine archetypes,
  because it delegates to `buildArchetypeEnvelope` and that returns null for
  anything else. Neither serves an admin who picked `page-crud` for a table by
  hand, which is the most common choice. `recompose` is the missing third door:
  the same classify → candidates → compose prelude, dispatching to
  `buildCrudEnvelope` or `buildArchetypeEnvelope` as the template demands, so the
  server can rebuild a page's body from live schema instead of leaving it empty.
  Templates that are not table-bound — `page-dashboard` composes from a domain,
  and `page-builder`/`page-wizard`/`page-settings` are tool surfaces whose bodies
  the renderers ignore — return `bindable: false` with a null envelope, so the
  caller keeps whatever the page already had rather than blanking it.
  
  The second half is `PageSurface`. Every routed screen used to invent its own
  gutter — `p-6` here, `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing
  at all on the templates that forward straight to `@adminium/widgets` — so the
  padding changed every time you moved between two screens of the same app. Now
  each screen renders exactly one `PageSurface`, which owns the inner main
  section and is the only thing that can set the gutter; the shell's sidebar and
  topbar sit outside it and are unaffected. It takes `standard` (the density-scaled
  `--main-pad`), `none` for templates that draw their own full-bleed chrome, or an
  explicit x/y pair from a page's stored config, with `width: 'content'` as an
  independent knob for screens that are a short stack of controls rather than a
  grid.
  
  Chart and KPI text now has a legibility floor held by a test rather than by
  eye, and the theme control moved out of the header into the account menu as a
  verb-labelled item ("Light mode" / "Dark mode") that keeps its ⌘⇧L shortcut.
- Updated dependencies [0664dd4]
- Updated dependencies [2516a82]
- Updated dependencies [8477a70]
- Updated dependencies [cca257b]
- Updated dependencies [cca257b]
- Updated dependencies [8477a70]
- Updated dependencies [b204486]
- Updated dependencies [1002d67]
- Updated dependencies [8477a70]
- Updated dependencies [08df45d]
- Updated dependencies [66f0683]
- Updated dependencies [ef1c300]
  - @adminium/widgets@0.2.2

## 0.2.2-rc.0

### Patch Changes

- 2684976: Infer the relations a schema implies but never declares, and let an accepted one
  survive the next regeneration.
  
  `RELATION_KINDS` has always listed `inferred-name` and `inferred-join-table`, and
  five consumers branch on them — `detectDomains` unions relations at confidence
  0.8, the column classifier promotes an accepted one to the `fk` semantic,
  `detectHierarchy` looks for a self-referential edge, the Studio remap editor
  renders an "inferred" bucket, and the LLM normalizer builds its heuristic
  baseline from them — but nothing ever wrote one. `model.relations` came
  exclusively from declared foreign keys. On a schema that declares none (MyISAM,
  legacy SQLite, most ORM-generated MySQL) that emptiness cascaded all the way to
  the screen: domains shattered into singletons so every table landed in
  "General", dashboards were skipped for want of a joined time axis, and every
  `*_id` column fell through to `external-id` — a monospaced string where an
  entity chip belonged.
  
  `applyInference` fills that in. Rule 1 resolves `customer_id` onto `customers`,
  scoring the evidence: an exact singular/plural match on an agreeing declared key
  reaches 0.90 and behaves like a declared FK everywhere, while every weakening — a
  role prefix dropped from `shipping_address_id`, a cross-schema hop, a name two
  tables answer to, types that merely rhyme — costs enough to land in the 0.5–0.79
  band instead. That band is the point: all four 0.8 gates exclude it, so a weak
  guess is visible to the remap editor as a suggestion without acting on anything.
  Rule 2 then reads the graph rule 1 just seeded and emits the many-to-many for a
  table that is nothing but two foreign keys. Hierarchy vocabulary (`parent_id`,
  `reports_to`) resolves to its own table, which is what finally lets the tree and
  org-chart triggers fire on a schema with no declared self-FK.
  
  Order is load-bearing and looks circular: join detection reads the `fk` semantic,
  which the column classifier derives from `model.relations`. So inference runs
  first, as its own function — `applyInference` then `applyClassification` — and
  deliberately not inside the classifier, which spreads `...model` and rebuilds
  only `tables`, discarding anything added within it. It runs in exactly one place,
  at introspection, so the snapshot carries the result and a `relation.remove`
  override stays removed instead of being re-derived on every run. A schema that
  declares its foreign keys is left untouched; nothing here ever emits 1.0.
  
  The second half closes a loop that was open at one end. The `relation.add` /
  `relation.remove` overrides were folded in on the read path only, so a relation a
  user accepted in Studio appeared in the schema browser and the data API — and
  then the next regeneration re-parsed the raw snapshot, saw none of it, and
  emitted pages with no FK chip, no related list, and no join. The user's
  correction was visible everywhere except the thing it was made to correct.
  Accepted relations now reach `generatePages` at confidence 1.0 with
  `kind: 'override'`, ahead of the wizard's table filter so an override into an
  excluded table is dropped by the same rule that drops a declared FK. One whose
  table or column the schema has since dropped is skipped with a warning naming it,
  rather than generating a page that cannot load.
- ef1c300: Let admins create and edit pages from Studio, and give every screen one gutter.
  
  Pages are now a first-class thing an admin can make. Studio gains a pages
  section — create, duplicate, reorder columns, pick an icon, choose a template —
  backed by page lifecycle routes on the server and the page repo and permission
  checks in `@adminium/meta`. Until now a page existed only as something the
  generator emitted from a schema snapshot, so a hand-made page had no way to
  fill its own body.
  
  `@adminium/engine` gains the entry point that makes that possible.
  `generatePages` composes a whole app and picks every template itself;
  `composeRequestedArchetype` composes one page but only for the nine archetypes,
  because it delegates to `buildArchetypeEnvelope` and that returns null for
  anything else. Neither serves an admin who picked `page-crud` for a table by
  hand, which is the most common choice. `recompose` is the missing third door:
  the same classify → candidates → compose prelude, dispatching to
  `buildCrudEnvelope` or `buildArchetypeEnvelope` as the template demands, so the
  server can rebuild a page's body from live schema instead of leaving it empty.
  Templates that are not table-bound — `page-dashboard` composes from a domain,
  and `page-builder`/`page-wizard`/`page-settings` are tool surfaces whose bodies
  the renderers ignore — return `bindable: false` with a null envelope, so the
  caller keeps whatever the page already had rather than blanking it.
  
  The second half is `PageSurface`. Every routed screen used to invent its own
  gutter — `p-6` here, `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing
  at all on the templates that forward straight to `@adminium/widgets` — so the
  padding changed every time you moved between two screens of the same app. Now
  each screen renders exactly one `PageSurface`, which owns the inner main
  section and is the only thing that can set the gutter; the shell's sidebar and
  topbar sit outside it and are unaffected. It takes `standard` (the density-scaled
  `--main-pad`), `none` for templates that draw their own full-bleed chrome, or an
  explicit x/y pair from a page's stored config, with `width: 'content'` as an
  independent knob for screens that are a short stack of controls rather than a
  grid.
  
  Chart and KPI text now has a legibility floor held by a test rather than by
  eye, and the theme control moved out of the header into the account menu as a
  verb-labelled item ("Light mode" / "Dark mode") that keeps its ⌘⇧L shortcut.
- Updated dependencies [ef1c300]
  - @adminium/widgets@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/widgets@0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Rework the CLI setup wizard's prompts, output, and ending.

  The wizard now has a visual grammar: one continuous vertical rail down the left margin with a glyph per step — `◇` settled, `◆` current, `▲` wants attention. Previously every line printed at column 0, so a seven-step flow read as an undifferentiated transcript with no way to tell decisions from narration. Adds width-correct clipping (styling applied after the clip, since escape codes otherwise measure as visible columns and can be severed mid-sequence), word-boundary wrapping for prose, and a scrolling viewport for long pickers — a frame taller than the terminal cannot be rewound without the redraw eating the lines above it.

  Also lifts the wizard's pre-hidden-table rule into `@adminium/engine` as `isPreHiddenTable`. The Studio hid Adminium's own `adminium_*` store, other tools' migration bookkeeping, and join tables from its first commit, while the CLI wizard was still offering `adminium_users` as a table to build an admin panel over — generation declines to page all three regardless, so that selection could never be honoured. One rule, beside the classifier that assigns the roles, shared by both front doors.

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- Updated dependencies [1d7c7b4]
  - @adminium/widgets@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/widgets@0.1.0
