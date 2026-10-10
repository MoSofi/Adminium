# @adminium/add-on-contracts

## 0.3.23

## 0.3.22

### Patch Changes

- d339d27: Automations reach one row further, and say what to write when a value is missing. A rule can name a column of the row its record links to (`customer_id.email`): as an email's recipient, and as a placeholder. A placeholder can carry a backup (`{{first_name|there}}`), written when the value is not there; an email block can be tied to a value (shown only when it is there, with other words in its place for a text or a heading). The email editor draws each placeholder as a chip that asks for its backup, has a Visibility section on every block, and previews the email as a reader with no values is sent it.
  
  An installed add-on can give Automations a step. The add-on's manifest says what the step is called, what a person fills in, and the one row of its own table the step makes (`addOn.steps`); the builder offers it under "From add-ons", and a rule runs it through the same write as "create a record", so the add-on's own rules, mails and events follow. A rule keeps a step whose add-on was removed and says which add-on it lost. A personal column of the record may be read only for an input the add-on itself keeps personal, and is never written to a run's log. A rule that holds such a step is checked again when it is switched on.
  
  An add-on can also say what its tables are, in one line each, and offer questions for its own pages (`addOn.assistant`). The assistant reads the lines when it describes a table and shows the questions on the add-on's pages. An add-on cannot give the assistant a tool, switch anything on, or widen what a person reads.
  
  On Automations the assistant drafts a whole rule: it looks up the live templates, the address columns, the roles and the steps add-ons give before it drafts, and says what it left out. The draft's card is drawn by the builder itself. With a rule open, a change is put into that rule's unsaved draft ("Apply to this rule"), marked, and undone with one click; nothing is saved until the person saves.
  
  Manifests that use the new words need Adminium 0.3.22 or later.

## 0.3.21

## 0.3.20

## 0.3.19

## 0.3.18

### Patch Changes

- a4f5e36: Fixed: an app removed with its tables kept and installed again lost track of its sample data, so the sample could no longer be removed with one button. Fixed: an app made with `adminium app new` on a release candidate asked for that candidate as its minimum Adminium; it asks for the release. Installing an add-on whose code decides while a record is saved, from a package nobody vouches for, now says before and after the install that this code will not run. Adminium Designer asks before it builds on an add-on that is in the server's store and not installed, naming how many tables it adds, and the app check warns when a rule takes stock and never gives it back. An add-on's own pages are told the currency of their database (`useAccess().currency`), and the bar at the foot of such a page reaches the page's edges.
- ba7049f: The manifest learns the words an add-on with its own tables needs: an add-on may declare pages, roles, emails, documents and sample data like an app; ledgers and the rows that post into them; a price an add-on lowers; rules an app ships; buttons on a record; a role's grant on an add-on's table; what a typed code may find. This release reads and checks them. A manifest that uses one is refused at install until the release that runs it.
- 2293c47: A table's rows can post into a ledger an add-on keeps — stock, the money on a gift card — in the same save. A rule on the table (`postings`) says when a row is held, taken and given back; when a save reaches one of those moments Adminium asks the add-on's own code which rows to write, checks the answer and writes them with the row, or saves nothing. An order's lines post with their order. While something of a row is held, what the rule read of it cannot change and the row cannot be deleted until it is put back. A hold ends at the time its row says, by the minute job. Ways of writing many rows at once (a bulk edit, an undo, an import of changes) are refused by name when a row would post, and a list's bulk change is then sent row by row through `POST /data/:connection/:table/one-by-one`. A dry run answers what each ledger would say, without writing. When the add-on cannot be asked, a give-back always goes through, and a take only where the add-on says its rows may be taken unasked; what went through that way is recorded later. A workspace owner can draw rules of their own on any table, switch any rule off, and see how many rows hold something under each (`/ledgers/:addOn/:ledger/…`, `/connections/:id/tables/:table/postings/:posting`); those rules travel in the project's schema file. A capped balance can be let below zero by a yes/no on its own row (`capUnless`). A guest is told `PUBLIC_OUT_OF_STOCK` or `PUBLIC_CARD_REFUSED`; staff are told the reason in their own language. An add-on's deciding code is one script with no clock and no network, stopped at 250 ms, and runs only from a package the server can vouch for. A column can link a row to a row of an add-on's table with no foreign key (`addOnLink`): a value is refused while the add-on is not there for that app, and must name a row that exists while it is. A text column can be held to plain text on every way of writing it (`plainText`), and a column can keep a customer's key — a keyed hash of the address beside it, made by Adminium alone (`customerKey`).
- ebf296b: An add-on that keeps tables can now bring the rest of what it needs. Its own pages read and write those tables through a data kit of the dashboard's parts and hooks (`hostApi: 2`), with the reader's own grants. A manifest may ship automation rules (`automations`), listed on the rules page under "From your add-ons" and "From your apps": the owner switches them or edits a copy. An add-on may put a tab of its rows on another table's record (`addOn.recordTabs`), and answer "in stock, low or out" for the rows a page asks about, for customers and for staff (`addOn.words`). A generated record page takes the app's own buttons (`states.actions`), a list takes up to two actions on the ticked rows, and a dashboard's toolbar up to two links. An app's role may hold an add-on's tables (`roles[].tables`). One look-up finds a typed or scanned code across an add-on's tables (`addOn.lookUp`). An add-on's page asks for a document on the paper it wants, and a document that prints a gift card's code is drawn when asked and kept nowhere. An email block can depend on a value (`onlyWith`, `onlyWithout`), an add-on's email can link into the app it serves (`{{app_url.<name>}}`), and an email or a document can list an add-on's rows for an order.

## 0.3.18-rc.0

### Patch Changes

- ba7049f: The manifest learns the words an add-on with its own tables needs: an add-on may declare pages, roles, emails, documents and sample data like an app; ledgers and the rows that post into them; a price an add-on lowers; rules an app ships; buttons on a record; a role's grant on an add-on's table; what a typed code may find. This release reads and checks them. A manifest that uses one is refused at install until the release that runs it.
- 2293c47: A table's rows can post into a ledger an add-on keeps — stock, the money on a gift card — in the same save. A rule on the table (`postings`) says when a row is held, taken and given back; when a save reaches one of those moments Adminium asks the add-on's own code which rows to write, checks the answer and writes them with the row, or saves nothing. An order's lines post with their order. While something of a row is held, what the rule read of it cannot change and the row cannot be deleted until it is put back. A hold ends at the time its row says, by the minute job. Ways of writing many rows at once (a bulk edit, an undo, an import of changes) are refused by name when a row would post, and a list's bulk change is then sent row by row through `POST /data/:connection/:table/one-by-one`. A dry run answers what each ledger would say, without writing. When the add-on cannot be asked, a give-back always goes through, and a take only where the add-on says its rows may be taken unasked; what went through that way is recorded later. A workspace owner can draw rules of their own on any table, switch any rule off, and see how many rows hold something under each (`/ledgers/:addOn/:ledger/…`, `/connections/:id/tables/:table/postings/:posting`); those rules travel in the project's schema file. A capped balance can be let below zero by a yes/no on its own row (`capUnless`). A guest is told `PUBLIC_OUT_OF_STOCK` or `PUBLIC_CARD_REFUSED`; staff are told the reason in their own language. An add-on's deciding code is one script with no clock and no network, stopped at 250 ms, and runs only from a package the server can vouch for. A column can link a row to a row of an add-on's table with no foreign key (`addOnLink`): a value is refused while the add-on is not there for that app, and must name a row that exists while it is. A text column can be held to plain text on every way of writing it (`plainText`), and a column can keep a customer's key — a keyed hash of the address beside it, made by Adminium alone (`customerKey`).
- ebf296b: An add-on that keeps tables can now bring the rest of what it needs. Its own pages read and write those tables through a data kit of the dashboard's parts and hooks (`hostApi: 2`), with the reader's own grants. A manifest may ship automation rules (`automations`), listed on the rules page under "From your add-ons" and "From your apps": the owner switches them or edits a copy. An add-on may put a tab of its rows on another table's record (`addOn.recordTabs`), and answer "in stock, low or out" for the rows a page asks about, for customers and for staff (`addOn.words`). A generated record page takes the app's own buttons (`states.actions`), a list takes up to two actions on the ticked rows, and a dashboard's toolbar up to two links. An app's role may hold an add-on's tables (`roles[].tables`). One look-up finds a typed or scanned code across an add-on's tables (`addOn.lookUp`). An add-on's page asks for a document on the paper it wants, and a document that prints a gift card's code is drawn when asked and kept nowhere. An email block can depend on a value (`onlyWith`, `onlyWithout`), an add-on's email can link into the app it serves (`{{app_url.<name>}}`), and an email or a document can list an add-on's rows for an order.

## 0.3.17

## 0.3.16

## 0.3.15

## 0.3.14

## 0.3.13

## 0.3.12

## 0.3.11

## 0.3.10

## 0.3.9

## 0.3.8

## 0.3.7

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

## 0.3.5

## 0.3.4

## 0.3.3

## 0.3.2

## 0.3.1

### Patch Changes

- c440bee: A rendered document's letterhead may now carry the business's tax number,
  how to pay it, and a line for the foot of the page, beside its name, address
  lines and logo. All three are optional: an older server never sends them, and
  an add-on draws each only when it is there.
- 7426bc4: An app's manifest can now describe what an invoicing app needs, and Adminium
  stores it with the app's other rules.
  
  - **Worked-out values.** A column may say `rules.formula`: a line's amount
    from its quantity, rate and discount, a document's tax and total. The
    arithmetic is exact — never through a floating-point number — and rounds
    once, to the column's new `scale` (0–4 decimal places, or `"currency"`:
    the decimals of the row's own currency, so a JPY total has none and a KWD
    total three).
  - **Numbers without gaps.** `sequence.gapless` numbers rows with no gaps and
    none repeated, optionally per parent row (`scope`) and from a setting
    (`startSetting`); `rules.format` writes the number with its prefix
    (`INV-2042`).
  - **Fills from elsewhere.** `rules.default.from` fills a value on create from
    the connection's currency, a column of the app's settings row, or a setting
    of an add-on the app requires.
  - **States.** A table may declare `states`: the moves between them, what
    stays open once a row is locked, child tables tied to its state, and when a
    row may never be deleted.
  - **More stamps.** Today's date on the venue's calendar, the signed-in
    person's own details, a date so many days after another, and a fingerprint
    of the row and its lines. A stamp may also be written when a column is
    first filled.
  - **Add-ons an app needs.** `addOns` lists the add-ons an app requires or
    suggests, and the features that need them; `documents` lists the document
    profiles an app ships for its own tables. An add-on may define `shapes`
    that apps build their tables on (`builtOn`).
  - **Public access.** New claim kinds (a sign-in link emailed to the address,
    and a share link by token), `visibleWith` for child rows that are only as
    visible as their parent, `files` and `documents` a signed-in person may
    open, and conditions that a value is still empty (`null`) or a date is
    today or later (`from-today`).
  - **Held emails.** An app's outbox may hold what it produces until someone
    approves it, date it for later, let a later reminder overtake an earlier
    one, drop reminders that are no longer needed, and change a linked row once
    an email has gone.
  
  The validator now also returns `warnings` beside its issues: advice that
  never refuses a manifest. The first says when a column will be required at
  install because it is neither nullable nor given a default.
  
  Uploading an add-on built for a newer Adminium now says which version it
  needs, instead of refusing its manifest as not valid. An add-on's `attaches`
  range may use any semver range, such as `>=0.2.0`.
  
  The column inspector in Studio describes each of these rules in words.

## 0.3.0

## 0.3.0-rc.4

## 0.3.0-rc.3

## 0.3.0-rc.2

## 0.3.0-rc.1

## 0.3.0-rc.0

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

### Patch Changes

- ab6314e: `describeShippingCarrier` names the inbound direction: quote is
  direction-symmetric — the same route reversed still quotes — and the refusal is
  end-symmetric, so a carrier that would refuse an address as a recipient refuses it
  as a sender. No interface member changes shape; a return is the same contract with
  the route reversed, and the suite now says so executably.
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
- ce438a0: The closed slot registry gains a thirteenth id: `shell.overlay` (bought
  2026-09-01). Surface `customer`, fill `multi`, payload `ShellOverlayPayload`.
  
  It is the first slot on a **customer shell** rather than inside one of its
  flows. Every other customer id in the registry is a place inside something — a
  product being configured, a basket line, a checkout's delivery step, a dispatch
  being read. This one is the layer above the page: a floating affordance a
  visitor can reach from any screen, and the panel it opens.
  
  Its dossier is FOUR exhibits where `record.actions` had seven, and one of the
  four is an absence — ten customer-side apps with no way to reach the operator
  from the shell. The entry says so in those words rather than dressing four up
  as enough. What it has that the twelfth did not is the condition the registry's
  own header sets: it ships **with** its fill, `live-chat`, in the same wave, so
  "a slot nobody fills is a guess" is satisfied on the day the id lands instead of
  being owed to a later one.
  
  No existing id, surface, fill rule or payload changes. A manifest that names
  `shell.overlay` needs this release plus a refreshed lockfile before it
  validates — that ordering is deliberate, and a manifest test going red in
  between is the mechanism working.

## 0.2.5

## 0.2.4

## 0.2.3

### Patch Changes

- 78cf75f: The closed slot registry gains a twelfth id, `record.actions` — one opening on
  the screen where somebody is already looking at ONE record, to do a thing to it.
  `surface: 'both'`, `fill: 'multi'`, payload "what kind of record it is, the
  record, and a way to write back".
  
  **Patch and not minor, deliberately.** The `fixed: [["@adminium/*"]]` group
  forces the highest pending bump onto all twenty workspaces, so a `minor` here
  would promote the whole monorepo for a change that adds one entry to one array.
  Nothing that exists stops working: the registry is additive, `SlotId` widens,
  and every consumer that enumerated eleven ids still enumerates eleven of the
  twelve.
  
  It arrives with **no fill anywhere**, which is worth stating in a changelog
  rather than leaving a reader to discover. The registry has refused an unfilled
  slot before, on the grounds that one nobody fills is a guess about a future
  add-on. This one is not a guess: it carries seven exhibits with a file and a
  line each, gathered by five independent surveys of the fifteen example apps and
  held to an adversarial pass, and the entry itself sets out the difference at
  length. Its first consumer is a paperwork add-on that has not been built yet.
  
  Consumers who mirror the registry — every example app vendors a copy at
  `src/testing/manifest/slots.ts` — pick this up by re-running
  `scripts/sync-manifest-validator.mjs`, not by hand.

## 0.2.2

## 0.2.2-rc.0

## 0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
