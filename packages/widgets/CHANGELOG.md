# @adminium/widgets

## 0.3.20

### Patch Changes

- @adminium/charts@0.3.20
  - @adminium/i18n@0.3.20
  - @adminium/tokens@0.3.20
  - @adminium/ui@0.3.20

## 0.3.19

### Patch Changes

- be78bbb: Discounts, codes and staff discounts are worked out by Adminium inside the save. A table's price rule has an add-on that keeps offers lower an order's price whenever a line, a code, a reduction by hand or the customer changes; every save and quote says which reductions applied, and a guest's own read of the order says the same afterwards. A code typed on an order is found in the add-on's tables and refused on its own field; what an order used is recorded once, where it posts. What a return gives back is decided from the order priced again without it. An owner can switch a rule, store one for a table of their own and have the columns it needs made with it, try an offer on a saved order before it is on, and have a discount code made that reads like no other. The last four characters of a code are kept beside it.
- Updated dependencies [5cfc90d]
- Updated dependencies [8af701b]
- Updated dependencies [be78bbb]
  - @adminium/i18n@0.3.19
  - @adminium/charts@0.3.19
  - @adminium/tokens@0.3.19
  - @adminium/ui@0.3.19

## 0.3.18

### Patch Changes

- ba7049f: The manifest learns the words an add-on with its own tables needs: an add-on may declare pages, roles, emails, documents and sample data like an app; ledgers and the rows that post into them; a price an add-on lowers; rules an app ships; buttons on a record; a role's grant on an add-on's table; what a typed code may find. This release reads and checks them. A manifest that uses one is refused at install until the release that runs it.
- ebf296b: An add-on that keeps tables can now bring the rest of what it needs. Its own pages read and write those tables through a data kit of the dashboard's parts and hooks (`hostApi: 2`), with the reader's own grants. A manifest may ship automation rules (`automations`), listed on the rules page under "From your add-ons" and "From your apps": the owner switches them or edits a copy. An add-on may put a tab of its rows on another table's record (`addOn.recordTabs`), and answer "in stock, low or out" for the rows a page asks about, for customers and for staff (`addOn.words`). A generated record page takes the app's own buttons (`states.actions`), a list takes up to two actions on the ticked rows, and a dashboard's toolbar up to two links. An app's role may hold an add-on's tables (`roles[].tables`). One look-up finds a typed or scanned code across an add-on's tables (`addOn.lookUp`). An add-on's page asks for a document on the paper it wants, and a document that prints a gift card's code is drawn when asked and kept nowhere. An email block can depend on a value (`onlyWith`, `onlyWithout`), an add-on's email can link into the app it serves (`{{app_url.<name>}}`), and an email or a document can list an add-on's rows for an order.
- Updated dependencies [e27492d]
- Updated dependencies [49dc266]
- Updated dependencies [b28af08]
- Updated dependencies [2293c47]
- Updated dependencies [ebf296b]
  - @adminium/i18n@0.3.18
  - @adminium/charts@0.3.18
  - @adminium/tokens@0.3.18
  - @adminium/ui@0.3.18

## 0.3.18-rc.0

### Patch Changes

- ba7049f: The manifest learns the words an add-on with its own tables needs: an add-on may declare pages, roles, emails, documents and sample data like an app; ledgers and the rows that post into them; a price an add-on lowers; rules an app ships; buttons on a record; a role's grant on an add-on's table; what a typed code may find. This release reads and checks them. A manifest that uses one is refused at install until the release that runs it.
- ebf296b: An add-on that keeps tables can now bring the rest of what it needs. Its own pages read and write those tables through a data kit of the dashboard's parts and hooks (`hostApi: 2`), with the reader's own grants. A manifest may ship automation rules (`automations`), listed on the rules page under "From your add-ons" and "From your apps": the owner switches them or edits a copy. An add-on may put a tab of its rows on another table's record (`addOn.recordTabs`), and answer "in stock, low or out" for the rows a page asks about, for customers and for staff (`addOn.words`). A generated record page takes the app's own buttons (`states.actions`), a list takes up to two actions on the ticked rows, and a dashboard's toolbar up to two links. An app's role may hold an add-on's tables (`roles[].tables`). One look-up finds a typed or scanned code across an add-on's tables (`addOn.lookUp`). An add-on's page asks for a document on the paper it wants, and a document that prints a gift card's code is drawn when asked and kept nowhere. An email block can depend on a value (`onlyWith`, `onlyWithout`), an add-on's email can link into the app it serves (`{{app_url.<name>}}`), and an email or a document can list an add-on's rows for an order.
- Updated dependencies [e27492d]
- Updated dependencies [49dc266]
- Updated dependencies [b28af08]
- Updated dependencies [2293c47]
- Updated dependencies [ebf296b]
  - @adminium/i18n@0.3.18-rc.0
  - @adminium/charts@0.3.18-rc.0
  - @adminium/tokens@0.3.18-rc.0
  - @adminium/ui@0.3.18-rc.0

## 0.3.17

### Patch Changes

- 5209454: Adminium Designer: the preview's Dashboard side is your own dashboard, as the owner, with Studio, people and settings in reach; it was opened as the preview person, who has only the app's roles. "Add a model": a listed model that cannot be asked (an Ollama cloud model with no usage left) no longer fails the whole test; the list stays, the reason is said, and another model can be chosen. Pictures from another site: the Designer is told that a page shows pictures only from this server and from sites that were allowed, its check names a picture that will not show, and it can ask you to allow a site (a card); a yes adds the host to `ADMINIUM_CSP_IMG_HOSTS` in the project's `.env` and counts at once, with no restart. The live connection: a page that fell back to an event stream while the server was away (a restart) now goes back to its socket and closes the stream; before, every open tab kept its streams for good, and two such tabs used all of the browser's connections to the server, so the next page loaded forever. Pictures a table keeps: the Designer is told to show them to visitors with `pictureUrl`, and its check names a customer screen that puts the column's own value in an `<img>` (a broken image for every visitor) and a `pictures` entry whose `select` leaves out the row's id. The build page no longer scrolls to empty space under itself while a step runs. A message of yours with a long unbroken word (a pasted address) is broken inside its bubble and no longer makes the chat scroll sideways. Boards: a card opens its own record. A board whose columns did not include the row's key numbered its cards by position, so a click (or a move) reached record 0, "Record not found"; every list of rows now carries the row's key, and the answer names it.
- Updated dependencies [c114dc8]
- Updated dependencies [5209454]
  - @adminium/i18n@0.3.17
  - @adminium/charts@0.3.17
  - @adminium/tokens@0.3.17
  - @adminium/ui@0.3.17

## 0.3.16

### Patch Changes

- Updated dependencies [3392573]
- Updated dependencies [6db5fa2]
- Updated dependencies [bc0284d]
- Updated dependencies [4a01150]
- Updated dependencies [d5f0dac]
- Updated dependencies [0a1b8e6]
- Updated dependencies [426eb40]
- Updated dependencies [085fe69]
- Updated dependencies [8bb8392]
  - @adminium/i18n@0.3.16
  - @adminium/charts@0.3.16
  - @adminium/tokens@0.3.16
  - @adminium/ui@0.3.16

## 0.3.15

### Patch Changes

- Updated dependencies [bb75c32]
  - @adminium/i18n@0.3.15
  - @adminium/charts@0.3.15
  - @adminium/tokens@0.3.15
  - @adminium/ui@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [3dc3c74]
- Updated dependencies [c55d717]
- Updated dependencies [eeefc52]
- Updated dependencies [100163b]
- Updated dependencies [cc8c326]
- Updated dependencies [7976459]
- Updated dependencies [b240a4f]
  - @adminium/i18n@0.3.14
  - @adminium/ui@0.3.14
  - @adminium/charts@0.3.14
  - @adminium/tokens@0.3.14

## 0.3.13

### Patch Changes

- @adminium/charts@0.3.13
  - @adminium/i18n@0.3.13
  - @adminium/tokens@0.3.13
  - @adminium/ui@0.3.13

## 0.3.12

### Patch Changes

- @adminium/charts@0.3.12
  - @adminium/i18n@0.3.12
  - @adminium/tokens@0.3.12
  - @adminium/ui@0.3.12

## 0.3.11

### Patch Changes

- a63590a: Opening a related tab in a record's panel no longer ends in "Rate limit reached". The tab read its rows again every time it drew, and its own answer made it draw: one open tab sent the same read over and over, as fast as the server answered, until the signed-in budget (300 requests a minute) was spent and the next page the person opened was a full-page 429. The tab now reads once per record. A read that is refused leaves the tab's count on screen instead of an unhandled error.
- a63590a: A record's panel (Peek) shows the whole record and names its tabs in words. It showed only the columns the list shows, so an order opened from a list of names and totals had no number and no status, and an enquiry had no note; the panel now lists the list's columns first, as the page set them, then the rest of the table's. Its related tabs read "ordering_order_items"; they now carry the table's own name where it has one (an app's, or the operator's rename: "Order items") and plain words where it has none. `GET /data/:connection/:table/:id?include=inboundCounts` and the references preflight answer that name as `label` on each entry.
- 3e9fc5b: A yes/no column on SQLite is a switch in a generated page's form, not a number box. SQLite keeps a yes/no as a whole number, and the mark that says what it is (`column.yesNo`, written by the table designer and by an app's install or update) reached every reader except page generation, which stored the column as `integer`; the form lets a page's stored column win, so "Active" asked for `1`. Generation now reads the mark, and a page stored before the mark was written follows it when it is read: the column draws as a switch in the form and as a yes/no in the list, with everything else the page set on it (its label, its width, whether it is hidden) kept. A form somebody designed while the column still read as a number gives up its number box for the switch too.
- Updated dependencies [b07eb0c]
  - @adminium/ui@0.3.11
  - @adminium/charts@0.3.11
  - @adminium/i18n@0.3.11
  - @adminium/tokens@0.3.11

## 0.3.10

### Patch Changes

- @adminium/charts@0.3.10
  - @adminium/i18n@0.3.10
  - @adminium/tokens@0.3.10
  - @adminium/ui@0.3.10

## 0.3.9

### Patch Changes

- Fixes found while recording the walkthroughs. An invitation opened in a browser where somebody else is signed in no longer fails with `CSRF_FAILED`: sign-in, forgot-password and reset act on what their body carries, so they are checked by origin alone. The Team page says whether an invitation was emailed (it always said it was not), and no longer lists the owner as "Never signed in". The app page counts each table's rows as they are now (it showed 0 after sample data), names the add-on a step set up, and says when its customer side is on but cannot answer because the public API is off or the app was installed without its public access. The install check warns when an app keeps money and the database has no currency (amounts then show in dollars on the dashboard and bare in emails). A required choice drawn as a row of segments shows nothing chosen until one is (it looked answered and then refused the save). An add-on's unset JSON setting opens empty instead of reading `null`, and a newly installed add-on's page appears in the sidebar without a reload. The "details deleted" email says what became of the links the person holds, as the app declares it, and no longer speaks of tickets and bookings. A date-only column shows its day in a list, never "17h ago". Generated forms say "New order item" and "→ clients" instead of raw table names, and a new automation step's description follows what the step does.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @adminium/i18n@0.3.9
  - @adminium/ui@0.3.9
  - @adminium/charts@0.3.9
  - @adminium/tokens@0.3.9

## 0.3.8

### Patch Changes

- 83bc23e: A desk asks for the limits of a page of shows at once: `capacity-counts?under=event_id&values=12,13,14` counts up to 50 values in one ask, each row naming the value it is under, instead of one request a show. A staff save may carry up to 1,000 rows below one record (was 200), so a message to a show's buyers goes out with an email each in one write; the public API's creates keep their 200.
- 56c75af: An app's records page can open already filtered: `config.defaultFilters` lists up to six conditions (a column, an op and a value), used when nobody has chosen filters yet — a saved view, or the filters someone left the page in, still win. Online Ordering's Messages page can now hide the skipped rows every phone order without an email writes. An install refuses default filters it cannot read or that name a column the page's table does not have.
- Updated dependencies [717f9ff]
  - @adminium/i18n@0.3.8
  - @adminium/charts@0.3.8
  - @adminium/tokens@0.3.8
  - @adminium/ui@0.3.8

## 0.3.7

### Patch Changes

- @adminium/charts@0.3.7
  - @adminium/i18n@0.3.7
  - @adminium/tokens@0.3.7
  - @adminium/ui@0.3.7

## 0.3.6

### Patch Changes

- d2abd74: A record whose link or email column holds a value the browser does not accept as a full address can be saved again. Link and email fields, and a file column's plain field when no file storage is set up, were `type="url"` / `type="email"` inputs, so the browser refused to submit the form while one held a root-relative link such as `/covers/bookings.webp`, a scheme-less `example.com` or `n/a` — even when nobody had touched that field. They are now text fields that still bring up the address keyboard on a phone. A format an admin set on the column is still checked by the server, which names the field it refused.
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
- Updated dependencies [873dcfe]
- Updated dependencies [765bc4f]
- Updated dependencies [df59116]
  - @adminium/i18n@0.3.6
  - @adminium/ui@0.3.6
  - @adminium/charts@0.3.6
  - @adminium/tokens@0.3.6

## 0.3.5

### Patch Changes

- dd1c9c0: A Postgres table whose connection role is granted only some of its columns — `GRANT UPDATE (notes) ON tickets` — can now be edited. Forms show the columns the role may not set read-only and never send them: on an edit, the columns it may not update; on a new record, the columns it may not insert. A write that names such a column anyway is refused with 403 `READ_ONLY_MODE` listing the columns, before it reaches the database. A column Adminium fills on its own — an `updated_at` it stamps on every edit — is left out when the role may not write it, where it used to make the database refuse every save of the table. This holds for every write, not only the record form's: line items, imports, automation steps, the public API and project code. Line items send an existing row without the columns the role may not update, and a new one without those it may not insert.
- d12f866: Saving a record's edit form sends only the fields that changed. It used to send every field the form showed, so saving one field wrote the whole row back as it stood when the form opened — a status another person changed meanwhile, a total a trigger updated, a column a job fills, all silently put back. A field left as it was is now neither sent nor checked, so a record kept from before a column became required can be saved without filling it; a field that a change on the form makes required (a person, once the event is marked away) is still checked. Values are compared as they would be sent, so a price the database returns as `12.50` is unchanged when it still reads `12.5`, and a date left alone can no longer shift by a day. An edit of a record's links or line items alone is saved without touching the record's own fields, and saving with nothing changed writes nothing: no `updated_at` stamp, no automations, no Undo. A new record still sends every field.
- 045e3ab: A Postgres `text[]` or `varchar[]` column is edited as a list. The form showed it as a plain text box holding the array's text, and saving anything typed there failed, because Postgres reads `red,blue` as no array at all. Such a column is now marked a list when its page is generated or its table's facts are read, the form edits it as chips — one per item, duplicates refused, at most fifty — and it is saved as the database's own array. MySQL and SQLite have no array columns, so nothing changes there.
- Updated dependencies [2dfe2f8]
- Updated dependencies [625f9ab]
  - @adminium/i18n@0.3.5
  - @adminium/charts@0.3.5
  - @adminium/tokens@0.3.5
  - @adminium/ui@0.3.5

## 0.3.4

### Patch Changes

- 4d26196: Text holding the character U+0000 (often pasted in from another program, invisible on screen) is refused on every engine, from every door a row is written through: a form, a bulk edit, an import, an automation, project code and the public API. Postgres cannot store it, so a save there failed with a server error, while MySQL and SQLite kept a value no Postgres copy of the data could hold. Now it is refused before anything is sent to the database, in any column and anywhere in a JSON value, with the column named: `422` `VALIDATION_FAILED` with the field's code `invalid-character`, which the record form shows under the field, and an import reports the row. The same character in a request's path or query (an id, a search, a filter, a sort) was a server error on Postgres too, and read as something else on the other two: every API request is now refused `400` for it before anything reads it, naming the parameter (`PUBLIC_QUERY_REFUSED` with `params.parameter` on the public API). So is a request body bound for Adminium's own store (a person's name, a role, a setting, a page's title), which on a Postgres store was a server error too, naming the field; a row's values keep the column-named refusal above.
  
  A public create refused by a column's own rules now says which column and why, so a public form can mark the field instead of saying only that something was refused. `PUBLIC_WRITE_REFUSED` carries `params.column` and `params.reason` when the value was too long, not in the format the rule asks for, left empty, or held U+0000, in a column the entry lets the caller write; a change is told the same except for an empty column, and a batch adds the row's `index`. A value another row already holds, one pointing at a row that is not there, and one outside a list still name no column: those would tell a stranger what the table holds.
  
  A void invoice can let go of what it billed. A child a document's states lock may take `release: { "when": ["void"], "columns": ["time_entry_id"] }`, in a state no move leaves: while the invoice is void, its line may empty those columns and change nothing else, so the time or purchase can go on the next invoice. Before this a void invoice's line was locked for good, and so was the time it had billed. And a child may keep the row its link points at: `lockLinked: { "time_entry_id": ["hours", "date"] }` refuses a change to the time's hours while a line on an invoice that is not void bills it (`409` `RECORD_LOCKED` naming the column, on every door, an undo included), and the time's record page draws those fields read-only. A line written at the same moment as a change to the hours it copies is refused with `WRITE_CONFLICT`, to be made again, so it never bills hours the time no longer has. An app built on the Invoices & Receipts shape may add both on the columns it adds to the shape's lines.
  
  A number an email says is written in the digits of the language it is sent in, like the amounts and dates beside it: the days an invoice is late (`{{invoice.due_on.days_since}}`), the minutes a sign-in link or code works, the minutes a password reset link works, the days an invitation works, and the hours before a booking and the size of its party in a booking confirmation. An Arabic reminder read «متأخرة 47 يومًا» beside an amount in Arabic digits. English emails read exactly as before, and a code the reader types back stays in Latin digits.
  
  Someone whose roles open only an app's own screens was refused the rest of the API only when a request spelled `/api/` literally: `/%61pi/v1/roles` reached the same route past the check, answered by the route's own permission check instead. The check now goes by the route a request reaches, however it is spelled. A request body nested more than 64 levels deep is refused `400` unread.
- Updated dependencies [4d26196]
- Updated dependencies [4d26196]
- Updated dependencies [4d26196]
  - @adminium/i18n@0.3.4
  - @adminium/charts@0.3.4
  - @adminium/tokens@0.3.4
  - @adminium/ui@0.3.4

## 0.3.3

### Patch Changes

- 1e00e94: A column can be required only for some values of another column of its row: `"requiredWhen": { "column": "kind", "in": ["away"] }` asks for `person_id` on an away event and not on one in the office. A create or an update that leaves the column empty while the other column holds one of the values is refused on every door (a form, a bulk edit, an import, an automation, an outbox's change) with 422 `VALIDATION_FAILED` and the code `required` on the column, and on the public API with its one refusal. Moving the other column to one of the values over an empty column is refused too. A create that leaves the other column out is judged by that column's database default. A yes is a yes in any spelling (`on`, `y`, ` true`, `1`), and on MySQL a text value is compared as MySQL compares it (`AWAY ` is `away`). An edit that changes neither column is not judged, so a row kept from before the rule can still be edited, in the record form too. Two people changing the same row at once cannot together leave it breaking the rule: the second write is refused. Studio refuses the rule beside `required`, on a column Adminium fills, or with a value the other column's own list does not have, as the manifest does, and a yes or a no for a number column on Postgres or MySQL. A number written to a number column there stays a number, whatever a rule lists. The record form marks the field required as soon as the other column holds one of the values, including a yes read back as `1`.
- Updated dependencies [69ba57d]
  - @adminium/i18n@0.3.3
  - @adminium/charts@0.3.3
  - @adminium/tokens@0.3.3
  - @adminium/ui@0.3.3

## 0.3.2

### Patch Changes

- @adminium/charts@0.3.2
  - @adminium/i18n@0.3.2
  - @adminium/tokens@0.3.2
  - @adminium/ui@0.3.2

## 0.3.1

### Patch Changes

- b1e2d35: A page link's filters can count days from today (`gte:today-30`) and compare a time to now (`before:now`), and every list template — inbox, master-detail, directory, board, calendar, scheduler, files and logs — applies them and shows them as chips.
- 9733a1c: A dashboard card's window can reach forward ("due today or later"), a page link can carry filters the list applies and shows as chips, a page can link to its app's staff screens, and KPI cards gain seven icons.
- Updated dependencies [3788045]
- Updated dependencies [7426bc4]
- Updated dependencies [b1e2d35]
- Updated dependencies [85e813a]
- Updated dependencies [9733a1c]
- Updated dependencies [94b24f9]
- Updated dependencies [f8af340]
- Updated dependencies [4ca20c3]
  - @adminium/i18n@0.3.1
  - @adminium/charts@0.3.1
  - @adminium/tokens@0.3.1
  - @adminium/ui@0.3.1

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
- Updated dependencies [64a1f12]
- Updated dependencies [d3a8058]
- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [64a1f12]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [c451e7d]
- Updated dependencies [ae41762]
  - @adminium/i18n@0.3.0
  - @adminium/ui@0.3.0
  - @adminium/tokens@0.3.0
  - @adminium/charts@0.3.0

## 0.3.0-rc.4

### Patch Changes

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
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
  - @adminium/i18n@0.3.0-rc.4
  - @adminium/ui@0.3.0-rc.4
  - @adminium/charts@0.3.0-rc.4
  - @adminium/tokens@0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
  - @adminium/i18n@0.3.0-rc.3
  - @adminium/tokens@0.3.0-rc.3
  - @adminium/ui@0.3.0-rc.3
  - @adminium/charts@0.3.0-rc.3

## 0.3.0-rc.2

### Patch Changes

- @adminium/charts@0.3.0-rc.2
  - @adminium/i18n@0.3.0-rc.2
  - @adminium/tokens@0.3.0-rc.2
  - @adminium/ui@0.3.0-rc.2

## 0.3.0-rc.1

### Patch Changes

- @adminium/charts@0.3.0-rc.1
  - @adminium/i18n@0.3.0-rc.1
  - @adminium/tokens@0.3.0-rc.1
  - @adminium/ui@0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- Updated dependencies [c451e7d]
  - @adminium/i18n@0.3.0-rc.0
  - @adminium/charts@0.3.0-rc.0
  - @adminium/tokens@0.3.0-rc.0
  - @adminium/ui@0.3.0-rc.0

## 0.2.9

### Patch Changes

- Updated dependencies [ad014d7]
- Updated dependencies [962671c]
  - @adminium/i18n@0.2.9
  - @adminium/charts@0.2.9
  - @adminium/tokens@0.2.9
  - @adminium/ui@0.2.9

## 0.2.8

### Patch Changes

- Updated dependencies [7b0e544]
- Updated dependencies [3d627e5]
- Updated dependencies [3d627e5]
  - @adminium/i18n@0.2.8
  - @adminium/charts@0.2.8
  - @adminium/tokens@0.2.8
  - @adminium/ui@0.2.8

## 0.2.7

### Patch Changes

- @adminium/charts@0.2.7
  - @adminium/i18n@0.2.7
  - @adminium/tokens@0.2.7
  - @adminium/ui@0.2.7

## 0.2.6

### Patch Changes

- 9f47a62: **The generated chat page answers as itself, and stays live.** Two defects on
  the one page whose whole purpose is replying to somebody.
  
  A staff reply stamped **no author**. The composer's insert wrote the body and
  the conversation key and nothing else, so nothing came back for the page's own
  "is this mine" check to match — and every message an operator sent rendered on
  the *other* side of the thread. The send now stamps the signed-in user's e-mail
  into whichever author column the table has.
  
  `toChatMessages` also reads a **sender-kind** column, where the table has one,
  *before* falling back to matching the author's name. That ordering is the
  security half: an author name is writable by an anonymous visitor through the
  public surface, and without it somebody typing a support agent's address into
  their own name field would appear on the agent's side of the agent's own inbox.
  A sender kind is stamped server-side and cannot be. The detection vocabulary is
  deliberately the narrowest in the module — `role`, `type`, `direction` and
  `kind` are all refused, because this column decides which side of a thread a
  bubble lands on and a false positive would re-side an app's whole history.
  
  The page also **subscribes** to its two tables' live channels now. It always
  claimed to; the invalidation map did fire on such an event, but nothing had
  opened the channel, so the frames went to a socket the page was not on. Both
  tables, because the two halves move on different writes: a message moves the
  thread, and the same exchange moves the rail's preview, timestamp and unread
  count.
  
  Studio's scope editor documents the two `$generate` sentinels under the scope
  document field, in all eight locales.
- Updated dependencies [ce438a0]
- Updated dependencies [ce438a0]
- Updated dependencies [9f47a62]
- Updated dependencies [f73fffc]
- Updated dependencies [f2fd258]
- Updated dependencies [3a38695]
- Updated dependencies [cb398f1]
  - @adminium/i18n@0.2.6
  - @adminium/charts@0.2.6
  - @adminium/tokens@0.2.6
  - @adminium/ui@0.2.6

## 0.2.5

### Patch Changes

- @adminium/charts@0.2.5
  - @adminium/i18n@0.2.5
  - @adminium/tokens@0.2.5
  - @adminium/ui@0.2.5

## 0.2.4

### Patch Changes

- @adminium/charts@0.2.4
  - @adminium/i18n@0.2.4
  - @adminium/tokens@0.2.4
  - @adminium/ui@0.2.4

## 0.2.3

### Patch Changes

- 7e5f704: A data connection can now be PAUSED instead of deleted.
  
  Deleting was the only way to stop Adminium touching a source database, and it
  takes the generated pages with it — so "turn this off for the migration
  window" and "I am done with this database" had one button between them. Studio
  → Data connections now carries a Pause/Resume action per card.
  
  The state is a new `adminium_connections.disabled_at` column (meta wave 0019),
  deliberately NOT a `status` value: `status` is a health reading and every
  connection test overwrites it, so a pause folded into that enum would be
  silently undone by the next successful probe — and a connection that was
  FAILING when it was paused would lose that reading on the way. Health is
  observed, a pause is intended; two facts, two columns, and the card can say
  "paused, and it was failing when you paused it". The timestamp (rather than a
  boolean) is what lets the card say *how long* — a source paused for an hour
  during a migration and one paused five weeks ago and forgotten are the same
  boolean and very different situations. NULL means serving, so no backfill.
  
  Enforcement is at the source-database boundary, not in the UI that offers the
  button. `ConnectionManager.data/dataAdapter/introspectAdapter` refuse with a
  new 503 `CONNECTION_DISABLED`, which is what covers every caller with no
  operator in the loop: scheduled reports, export and import jobs, quick search,
  widget refreshes and the public API. The check runs ahead of the pooled-handle
  cache on every call, because the pool is process-local and a pause is a row in
  the meta store — checking only on a cold open would leave a warm handle in a
  second server process serving a source somebody had switched off. Pausing also
  disposes the pool, so a paused connection holds no sockets open. `mustFind`
  deliberately does NOT refuse: Studio has to be able to read and resume the row.
  
  - `PATCH /api/v1/connections/:id` accepts `disabled`, audited under its own
    `connection.disable` / `connection.enable` actions. Omitted leaves the pause
    alone, so a rename never resumes a source by accident.
  - `POST /connections/:id/test` and `/introspect` refuse while paused — the
    introspect refusal lands before the job is enqueued, so the operator is told
    while they are still looking rather than by a job that fails out of sight.
  - The public API maps the refusal to its own `PUBLIC_UPSTREAM_UNAVAILABLE`:
    that surface's callers are the tenant's customers, who cannot resume
    anything and should not learn the operator switched a database off.
  - A paused connection's pages leave the SIDEBAR, and every other surface that
    enumerates pages with them: the command palette, G-chord jumps, the 404's
    suggestions, and the page pickers in scheduled reports, exports and imports
    (all of which read `flattenNav(bootstrap.nav)`). They leave `hiddenPages`
    too — that list is still enumerated by record-page related tabs and
    cross-links, and a paused source must be enumerable by nothing. Quick search
    drops the connection from its candidate set rather than dialling it and
    degrading every table to a `partial: true` group.
  - They travel in a new `pausedPages` bootstrap field read by exactly one
    caller: the `/p/<slug>` URL resolver. A bookmark, or a tab that was open when
    the pause landed, renders the `connection-paused` state instead of a 404 —
    the page has not gone, its database has.
  - Pausing publishes on the `config-changed` realtime channel, so every signed-in
    session drops its bootstrap cache. The operator who flips it is rarely the
    only person looking at the sidebar.
  - Pages over a paused connection get a new `connection-paused` system state
    and a matching template panel — "This connection is paused", calm tone, and
    no Retry button, because retrying cannot change the answer until a person
    resumes it. The four data templates that render an error panel share one
    `describeDataError` helper for it.
  - The desktop runtime chip stops counting a paused remote as either reachable
    or offline; the hub's "healthy" count drops it and the header says how many
    are paused, but only when some are.
- 8ed7972: Fix the Email Templates builder rendering an empty canvas for every stored template.
  
  The surface was non-functional in both directions on every install, and had been
  since it shipped. `apps/server/src/email/render.ts` owns a closed six-kind
  vocabulary — `email.heading`, `email.text`, `email.button`, `email.divider`,
  `email.spacer`, `email.footer` — and that is what `seedBuiltinEmailTemplates`
  writes to `adminium_email_templates` at every boot and what `renderEmail` turns
  into MIME. The builder canvas knew a different vocabulary entirely: the 22
  `block-*` document ids (`block-line-items`, `block-tax-breakdown`,
  `block-qr-pay`, …). The intersection was empty.
  
  So `emailDoc.ts` classified every block of every seeded row as `unknown`,
  `blockOrder` came out `[]`, and the editor opened on "No blocks yet" for all 24
  rows a fresh install seeds (3 built-ins × 8 compiled locales). The reverse trip
  failed the same way: the palette could only offer `block-*` ids, `renderEmail`
  skips any kind outside its vocabulary, so anything an admin added was saved,
  shown as saved, and then silently dropped on send.
  
  **Neither half ever failed loudly, and that is why CI stayed green.** An
  unrecognised kind is *skipped* on both sides — deliberately on the server, where
  throwing would turn a stale row into a 500 on the password-reset path and lock
  someone out of their own account. The only coverage the surface had fed it
  hand-written docs made of `block-highlight-box` / `block-contact`, ids the canvas
  already knew and the mail renderer never did, so the one broken thing was the one
  thing nothing exercised.
  
  **The canvas moved to `email.*`, not the other way round.** The stored
  vocabulary is the wire format of a production table and of sent mail; the
  `block-*` set is a UI list. Changing code is free, migrating seeded rows in every
  install is not. A mapping between the two was never an option either: the 22
  document blocks contain no heading, paragraph, button, divider, spacer or footer,
  so nothing could express a transactional email, and a lossy round trip would have
  written `block-*` into stored rows — upgrading a broken editor into one that
  blanks real password-reset mail. The Email Templates comp settles it too: its
  inspector is Heading / Body paragraphs / Call-to-action / Footer text, and the
  five ecommerce modules that `DOC_TYPE_BLOCKS.email` used to hold are the comp's
  *optional* rail. They are still there, one click down the palette.
  
  Six canvas blocks back the kinds (`BlockEmail.tsx`). They read the stored payload
  bare rather than through `rowOf`, because that payload is the template entry's own
  `data` object and wrapping it would mean rewriting what the server sends.
  `email.button` renders as a styled span plus its destination in mono, not an
  `<a href>`: this is a preview inside an editor, a real link would navigate away on
  the click meant to select the block, and the href is usually an unresolved
  `{{resetUrl}}`. The heading renders as a weighted `<p>` carrying `data-level` —
  the canvas already emits an `<h3>` block label, so a real `<h1>` inside it would
  invert heading order on every template.
  
  **Payloads are now keyed by instance id, not block id.** Repeated kinds are the
  ordinary case here — `password-reset` has an `intro` paragraph and a `notice`
  paragraph, both `email.text` — and block-keyed storage collapses the two, showing
  one sentence twice while the other is unreachable. `blockDataForInstance` reads
  the instance id first and falls back to the block id, so no existing invoice or
  report doc changes shape. For the same reason the canvas now emits
  `blockInstanceOrder` alongside `blockOrder`: two instances of one kind produce an
  identical sequence of block ids, so "swap the two paragraphs" was a silent no-op.
  
  Because `apps/server` may not import `@adminium/widgets` and there is no runtime
  package both depend on, the vocabulary crosses that boundary the way the LLM
  allow-lists already do — declared on each side, held identical by
  `scripts/check-email-block-vocab.mjs` in CI. The gate compares both lists in
  order, checks each kind actually reaches a renderer on both sides, and checks
  that `BLOCK_IDS` still spreads `EMAIL_BLOCK_KINDS`: an earlier draft that compared
  only the two lists passed happily while `isBlockId` rejected all six kinds, which
  is the exact failure being fixed.
  
  Regression coverage runs a row copied verbatim out of a seeded install's meta
  store through `emailDoc.ts` into the rendered page, and asserts six block
  instances, two distinct paragraphs, a byte-identical round trip, and no empty
  state. The server side asserts every vocabulary kind renders non-empty HTML, that
  the real `builtins.ts` seed emits only vocabulary kinds in all eight compiled
  locales, and that an unknown kind is still skipped rather than thrown on.
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
- 9e1adf7: Fix: the six email blocks all drew the same placeholder glyph.
  
  `BLOCK_KIND_META` names an icon slug per block and `PageBuilder`'s `BLOCK_ICONS`
  maps that slug to a component, with `?? SquareDashed` behind it. The email
  flavour's message rail — Heading, Paragraph, Call-to-action, Divider, Spacer,
  Footer — was added to the registry without being added to the map, so all six
  fell through to the default. Seven of the seventeen rows in the email palette
  drew an identical dashed square (the six, plus `block-highlight-box`, which
  names that glyph on purpose), and the six sat adjacent at the top of the list
  where the difference matters most.
  
  Cosmetic rather than broken: every row keeps its own text label, and the glyph
  is `aria-hidden`, so a screen reader was never affected. But it is six controls
  a person has to read one by one in a rail designed to be scanned.
  
  The six entries are direct named lucide imports, like the other twenty-two, so
  they ride in the page-builder's own lazy chunk. The dashboard's entry chunk
  grows by four bytes gzipped — those bindings are already in it for an unrelated
  reason (`gen-icon-core.mjs` sweeps this file's `icon:` literals into the
  statically-imported core set, which is its own problem and not this one).
  
  **And a test that can see it.** Nothing could, before: the registry test asserts
  only that the slug is kebab-shaped, so six unmapped-but-well-formed slugs passed
  it; VRT skips this template because `PageBuilder.stories.tsx` carries no `vrt`
  tag, so the story that renders the defective palette is never screenshotted; and
  axe cannot see a glyph marked `aria-hidden`. Every palette row on every doc type
  that has one is now rendered and checked.
  
  The assertion is "draws the placeholder if and only if it asked for the
  placeholder" rather than "the rendered class matches the slug", and the
  difference is load-bearing. Written the strict way it failed immediately on
  `bar-chart-3`, which renders `class="lucide lucide-chart-column"` — a deprecated
  lucide alias, still a legal named import, still the right glyph. A class-equality
  check would have been red on a name that is fine, and the fix for it would have
  been to break something.
- Updated dependencies [36fb706]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [36fb706]
- Updated dependencies [7e5f704]
- Updated dependencies [8ed7972]
- Updated dependencies [37c99f2]
- Updated dependencies [9e1adf7]
- Updated dependencies [9e1adf7]
  - @adminium/i18n@0.2.3
  - @adminium/ui@0.2.3
  - @adminium/charts@0.2.3
  - @adminium/tokens@0.2.3

## 0.2.2

### Patch Changes

- 0664dd4: Burn 43 accessibility violations down to zero, and ratchet the baseline from 112
  to 69.
  
  The distinction from the previous move matters: 162 -> 112 was ~85%
  re-measurement, where fingerprints left because the harness changed. All 43 here
  left because component code changed, each verified gone by re-running the sweep
  against a freshly built Storybook rather than by editing the baseline.
  
  **20 `nested-interactive` — DocumentCanvas.** Every block was wrapped in
  `role="button" tabIndex={0}` to get click-to-select. That role is
  children-presentational, so the line-item table, its four column headers and its
  qty/rate inputs were stripped from the accessibility tree and the entire block
  announced as the single string "block-line-items, button, not pressed". The
  wrapper is now inert and selection rides a real `<button>` named from the block's
  own visible, localized heading — so the table is a table again, the headers
  associate with the inputs, and Enter/Space work natively instead of through a
  handler that had to guard against stealing Space from a number input.
  
  **12 `aria-valid-attr-value` — TabBar.** The strip renders no `TabsContent` by
  design, but Radix's Trigger emits `aria-controls` pointing at a panel id
  unconditionally, so every selected tab advertised a relationship to an element
  never in the DOM. axe skips a dangling IDREF on `aria-selected="false"`, which is
  why this was 12 fingerprints rather than 60.
  
  **11 `color-contrast`.** Three wrapper `opacity` utilities dragged informational
  text sitting beside operable controls to 2.21–3.29:1 — including the product's
  primary `--fg` token failing AA purely from a container — on exactly the text
  someone reads to decide whether to re-enable a dormant webhook or policy. WCAG's
  inactive-component exemption does not apply to content beside a live Switch. The
  loyalty banner also moved off the accent tint, where its headline number was the
  least readable text in the block at 4.42:1.
  
  Two `qa-widget-states` entries were deliberately NOT pruned: they did not
  reproduce before this change either, so there is no evidence they are fixed
  rather than sitting below axe's 13px overflow buffer on this machine.
- 2516a82: Make the two genuinely-clipping scroll containers keyboard-reachable — baseline
  49 → 29, and `scrollable-region-focusable` reaches zero.
  
  Unlike the gantt canvas, whose overflow was a phantom from one unclamped marker,
  DiagnosticsReadout and ValidationIssuesList really do clip content: a
  keyboard-only operator could read the first four checks of a failing connection
  and not the one that failed.
  
  `useScrollRegion` attaches the tab stop CONDITIONALLY — it measures and applies
  `tabIndex`/`role` only while the container actually overflows, so a resize that
  removes the clipping removes the stop. That matters beyond tidiness: four
  scrollers already carrying `role="region" tabIndex={0}` in this repo have zero
  overflow in their own stories, so they ship four dead tab stops and four spurious
  landmarks today. The blanket fix would have added 38 more.
  
  No `+13` fudge against axe's overflow buffer. An earlier design mirrored it so
  "the gate and the product agree"; they do not — axe fired on the gantt at 12px,
  so a 13px threshold would leave a flagged node without a stop.
  
  Regions are named by the WidgetFrame heading id (new `WidgetHeadingContext`)
  rather than an invented string, so a screen reader announces the words already on
  screen — "Connection check", not a second vocabulary — and this adds **zero i18n
  keys**. That is deliberate: the previous batch of aria-label keys shipped as
  literal English into seven locales while labelled machine-translated.
  
  The list passes no `role`: an explicit one would override the `<ul>`'s implicit
  `role="list"` and destroy the "list, N items" announcement.
- 8477a70: Close the last nine axe fingerprints — the baseline is now empty.
  
  **GlobalSearch (2, the only criticals left).** The dropdown rendered a Radix
  `PopoverTrigger` onto a `div`, emitting `type="button"` and `aria-haspopup` onto
  an element with no button role. It is a `PopoverAnchor` now, and the field is a
  real combobox: `role="combobox"`, `aria-expanded`, and `aria-controls` /
  `aria-activedescendant` emitted only while the listbox exists. It also gained the
  keyboard model it never had — arrows with wrap, Home/End, Enter, and an Escape
  that actually closes, which it could not before because `onOpenChange` was absent
  and Radix's dismiss path had nowhere to write.
  
  **TopMoversList (2).** Not a missing tab stop — a layout defect. A fixed-width
  delta column plus a `shrink-0` sparkline overflowed the row by 6px, clipping the
  value. A container query drops the sparkline below 20rem of container width:
  measured 274 → 268px, zero overflow. Adding `tabIndex` would have satisfied axe
  while leaving the content clipped.
  
  **The other five were never live.** Already fixed by the opaque-chip work, and
  still reported only because widget stories bundle `@adminium/ui` from its built
  `dist` while ui stories use `src` — the Storybook build predated the dist
  rebuild, so one sweep measured two different `Badge` implementations. The rebuild
  order is now recorded in the baseline.
  
  Two regressions the combobox work introduced, both invisible to axe because the
  story renders with the panel closed: the keyboard cursor was a 10% tint at ~1.1:1
  against the panel — the only indication of where Enter would go — and the match
  highlight composited over the active row's own tint, dropping below AA. The
  cursor now carries an accent rail as well as a solid tint, and the highlight uses
  weight and an underline instead of a background.
  
  Also fixes a Rules-of-Hooks violation introduced earlier the same day:
  `ValidationIssuesList` called `useScrollRegion` after its empty-state early
  return, so a populated list going empty threw "Rendered fewer hooks than
  expected".
  
  Adds a gated `selection` group to the token contrast check (240 pairs): `::selection`
  set a background and left the foreground to whatever text was dragged across, so
  the pair was undefined by construction.
- cca257b: Give the gantt bar's progress-% label its own opaque plate, clearing the largest
  remaining `color-contrast` group in the sweep (16 fingerprints).
  
  The label was painted `text-fg-muted` — a token sized for the grey TRACK — while
  it physically sits on the solid tone FILL, six pixels in from the bar's start
  edge. The `task.pct > 55 ? 'text-accent-fg' : 'text-fg-muted'` ternary that was
  meant to catch this is a PERCENTAGE proxy for a PIXEL question, and it is wrong
  at most bar widths: on any bar more than a few dozen pixels wide the label is
  over the fill long before the fill reaches 55%. Composited from the token CSS,
  `--fg-muted` on the tone fills measures 1.01:1 (dark `--pos`) to 2.16:1 (light `black` accent; 1.71:1 on light
  `--pos`) across the tones and all eight accents, and 1.29:1 on the neutral
  `--fg-subtle` fill in both themes — against a 4.5:1 floor for 10px bold text.
  
  No better threshold exists to reach for. The fill is a percentage of a
  flex-sized bar, so the component cannot know where the label lands without
  measuring at runtime. Two alternatives were tried and rejected: a `clip-path`
  two-copy scheme (the var lives on the fill, not the bar, so it computed to
  `none`; axe ignores `clip-path` and `color-contrast` runs `excludeHidden: false`,
  so the hidden copy counted too — 3 violating nodes became 4), and an
  `aria-disabled`/opacity dodge, which silences the rule without moving a pixel.
  
  So the label stops depending on what is behind it. An inner
  `rounded-sm bg-surface px-1` span puts one known opaque token under the text
  regardless of tone, accent, fill percentage or bar width: `--fg-muted` on
  `--surface` measures **8.75:1 in light and 9.25:1 in dark**, identical in every
  accent. Over an unfilled stretch the plate is 1.13:1 against the `--surface-3`
  track, i.e. all but invisible — so bars that read fine before still look the
  same, and only the label sitting on colour gains a visible chip.
  
  For a sighted low-vision user this is the difference between a number that is
  there and a number that is not: at 1.0-1.7:1 the densest datum in the widget was
  effectively unreadable at any zoom or contrast setting, and it now reads at the
  same strength as the task name in the gutter beside it. Assistive-technology behaviour is **unchanged** either way — the bar has
  always carried `role="img"` with an aria-label of `"label · pct"`, so the visual
  label is decorative and was never the accessible name. No 1.4.11 non-text floor
  attaches to plate-against-fill for the same reason.
  
  The bar's `overflow-hidden` and the milestone/today-line clamps
  (`min(…, calc(100% - 14px))`, `calc(100% - 2px)`) are untouched — those close a
  different defect (a phantom horizontal scroll) and must not regress.
- cca257b: Clear the gantt canvas's 16 `scrollable-region-focusable` violations by removing
  the overflow rather than by making the region focusable — baseline 69 → 53.
  
  The obvious reading is that the timeline is too wide for its card and a keyboard
  user cannot scroll to the rest of the project. Measured, that is false: at the
  sweep's own viewport the canvas is 746px against a 734px client width. The 12px
  comes from ONE absolutely-positioned milestone diamond placed at ~100% with no
  clamp, so its rotated bounding box hangs past the right edge.
  
  That distinction decides the fix. Adding `tabIndex` would have put a keyboard
  stop — and, in the version first proposed, a landmark — on a region containing
  nothing to reach, which satisfies axe while making the product slightly worse to
  navigate. The same proposal would have added 38 such stops across four families.
  Clamping the marker to `calc(100% - 14px)` removes the phantom scroll, so there
  is no scrollable region left to be unreachable.
  
  The today-line marker is clamped the same way (`calc(100% - 2px)`): a project
  whose current date lands on the last day would otherwise reintroduce the
  identical defect from a different direction.
- 8477a70: Make `global-search`'s header dropdown a real combobox, clearing the last two
  CRITICAL `aria-allowed-attr` violations in the axe baseline.
  
  The field was wrapped in a Radix `PopoverTrigger`, which stamps
  `type="button"`, `aria-haspopup="dialog"` and `aria-expanded` onto a plain
  `<div>`. A screen reader therefore announced the search box as a dialog trigger
  sitting on an element that cannot be activated at all — the two fingerprints
  axe was reporting, and only the visible symptom of a panel nobody could work:
  
  - **Escape was inert.** `open` was derived from the query alone, so Radix's
    dismiss path had nowhere to write and the panel could not be closed from the
    keyboard. It is now real state; Escape dismisses, an arrow key brings it back
    (the query survives), and a second Escape clears the field, per APG.
  - **Typing lost the caret.** Radix moves focus into the panel on open, and the
    panel opens on the *first* keystroke — so focus jumped to the first result
    mid-word. Both auto-focus events are now prevented and focus never leaves the
    field.
  - **Tab was a trap.** Radix mounts its FocusScope with `loop: true`, so once
    focus reached a row, Tab cycled through the panel forever. Rows carry
    `tabIndex={-1}` and are reached with the arrow keys instead.
  - **The rows were unreachable by keyboard.** ↑/↓ (wrapping), Home/End and ↵ now
    drive an `aria-activedescendant` cursor, with the active row highlighted for
    sighted keyboard users. ↵ replays the row's own click path, so it agrees with
    a mouse click on `onNavigate` and on plain browser navigation.
  
  The panel itself is now the listbox the combobox controls, rather than a dialog
  with a list inside it; when a query matches nothing it is a status region
  instead, because a listbox may only own options. The full-page variant's
  `<ul>/<li>` result markup is unchanged.
- b204486: Stop MasterList flattening its own rows out of the accessibility tree — baseline
  29 → 25, and `nested-interactive` reaches zero.
  
  The row carried `role="button"` with a tabIndex and a key handler to make the
  whole row clickable. That role is children-presentational, so every control
  inside it was erased for AT users: a screen-reader user heard one flattened
  string and lost the StatusPill, the ProgressBar's value, and the Switch's role
  and on/off state entirely — the exact failure `nested-interactive` names.
  
  The row is now inert. Selection rides the visible row TITLE as a real `<button>`
  whose `::after` stretches the hit area back over the whole row, so the mouse
  target is unchanged and `has-[:focus-visible]` still paints the ring around the
  row. Because the accessible name is the title the user can already see, there is
  no sr-only duplicate string and no new i18n key — which also means no edits
  across 8 locales and no regeneration of the a11y-keys drift guard.
  
  The Switch gets `relative z-10` to sit above that hit area, and loses a
  `stopPropagation` that no longer has an interactive ancestor to stop.
  
  `track-f-widgets.test.tsx` passes UNCHANGED. That is the tell: `getByText('Beta
  rule')` now resolves inside the button, so the click lands on a real control
  rather than propagating from a sibling — which an overlay-based fix would have
  broken.
- 1002d67: Give ScheduleMatrix's `role="table"` the header and cell roles the role requires
  — baseline 53 → 49.
  
  A table's rows must contain header/cell roles. Column 1 of the header row was a
  bare `<span>`, the resource cell had no `rowheader`, and the coverage cells had
  no `cell`, so a screen reader announced the first column as nothing and the
  coverage row as unstructured text.
  
  The fix is a verbatim port from the twin file `ShiftMatrix`, which already had
  the correct treatment — and the twin got the two pieces IT was missing
  (`columnheader` on its own leading span, `aria-hidden` on its Avatar), so the
  fork stops drifting further apart.
  
  The Avatar needed hiding either way: its `aria-label` repeats the name rendered
  beside it, so the rowheader's accessible name was doubling to
  "Ana Trujillo Ana Trujillo, Manager · 32h".
  
  `calendar-widgets.test.tsx`'s weekStart case took the first `[role="columnheader"]`
  as the first DAY column. "Resource" is legitimately a columnheader now, so the
  selector moves to index 1 with an assertion pinning why.
- 8477a70: Fix the top-movers row so it fits its column — the last two
  `scrollable-region-focusable` entries, and a content bug the rule was pointing at
  all along.
  
  These two fingerprints survived five passes because they never reproduced on a
  macOS developer machine: the list overflowed by 6px and axe's matcher carries a
  13px buffer. Measured in headless Chromium at the sweep's own 1280px viewport,
  against the QA gallery's 4-up row, the overflow is real and it is not the
  interesting part.
  
  Four of the five columns are `shrink-0` — icon tile, sparkline, value, delta pill
  — so flexbox spends the only flexible one, the NAME, first. In a 252px column
  that is not a near miss. Three of the five metric names rendered 18px wide and
  **two rendered at zero width**, so a row reading "Refunds · $3,202.00 · −18.9%"
  showed as an anonymous icon, a sparkline and two numbers with nothing saying
  which metric had moved. The row still overflowed its line box by 14px on top of
  that.
  
  So this is a layout defect, not a missing tab stop. `tabIndex={0}` on the
  container would have satisfied the rule and left every name clipped — the same
  defect as baselining, with extra steps.
  
  The fixed columns need 204px (12 padding + 4×12 gap + 28 tile + 48 spark + 68
  pill) before a single character of name or value, and a currency value with cents
  measures ~68px, so a legible name only exists from about 320px up. Below `20rem`
  the **sparkline** is dropped, returning 60px with its gap. It is the right column
  to lose: direction and size of the move are already carried twice, by the
  tone-tinted trend glyph and by the delta pill, while the name is the only thing
  in the row that identifies the metric.
  
  Measured before → after at the sweep viewport, 252px of list content:
  
  | | overflow | narrowest name |
  |---|---|---|
  | before | 6px on the list, 14px on the widest row | **0px** (2 of 5 rows) |
  | after | 0px | 40.5px, all 5 rows legible |
  
  A **container** query, not a media query: this widget's width comes from the
  dashboard cell it lands in, not the viewport. At one 1280px viewport it renders
  at 1230px full-bleed and 252px in a 4-up row — measured, the sparkline is
  untouched in the former and only drops in the latter.
  
  The truncated name also gains a `title`, so a mouse user can read a metric the
  column is too narrow to spell out. Screen readers always had the full text.
  
  Separately, the read-only list takes a CONDITIONAL scroll region
  (`useScrollRegion`) for the clipping layout cannot fix: a list taller than its
  frame, whose rows below the fold are unreachable without a mouse. It attaches
  nothing when nothing is clipped, and nothing at all to the drill-through variant,
  whose rows are already `<button>`s. No `role` is passed — an explicit one would
  replace the `<ul>`'s implicit `role="list"` and the "list, N items" count with
  it.
- 08df45d: Fix the accessibility violations the axe sweep had been hiding, and the two
  harness defects that hid them.
  
  `a11y-baseline.json` held 162 fingerprints for four weeks. 111 of them do not
  reproduce at all. The sweep runs over the Storybook build, and that build was
  measuring something the product does not look like: `storybook.css` `@source`d
  only `packages/ui` while `.storybook/main.ts` has loaded the widgets and charts
  stories since, so every widget story rendered unstyled; and nothing painted `--bg`
  on the preview body, so under `data-theme="dark"` stories drew dark-theme
  foregrounds on Storybook's white body — axe resolves `color-contrast` against the
  nearest opaque ancestor, so the translucent tone tints composited over white and
  reported pairs the product never renders.
  
  Fixing both exposed violations the unstyled build had concealed. 128 were found
  and fixed rather than baselined:
  
  - alpha-dimmed small text on the accent bubble and calendar chips
    (`text-accent-fg/70`, `opacity-80`) measured 3.1–3.9:1 and went to full
    opacity — `--accent-fg` on `--accent` is already gated at 4.5:1, the alpha was
    the whole failure;
  - six scrollable regions with no focusable content were mouse-only and now carry
    `tabIndex` with a labelled role (chat transcripts, the AI panel, the queue
    detail pane, three chart matrices, the calendar lists);
  - `role="row"` containers whose children carried no cell role made their whole
    table invalid to assistive tech, and now use `rowheader`/`cell`/`columnheader`;
  - the grouped-summary expander was `aria-expanded` on a row with a keydown shim,
    and is a real `<button>`;
  - a `<dl>` with a direct `<p>` child is corrected;
  - `ChipInput` and paused job rows dim to 40–55% and now say `aria-disabled`,
    which is what makes WCAG 1.4.3's inactive-component exemption apply rather
    than merely look as though it should.
  
  The **AuthLayout brand panel** is the one the sweep can never see — it is
  `aria-hidden`, so axe skips the subtree while a sighted low-vision user reads all
  of it. It painted `--accent`, which resolves to the dark ramp under
  `data-theme="dark"`; that ramp is a foreground colour, so it is light, and white
  copy on it measured **1.64–2.35:1** across the eight accents. It now paints
  `--accent-light` in both themes (5.90–18.88:1), with the white alphas raised and
  the testimonial card darkened rather than lightened. A new `brand-panel` group in
  the token contrast gate measures it, since nothing else can.
  
  Eight `ui.*` keys were added across all locales for the new region labels.
  
  The baseline now holds 112, and getting a trustworthy number took two wrong
  answers first. `data-vrt-ready` was a bare mount effect while widget bodies load
  as per-family lazy chunks, so the sweep raced the stories: a fast machine
  reported 1 violation and CI reported 111 on the same commit. The sweep and the
  VRT spec now navigate with `networkidle` and the flag waits for DOM quiescence,
  after which both agree. Against the original 162: 111 do not reproduce, 51 were
  real all along, and 59 more were exposed once the stories rendered styled.
- 66f0683: Stop bulk export silently dropping every row selected on an earlier page.
  
  `page-crud`'s selection survives paging, and the browser-side export — which is
  the path every user takes, because no host implements the optional
  `CrudApi.export` — filtered the CURRENTLY LOADED page by the selected ids.
  Select on page one, page forward, select again, export: page one's rows were
  gone from the file, with nothing on screen to say so. The toolbar still counted
  them.
  
  The template now snapshots each selected row as it is selected — from the rows
  the grid was rendering when the click happened, so a row that could be clicked
  can never be missed — and exports from that, in selection order. Membership is
  captured in the selection handler rather than in an effect keyed on the loaded
  page: an effect can only record rows that happen to be loaded when it runs,
  which would have made the snapshot depend on effect ordering against the list,
  the same class of bug as the one it exists to fix. Deselecting drops a row from the snapshot; deleting a
  row drops it from the SELECTION too, on the single-row path as well as the bulk
  one — a deleted row must not keep being counted, and must not turn up in a file.
  
  One new string, `templates.crud.toast.exportIncomplete`, covers the case the
  design makes unreachable: if the snapshot were ever short, the export says how
  many rows it wrote. The point of the fix is that a short export can no longer be
  a silent one.
  
  The queued server-side run is deliberately still not wired: `ExportSource` on the
  wire carries `{kind, table, viewId, filters}` and no row selection at all, so
  implementing `export` against it as it stands would widen a selection export to
  the whole table — trading a silent drop for a silent over-export.
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
- Updated dependencies [8477a70]
- Updated dependencies [8477a70]
- Updated dependencies [f987544]
- Updated dependencies [08df45d]
- Updated dependencies [f7c9566]
- Updated dependencies [66f0683]
- Updated dependencies [f987544]
- Updated dependencies [586426a]
- Updated dependencies [08df45d]
- Updated dependencies [e15787b]
- Updated dependencies [d3a04c8]
- Updated dependencies [2dffc12]
- Updated dependencies [1d952df]
- Updated dependencies [2728dea]
- Updated dependencies [4f297da]
- Updated dependencies [00cd08f]
- Updated dependencies [ef1c300]
  - @adminium/ui@0.2.2
  - @adminium/tokens@0.2.2
  - @adminium/i18n@0.2.2
  - @adminium/charts@0.2.2

## 0.2.2-rc.0

### Patch Changes

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
- Updated dependencies [00cd08f]
- Updated dependencies [ef1c300]
  - @adminium/i18n@0.2.2-rc.0
  - @adminium/ui@0.2.2-rc.0
  - @adminium/charts@0.2.2-rc.0
  - @adminium/tokens@0.2.2-rc.0

## 0.2.1

### Patch Changes

- Updated dependencies [4091a4f]
  - @adminium/i18n@0.2.1
  - @adminium/charts@0.2.1
  - @adminium/tokens@0.2.1
  - @adminium/ui@0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/i18n@0.2.0
  - @adminium/ui@0.2.0
  - @adminium/tokens@0.2.0
  - @adminium/charts@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/charts@0.1.0
  - @adminium/i18n@0.1.0
  - @adminium/tokens@0.1.0
  - @adminium/ui@0.1.0

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
