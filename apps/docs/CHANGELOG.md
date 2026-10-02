# @adminium/docs

## 0.3.13

## 0.3.12

## 0.3.11

## 0.3.10

## 0.3.9

## 0.3.8

## 0.3.7

## 0.3.6

### Patch Changes

- 67ff162: An app's email can now wait for a feature and a setting at once: `gate: { feature, setting: { table, column } }` queues the message only while the feature is on (its add-ons attached) and that switch of the app's settings row is on. A restaurant's receipt is queued only while Invoices & Receipts is attached and the manager has receipts switched on. Each half is checked as it is when used alone, and the gates that name one thing behave as before. Like every gate, it is judged when the message is queued: a message already waiting still goes if the feature or the switch is turned off afterwards, and only its producer's `dropWhen` drops it.
  
  A move that takes back another (`undo: true`) now works out of a locked state. What it empties, its `clearOnBack` stamps and the new `clears` list of further columns it names (how a hand-over taken back was paid), is open to the table's lock for that move only, and only to be emptied. A manager taking back a picked-up order used to be refused with `RECORD_LOCKED`; now the order is ready and unpaid again, its hand-over stamps are empty and its held receipt is dropped. A value sent for a column the move empties is refused with `STATE_MOVE_REFUSED` (`details.clears`). The same columns changed on their own stay locked. `clears` is allowed only on an undo, and only for columns of the table that may be empty, named once, and that no other rule writes; a states rule saved in Studio is held to the same checks. A second move between the same two states is refused when either is an undo or names `clears`, since only the first listed is ever made. In Studio, these checks apply when a save changes a table's states: a states rule saved before this release is still accepted as it is, and is held to them once it is edited. The dashboard's Undo of a hand-over that filled such a column from empty makes the move back, and is offered only to a person who may make it. A take-back whose row was moved back and on again by someone else meanwhile is refused with `WRITE_CONFLICT` to be made again, rather than leaving the row unemptied.
- 873dcfe: The online add-on and app catalogues read adminium.dev's marketplace API (`/api/v1/marketplace/add-ons` and `/apps`) instead of the static feeds the site published at each build, so a new release is offered as soon as the site has checked it. The request names this server's Adminium version and the site answers with the newest release of each item that version can install: an older server is offered an older release it can use, where it used to be told only that the newest needed an upgrade. An item whose every release needs a newer Adminium is still listed, with the version it needs. An item the site lists as coming soon shows a Coming soon badge and "Not available yet" in place of its button, and a download of one is refused with `NOT_RELEASED`. Cards show the catalogue's own icon (an app's drawing, an add-on's monogram), who publishes it, when it last changed, and which add-ons an app needs. A price in a release is refused, and one anywhere else is dropped, so none reaches a card. An item the server cannot read is skipped and named in the refresh's audit row, and the rest are still offered. A catalogue cached by 0.3.5 or earlier reads as none until the next refresh. `@adminium/manifest` exports the API's wire schema.
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
- f8fd136: Public API: a name or note sent to a public form may no longer hold a web address. A column an entry lists under `anonymous.plainText` (a stranger's name on a booking, an order or an enquiry) already refused digits, `@`, `/`, `://` and `www.`; it is now judged by the same rule as a line's note and a change through a guest's own link, which also refuses a dotted word ending in a known web ending, so `refund-desk.com Smith` is refused where it used to pass and be printed in the venue's own confirmation email. The rule refuses web and email addresses in their common forms, not every way of writing one: the endings it knows are a list, now widened with the ones a venue or shop is often called by (`.cafe`, `.restaurant`, `.hotel`, `.clinic`, `.menu`, `.events` and more) and common ones in other scripts (`.中国`, `.москва`). An ending is read as a reader sees it, so fullwidth letters, an accent or an invisible mark on it, or a hyphen after it no longer slip past; this applies to a line's note and to a guest's change too. Initials before a surname pass ("W.Hu", "K.Y.Ng", "M.De Vries"), except before an ending an address is always read in (`X.Com`, `J.Co`); a word joined to another by a dot with no space ("Wong.Ng", "Birthday.Gift wrap") can still be refused. Such a column is now judged on every write of it: a create signed in or not (including a name the person's account fills in), and any change of the row that writes it, through its own link, a signed-in person's rows or a batch. A person's own column that such a create fills it from (an account's name copied into an order's buyer name) is judged the same way when the person changes it on their account, so a name the order would refuse is refused where the person can fix it. The refusal is unchanged, `400` `PUBLIC_WRITE_REFUSED` with `params.column` (and `params.index` in a batch), and its message now says "no web or email address". Clinic Desk 0.2.1 (a first visit's name, a registration's name) and Client Portal 0.2.1 (an enquiry's name) refuse such names where they took them before; no released app's change, signed-in create or account fills or writes such a column, so nothing else changes for them. A batch of creates through an endpoint that holds a column to plain text now judges each row the same way.
- 7775af3: A guest can ask for a confirmation email again from the row's own link. An app puts `newLink` on a row's own-link entry. It names another link of the same row (such as the link in a "Confirm your order" email), the outbox message that carries it, and `when`, the conditions the row must meet. `when` is required here. `POST /public/records/{ref}/{id}/new-link` then makes that link again, so the old one stops opening anything, and the link the guest asked from keeps working. The email follows the message's own producer: it goes where that producer sends it, read from the row and never to an address in the request, and only while the producer's gate is open. The app may not let a guest change that address.
  
  The new code and its email are saved together. When the email cannot be queued, nothing changes and the old link still works. Asks are limited to 5 a day per row and 5 a day per mailbox across the table, and one a minute per row. An ask over a limit, while the row does not meet `when`, or while that link is stopped is refused with `409`, and nothing is sent or counted. A message that waits for a person's approval, or whose producer repeats by another column, cannot be sent from a link. `when` and the gate also apply to the signed-in "Make a new link".

## 0.3.5

### Patch Changes

- 092fad5: Two new environment variables size Adminium's database pools. `ADMINIUM_META_POOL_MAX` sets how many connections a Postgres or MySQL meta store's pool may open (10 until now, and still by default). `ADMINIUM_SOURCE_POOL_MAX` sets the size of every pool Adminium opens against a source database — the long-lived one pages and the API use, and the short-lived ones that read the schema and collect statistics — which together could reach 25 connections to one database. A source behind a pooler or an SSH tunnel, a managed database with a small connection limit, or a role with a `CONNECTION LIMIT` could not be kept inside its limit before: a pool larger than the limit has its extra connections refused, not queued, and the page that needed one failed. Both take a whole number from 1 to 100; unset, nothing changes. The environment variables page explains how to choose them.
- 6cabc6c: The PostgreSQL connection guide explains how to reach a database through an SSH tunnel: the `ssh -N -L` command, a key that can open that one forward and nothing else, and why the npm CLI (`npx @adminiumjs/adminium`) can use the tunnel's `127.0.0.1` while the Docker image, which runs with `NODE_ENV=production` and refuses loopback sources, needs the host's address instead. The read-write role recipe is now the recommended least-privilege role: it explains `ALTER DEFAULT PRIVILEGES FOR ROLE` for tables created by a migration role, how tables granted `SELECT` only and columns granted one by one appear in Adminium, and that the `GRANT CREATE ON DATABASE` workaround for older releases can be revoked.

## 0.3.4

## 0.3.3

## 0.3.2

## 0.3.1

### Patch Changes

- 71d90e0: The manifest reference covers formulas, numbers without gaps, states, tables built on an add-on's shape, add-ons an app needs, documents, held outbox messages and the new public access claims, and a guide walks through an app built on the Invoices & Receipts add-on.

## 0.3.0

### Patch Changes

- ae41762: **A public API documentation page at `/api-docs`, switched on from Workspace settings.**
  
  Workspace settings gains a **Public API** card for holders of `api-keys.manage`, with two
  switches that apply the moment you click them:
  
  - **Public API** turns the public API on or off. It moved here from the old public API page.
  - **API documentation page** publishes `/api-docs`. It is off by default and does not travel in
    a config bundle.
  
  If `ADMINIUM_PUBLIC_API_ORIGINS` is not set, the card says so and how to fix it.
  `GET/PUT /api/v1/public-api` report and accept `docsEnabled`, and a PUT may change either
  switch on its own.
  
  `/api-docs` works without signing in. It lists only endpoints that a live key can call, with
  the methods keys were granted, and for each one its path, auth level, limits and column
  names and types. It never shows a table name, a filter, a row count or a key. While the page is
  off, the page and `GET /api/v1/api-docs` answer the ordinary not-found response. On a domain
  mapped to a hosted app they are not served at all.
  
  The page has a playground. Paste a browser key and it sends a real request with that key only.
  The key is never stored, never put in a URL or code sample, and your session cookie is not
  sent. The page shows the real status, the time taken and the response body. Code samples in
  cURL, JavaScript (`@adminiumjs/public-client`) and Python use the real paths and headers.
- ae41762: **The old API keys page at `/api-keys` is gone.** Role-bound keys (`adm_sk_…`) still work and can
  still be created and revoked through `/api/v1/api-keys`. There is no page for them now.
  _Guides → Public API → Endpoints and keys_ shows how to create one with `curl`. The sidebar no
  longer has an "API keys" row. Keys for your own pages are under Workspace settings → API keys.
- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.
- ae41762: **Public API keys can be made from endpoints instead of a hand-written scope.**
  
  Every table and view of a connection now has a generated public endpoint:
  its columns (none marked secret or personal data), its filters, page size,
  order, rate limit and response shape, and the methods its source supports.
  An operator can store an edited endpoint or a new custom one, and a key can
  be given several endpoints with different methods on each. Adminium writes the
  key's scope from those grants.
  
  New admin routes, all behind the API-keys permission:
  
  - `GET /api/v1/public-endpoints?connectionId=` lists the endpoints, the
    source tables and their columns, and any table without a generated endpoint
    with the reason.
  - `POST /api/v1/public-endpoints/check` compiles a definition without saving
    it. It reports every issue, the live keys a save would break, and the
    browser keys that would gain columns, methods or rows.
  - `PUT /api/v1/public-endpoints/:connectionId/:ref` saves an endpoint and
    rewrites the scope of every live key that uses it in the same step. A save
    that would break one of those keys is refused, and the reply names the key.
  - `POST …/:ref/rename` and `DELETE …/:ref` are refused while a live key uses
    the endpoint. Deleting a generated endpoint switches it off instead of
    removing it, so its default does not come back.
  - `POST /api/v1/public-keys` also accepts `connectionId` with `access` (the
    endpoints and methods), next to the existing `scopeId`.
  
  `GET /api/v1/public-keys` now returns each key's connection, kind, what it can
  call on each endpoint (and any method the endpoint no longer offers), and any
  issue that stops the key from working today.
  
  A key's derived scope is not listed by `GET /api/v1/public-scopes` and cannot
  be edited, deleted or reused by another key.
  
  Scopes also gain a default page size (`defaultLimit`), a default order
  (`defaultOrder`), a per-resource rate (`rate`) and a list response shape
  (`response`), and the `replace`, `delete` and `batch` actions. All are
  optional; a scope written before this change behaves as it did. The routes
  that serve the three new actions come in a later release.
  `GET /public/config` reports each resource's response shape.
  
  With more than one server process, a revoke, rotate, key create or endpoint
  save now reaches the other processes within 5 seconds (it was 30).
- ae41762: **The public API gains one-row reads, PUT, DELETE and BATCH, per-endpoint rate limits, list shapes, request counts and server keys.**
  
  New public routes, each allowed only when the key was granted that method on the endpoint:
  
  - `GET /public/records/:ref/:id` reads one row. It returns the same columns as the list and
    hides the same personal data. A row that doesn't exist and a row outside the key's scope both
    answer the same 404.
  - `PUT /public/records/:ref/:id` replaces a row. The body must include every column the key may
    write. The scope is part of the UPDATE statement itself.
  - `DELETE /public/records/:ref/:id` deletes a row. The scope is part of the DELETE statement
    itself. A row outside the scope answers 404 and is not deleted. When the database refuses a
    delete because of a foreign key, the caller gets one refusal that names nothing. Each delete
    writes an audit row showing the removed row, with personal data masked.
  - `POST /public/records/:ref/batch` takes 1 to 500 rows in one transaction, and either all of
    them are written or none are.
    - A row without its primary key is inserted, and the server chooses the key.
    - A row with its primary key updates that row, and the key must also hold PATCH.
    - If any keyed row is missing or outside the scope, the whole batch is refused, without saying
      which case it was.
  
  An endpoint's own rate limit now replaces its class limit. For browser keys it counts per
  visitor, and for server keys it counts across the whole key. A batch uses up one request per row.
  A request too large to ever fit is refused with 400 rather than 429. Scopes written before this
  change keep the limits they had.
  
  An address whose keys keep failing to match is refused after 30 failures a minute, before the
  server looks the key up.
  
  A list can be returned wrapped (as before), as a bare array with the next cursor in
  `X-Next-Cursor`, or as exactly one row. `Retry-After` and `X-Next-Cursor` can now be read by
  pages on other origins.
  
  "Requests · 24h" is counted per key, endpoint and hour. The counts are written every minute and
  when the server shuts down, and kept for `retention.publicRequestStatsDays`. The new admin route
  `GET /api/v1/public-api/stats` returns the total.
  
  **Server keys** (`adm_srv_`) work without an `Origin` header. They are refused when a request
  comes from a browser, are shown only once, and cannot be revealed. Rotating one gives another
  server key. Only a server key can be granted a service-role endpoint. A hosted app is never
  given a server key.

## 0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- ae41762: **A public API documentation page at `/api-docs`, switched on from Workspace settings.**
  
  Workspace settings gains a **Public API** card for holders of `api-keys.manage`, with two
  switches that apply the moment you click them:
  
  - **Public API** turns the public API on or off. It moved here from the old public API page.
  - **API documentation page** publishes `/api-docs`. It is off by default and does not travel in
    a config bundle.
  
  If `ADMINIUM_PUBLIC_API_ORIGINS` is not set, the card says so and how to fix it.
  `GET/PUT /api/v1/public-api` report and accept `docsEnabled`, and a PUT may change either
  switch on its own.
  
  `/api-docs` works without signing in. It lists only endpoints that a live key can call, with
  the methods keys were granted, and for each one its path, auth level, limits and column
  names and types. It never shows a table name, a filter, a row count or a key. While the page is
  off, the page and `GET /api/v1/api-docs` answer the ordinary not-found response. On a domain
  mapped to a hosted app they are not served at all.
  
  The page has a playground. Paste a browser key and it sends a real request with that key only.
  The key is never stored, never put in a URL or code sample, and your session cookie is not
  sent. The page shows the real status, the time taken and the response body. Code samples in
  cURL, JavaScript (`@adminiumjs/public-client`) and Python use the real paths and headers.
- ae41762: **The old API keys page at `/api-keys` is gone.** Role-bound keys (`adm_sk_…`) still work and can
  still be created and revoked through `/api/v1/api-keys`. There is no page for them now.
  _Guides → Public API → Endpoints and keys_ shows how to create one with `curl`. The sidebar no
  longer has an "API keys" row. Keys for your own pages are under Workspace settings → API keys.
- ae41762: **Public API keys can be made from endpoints instead of a hand-written scope.**
  
  Every table and view of a connection now has a generated public endpoint:
  its columns (none marked secret or personal data), its filters, page size,
  order, rate limit and response shape, and the methods its source supports.
  An operator can store an edited endpoint or a new custom one, and a key can
  be given several endpoints with different methods on each. Adminium writes the
  key's scope from those grants.
  
  New admin routes, all behind the API-keys permission:
  
  - `GET /api/v1/public-endpoints?connectionId=` lists the endpoints, the
    source tables and their columns, and any table without a generated endpoint
    with the reason.
  - `POST /api/v1/public-endpoints/check` compiles a definition without saving
    it. It reports every issue, the live keys a save would break, and the
    browser keys that would gain columns, methods or rows.
  - `PUT /api/v1/public-endpoints/:connectionId/:ref` saves an endpoint and
    rewrites the scope of every live key that uses it in the same step. A save
    that would break one of those keys is refused, and the reply names the key.
  - `POST …/:ref/rename` and `DELETE …/:ref` are refused while a live key uses
    the endpoint. Deleting a generated endpoint switches it off instead of
    removing it, so its default does not come back.
  - `POST /api/v1/public-keys` also accepts `connectionId` with `access` (the
    endpoints and methods), next to the existing `scopeId`.
  
  `GET /api/v1/public-keys` now returns each key's connection, kind, what it can
  call on each endpoint (and any method the endpoint no longer offers), and any
  issue that stops the key from working today.
  
  A key's derived scope is not listed by `GET /api/v1/public-scopes` and cannot
  be edited, deleted or reused by another key.
  
  Scopes also gain a default page size (`defaultLimit`), a default order
  (`defaultOrder`), a per-resource rate (`rate`) and a list response shape
  (`response`), and the `replace`, `delete` and `batch` actions. All are
  optional; a scope written before this change behaves as it did. The routes
  that serve the three new actions come in a later release.
  `GET /public/config` reports each resource's response shape.
  
  With more than one server process, a revoke, rotate, key create or endpoint
  save now reaches the other processes within 5 seconds (it was 30).
- ae41762: **The public API gains one-row reads, PUT, DELETE and BATCH, per-endpoint rate limits, list shapes, request counts and server keys.**
  
  New public routes, each allowed only when the key was granted that method on the endpoint:
  
  - `GET /public/records/:ref/:id` reads one row. It returns the same columns as the list and
    hides the same personal data. A row that doesn't exist and a row outside the key's scope both
    answer the same 404.
  - `PUT /public/records/:ref/:id` replaces a row. The body must include every column the key may
    write. The scope is part of the UPDATE statement itself.
  - `DELETE /public/records/:ref/:id` deletes a row. The scope is part of the DELETE statement
    itself. A row outside the scope answers 404 and is not deleted. When the database refuses a
    delete because of a foreign key, the caller gets one refusal that names nothing. Each delete
    writes an audit row showing the removed row, with personal data masked.
  - `POST /public/records/:ref/batch` takes 1 to 500 rows in one transaction, and either all of
    them are written or none are.
    - A row without its primary key is inserted, and the server chooses the key.
    - A row with its primary key updates that row, and the key must also hold PATCH.
    - If any keyed row is missing or outside the scope, the whole batch is refused, without saying
      which case it was.
  
  An endpoint's own rate limit now replaces its class limit. For browser keys it counts per
  visitor, and for server keys it counts across the whole key. A batch uses up one request per row.
  A request too large to ever fit is refused with 400 rather than 429. Scopes written before this
  change keep the limits they had.
  
  An address whose keys keep failing to match is refused after 30 failures a minute, before the
  server looks the key up.
  
  A list can be returned wrapped (as before), as a bare array with the next cursor in
  `X-Next-Cursor`, or as exactly one row. `Retry-After` and `X-Next-Cursor` can now be read by
  pages on other origins.
  
  "Requests · 24h" is counted per key, endpoint and hour. The counts are written every minute and
  when the server shuts down, and kept for `retention.publicRequestStatsDays`. The new admin route
  `GET /api/v1/public-api/stats` returns the total.
  
  **Server keys** (`adm_srv_`) work without an `Origin` header. They are refused when a request
  comes from a browser, are shown only once, and cannot be revealed. Rotating one gives another
  server key. Only a server key can be granted a service-role endpoint. A hosted app is never
  given a server key.

## 0.3.0-rc.2

## 0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

### Patch Changes

- a44a0ff: The ghcr image and the desktop build now carry the six first-party add-ons as
  a pre-verified bundled set.
  
  The boot seed has existed since the store landed, but nothing ever put a bundle
  where it looks — every image and installer shipped an empty Add-ons page and
  called the air-gap story done. Now a release script
  (`scripts/release/fetch-add-ons-bundle.mjs`) downloads the six tarballs at build
  time against exact version + sha512 pins (`scripts/release/add-ons-bundle.json`,
  copied from the release ledger — never `latest`, no redirects, timing-safe
  digest comparison, refusal on any unpinnable entry), and writes the flat
  `<key>-<version>.tgz` + `.tgz.integrity` layout the seed reads. The Docker build
  parks it at `/app/add-ons-bundle`, which the runtime stage's CWD makes the
  server's own default; desktop-release.yml parks it in `resources/add-ons-bundle`
  next to the demo seed.
  
  The desktop shell now closes the loop in both directions: `buildServerEnv`
  points `ADMINIUM_BUNDLED_ADD_ONS` at the packaged directory (only when it
  actually exists — dev checkouts ship no bundle), and the variable joins
  `STRIPPED_INHERITED_ENV_KEYS`, because it names a directory the server installs
  packages FROM, hashes and all — an inherited value was a whole package set
  chosen by whoever can set an environment variable.
  
  Seeding stays copy-if-absent with every hash re-verified on the way in, so the
  build-time verification is the first check, not the only one. A new
  self-hosting docs page (Installing add-ons) states the rest of the story
  plainly: the bundled set browses with zero network, the online catalog is a
  default-off opt-in that contacts exactly two hosts and discloses the
  deployment's IP and exact package@version to npm, and air-gapped installs
  sideload with a hash from the release ledger.

## 0.2.3

## 0.2.2

### Patch Changes

- docs: correct four claims the code does not support
  
  - **Desktop.** `Settings → Desktop` renders exactly three cards (Sign-in,
    Share on local network, App permissions). The install page's update-mode
    table and the backups page's "change the depth or turn it off in Settings →
    Desktop" both pointed at controls that have never existed. Both settings are
    real — `updates.mode` and `autoBackup.{enabled,keep}` in `config.json` — so
    the pages now say where they actually live, that the file is read once at
    launch, and which read-only surfaces (Help → About, Help → Check for
    Updates…) exist instead. Also records how the updater resolves its release
    (the releases list, filtered to `desktop-v*`, never GitHub's repository-wide
    "latest" pointer), the auto-backup schedule, and that `export-zip` is
    portability rather than a backup.
  - **`anatomy/index.md`.** "Nothing in the repository sends mail" was false end to
    end: `email.smtp` drives a real nodemailer transport, `email.send` is a
    registered job kind, and password resets, invitations, notifications and the
    template test-send all queue through it. Rewritten to name the absences that are
    real — no provider adapters, no `/settings/email` screen, no outbox table — and
    to correct `smtpConfigured` from "the whole of it" to the read-only consequence
    it is.
  - **`anatomy/packages.md`.** Every row of the per-package table recomputed
    under the convention the page states; 13 of 15 were wrong, several by a whole
    package's worth of files. The page now prints the commands that produce the
    figures and says plainly that nothing in CI holds them.
  - **The axe baseline count.** Dropped rather than refreshed. It is a debt
    counter with no CI tie — the quoted 162 had drifted well past the file — so
    the note points at `packages/ui/a11y-baseline.json` instead.

## 0.2.1

## 0.2.0

## 0.1.0

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
