# @adminium/public-client

## 0.3.23

## 0.3.22

## 0.3.21

## 0.3.20

## 0.3.19

### Patch Changes

- be78bbb: Discounts, codes and staff discounts are worked out by Adminium inside the save. A table's price rule has an add-on that keeps offers lower an order's price whenever a line, a code, a reduction by hand or the customer changes; every save and quote says which reductions applied, and a guest's own read of the order says the same afterwards. A code typed on an order is found in the add-on's tables and refused on its own field; what an order used is recorded once, where it posts. What a return gives back is decided from the order priced again without it. An owner can switch a rule, store one for a table of their own and have the columns it needs made with it, try an offer on a saved order before it is on, and have a discount code made that reads like no other. The last four characters of a code are kept beside it.

## 0.3.18

### Patch Changes

- 2293c47: A table's rows can post into a ledger an add-on keeps — stock, the money on a gift card — in the same save. A rule on the table (`postings`) says when a row is held, taken and given back; when a save reaches one of those moments Adminium asks the add-on's own code which rows to write, checks the answer and writes them with the row, or saves nothing. An order's lines post with their order. While something of a row is held, what the rule read of it cannot change and the row cannot be deleted until it is put back. A hold ends at the time its row says, by the minute job. Ways of writing many rows at once (a bulk edit, an undo, an import of changes) are refused by name when a row would post, and a list's bulk change is then sent row by row through `POST /data/:connection/:table/one-by-one`. A dry run answers what each ledger would say, without writing. When the add-on cannot be asked, a give-back always goes through, and a take only where the add-on says its rows may be taken unasked; what went through that way is recorded later. A workspace owner can draw rules of their own on any table, switch any rule off, and see how many rows hold something under each (`/ledgers/:addOn/:ledger/…`, `/connections/:id/tables/:table/postings/:posting`); those rules travel in the project's schema file. A capped balance can be let below zero by a yes/no on its own row (`capUnless`). A guest is told `PUBLIC_OUT_OF_STOCK` or `PUBLIC_CARD_REFUSED`; staff are told the reason in their own language. An add-on's deciding code is one script with no clock and no network, stopped at 250 ms, and runs only from a package the server can vouch for. A column can link a row to a row of an add-on's table with no foreign key (`addOnLink`): a value is refused while the add-on is not there for that app, and must name a row that exists while it is. A text column can be held to plain text on every way of writing it (`plainText`), and a column can keep a customer's key — a keyed hash of the address beside it, made by Adminium alone (`customerKey`).

## 0.3.18-rc.0

### Patch Changes

- 2293c47: A table's rows can post into a ledger an add-on keeps — stock, the money on a gift card — in the same save. A rule on the table (`postings`) says when a row is held, taken and given back; when a save reaches one of those moments Adminium asks the add-on's own code which rows to write, checks the answer and writes them with the row, or saves nothing. An order's lines post with their order. While something of a row is held, what the rule read of it cannot change and the row cannot be deleted until it is put back. A hold ends at the time its row says, by the minute job. Ways of writing many rows at once (a bulk edit, an undo, an import of changes) are refused by name when a row would post, and a list's bulk change is then sent row by row through `POST /data/:connection/:table/one-by-one`. A dry run answers what each ledger would say, without writing. When the add-on cannot be asked, a give-back always goes through, and a take only where the add-on says its rows may be taken unasked; what went through that way is recorded later. A workspace owner can draw rules of their own on any table, switch any rule off, and see how many rows hold something under each (`/ledgers/:addOn/:ledger/…`, `/connections/:id/tables/:table/postings/:posting`); those rules travel in the project's schema file. A capped balance can be let below zero by a yes/no on its own row (`capUnless`). A guest is told `PUBLIC_OUT_OF_STOCK` or `PUBLIC_CARD_REFUSED`; staff are told the reason in their own language. An add-on's deciding code is one script with no clock and no network, stopped at 250 ms, and runs only from a package the server can vouch for. A column can link a row to a row of an add-on's table with no foreign key (`addOnLink`): a value is refused while the add-on is not there for that app, and must name a row that exists while it is. A text column can be held to plain text on every way of writing it (`plainText`), and a column can keep a customer's key — a keyed hash of the address beside it, made by Adminium alone (`customerKey`).

## 0.3.17

## 0.3.16

## 0.3.15

## 0.3.14

## 0.3.13

## 0.3.12

## 0.3.11

## 0.3.10

## 0.3.9

### Patch Changes

- A parent limit's availability answers several parents in one request: `?under=12,15,19`, or `parentAvailability(ref, { under: ['12', '15', '19'] })` in the public client. A page that lists many shows read their tickets one request each, and one visitor's page load used a large share of an address's read budget.

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

- 94b24f9: An app's clients can sign in by an emailed link, open a row shared by a link's code, read rows only as far as their parent is theirs, and download their own private files; the public client gains the link, shared-link, file, documents and add-on settings calls.

## 0.3.0

### Patch Changes

- 64a1f12: **Apps can take bookings against people's hours, not just seats per slot.**
  
  A table may carry a booking rule: the practice's opening hours and breaks, each person's own hours,
  closures (for everyone or one person), how many days ahead and how much notice, the slot grid, and
  which kinds of visit each person offers. Every write — a guest's, the desk's, an import's — is held
  to it on the venue's clock, and two people booking the last time at once get one booking. "Anyone"
  picks the first person free in the app's order. Availability answers free or full per time, and a
  strip of days open, full or closed; a person moving their own visit is not blocked by it
  (`exclude`). A cancellation inside the notice window is flagged on the row, and a guest cannot move
  a visit that late. `@adminium/public-client` gains `bookingTimes()` and `bookingDays()`.
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
- ae41762: **The public client can replace, delete and batch-write rows, and `list()` reads every response shape.**
  
  - `replace(ref, id, values)` sends a PUT. Every column the key may write must be included.
  - `remove(ref, id)` deletes one row.
  - `batch(ref, rows)` writes 1 to 500 rows in one transaction and returns `{ count }`.
  
  `list()` returns `{ data, cursor }` whether the endpoint answers wrapped, as a bare array (the
  next cursor comes from `X-Next-Cursor`) or as a single row, and it makes no extra request to
  find out which. `PublicAction` gains `replace`, `delete` and `batch`, and a ref's config may
  carry `response.shape`. These need a server from 0.3.0.

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

## 0.3.0-rc.3

### Patch Changes

- ae41762: **The public client can replace, delete and batch-write rows, and `list()` reads every response shape.**
  
  - `replace(ref, id, values)` sends a PUT. Every column the key may write must be included.
  - `remove(ref, id)` deletes one row.
  - `batch(ref, rows)` writes 1 to 500 rows in one transaction and returns `{ count }`.
  
  `list()` returns `{ data, cursor }` whether the endpoint answers wrapped, as a bare array (the
  next cursor comes from `X-Next-Cursor`) or as a single row, and it makes no extra request to
  find out which. `PublicAction` gains `replace`, `delete` and `batch`, and a ref's config may
  carry `response.shape`. These need a server from 0.3.0.

## 0.3.0-rc.2

## 0.3.0-rc.1

## 0.3.0-rc.0

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

## 0.2.3

## 0.2.2

### Patch Changes

- a94f776: Add the browser client for the scoped public API: a dependency-free
  `createPublicClient` that returns `null` when its build-time env is absent, so a
  demo build falls back to seed data structurally rather than in a catch, plus the
  tenant-timezone helpers every connected app needs to avoid rendering a
  15:00 London appointment at 16:00 in a Berlin browser.
