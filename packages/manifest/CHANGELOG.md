# @adminium/manifest

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
- 4d26196: Text holding the character U+0000 (often pasted in from another program, invisible on screen) is refused on every engine, from every door a row is written through: a form, a bulk edit, an import, an automation, project code and the public API. Postgres cannot store it, so a save there failed with a server error, while MySQL and SQLite kept a value no Postgres copy of the data could hold. Now it is refused before anything is sent to the database, in any column and anywhere in a JSON value, with the column named: `422` `VALIDATION_FAILED` with the field's code `invalid-character`, which the record form shows under the field, and an import reports the row. The same character in a request's path or query (an id, a search, a filter, a sort) was a server error on Postgres too, and read as something else on the other two: every API request is now refused `400` for it before anything reads it, naming the parameter (`PUBLIC_QUERY_REFUSED` with `params.parameter` on the public API). So is a request body bound for Adminium's own store (a person's name, a role, a setting, a page's title), which on a Postgres store was a server error too, naming the field; a row's values keep the column-named refusal above.
  
  A public create refused by a column's own rules now says which column and why, so a public form can mark the field instead of saying only that something was refused. `PUBLIC_WRITE_REFUSED` carries `params.column` and `params.reason` when the value was too long, not in the format the rule asks for, left empty, or held U+0000, in a column the entry lets the caller write; a change is told the same except for an empty column, and a batch adds the row's `index`. A value another row already holds, one pointing at a row that is not there, and one outside a list still name no column: those would tell a stranger what the table holds.
  
  A void invoice can let go of what it billed. A child a document's states lock may take `release: { "when": ["void"], "columns": ["time_entry_id"] }`, in a state no move leaves: while the invoice is void, its line may empty those columns and change nothing else, so the time or purchase can go on the next invoice. Before this a void invoice's line was locked for good, and so was the time it had billed. And a child may keep the row its link points at: `lockLinked: { "time_entry_id": ["hours", "date"] }` refuses a change to the time's hours while a line on an invoice that is not void bills it (`409` `RECORD_LOCKED` naming the column, on every door, an undo included), and the time's record page draws those fields read-only. A line written at the same moment as a change to the hours it copies is refused with `WRITE_CONFLICT`, to be made again, so it never bills hours the time no longer has. An app built on the Invoices & Receipts shape may add both on the columns it adds to the shape's lines.
  
  A number an email says is written in the digits of the language it is sent in, like the amounts and dates beside it: the days an invoice is late (`{{invoice.due_on.days_since}}`), the minutes a sign-in link or code works, the minutes a password reset link works, the days an invitation works, and the hours before a booking and the size of its party in a booking confirmation. An Arabic reminder read «متأخرة 47 يومًا» beside an amount in Arabic digits. English emails read exactly as before, and a code the reader types back stays in Latin digits.
  
  Someone whose roles open only an app's own screens was refused the rest of the API only when a request spelled `/api/` literally: `/%61pi/v1/roles` reached the same route past the check, answered by the route's own permission check instead. The check now goes by the route a request reaches, however it is spelled. A request body nested more than 64 levels deep is refused `400` unread.
- @adminium/add-on-contracts@0.3.4

## 0.3.3

### Patch Changes

- 69ba57d: The code a shared link opens a row with is shown to the staff who read its table, even when its name reads like a secret. A studio's `share_token` holds the handover link Adminium made to be sent, but a name with `token` in it was taken for a secret and left out of every answer, admins' included: the desk could not show or copy the link, and "Make a new link" answered without the new code. Now the install says the link's column is no secret, on a table the app made, so the list, the record, a new record and the new link's answer all carry it, and a new record gets its code when it is made. A `code` rule by itself shows nothing: a code column whose name reads like a secret, with no shared link and no `secret: false`, stays one, as every code rule written before this release does. A manifest column may say `secret: true` or `secret: false` to settle the guess Adminium makes from its name, as `personal` does for personal data, but an app shows a column only on a table its install made: on a table it reuses (your `users`, with its `api_token`), a rule that would show a secret or take a personal column's mask off is skipped, the check step says so, and only a Super Admin can show the column, in Studio. A secret you set in Studio wins over an app's word, and an app may add only `secret: true` to a column of an add-on's shape. A Studio save that stops any column being a secret needs Super Admin, as turning off a personal-data mask does, and so does using a project's schema file that would. The public side never shows a code unless an entry names it: an entry or a generated endpoint that names no columns leaves codes out, and no entry or endpoint of the table, anonymous or not, may show, filter, search or order by a shared link's code. The audit log and the automation logs keep `[code]` (or `[new code]`) where a code was, neither the assistant nor an AI-assist prompt's sampling ever reads one, and "Make a new link" answers with the new code only to someone who may read the table. A column renamed from a secret-looking name to a harmless one stays secret. No rule copies a secret, personal data or a shared link's code into a column where it is not kept the same way: a `copy`, a stamp that copies a column of its row, or a formula reading one, is refused in the manifest and in Studio, and skipped (saying why) by an install. A shared link's code is never copied at all. An automation on a deleted row acts on the row as it was, while its log keeps `[code]` and masked values as before.
- 1e00e94: A column can be required only for some values of another column of its row: `"requiredWhen": { "column": "kind", "in": ["away"] }` asks for `person_id` on an away event and not on one in the office. A create or an update that leaves the column empty while the other column holds one of the values is refused on every door (a form, a bulk edit, an import, an automation, an outbox's change) with 422 `VALIDATION_FAILED` and the code `required` on the column, and on the public API with its one refusal. Moving the other column to one of the values over an empty column is refused too. A create that leaves the other column out is judged by that column's database default. A yes is a yes in any spelling (`on`, `y`, ` true`, `1`), and on MySQL a text value is compared as MySQL compares it (`AWAY ` is `away`). An edit that changes neither column is not judged, so a row kept from before the rule can still be edited, in the record form too. Two people changing the same row at once cannot together leave it breaking the rule: the second write is refused. Studio refuses the rule beside `required`, on a column Adminium fills, or with a value the other column's own list does not have, as the manifest does, and a yes or a no for a number column on Postgres or MySQL. A number written to a number column there stays a number, whatever a rule lists. The record form marks the field required as soon as the other column holds one of the values, including a yes read back as `1`.
- 1e00e94: A formula can count the hours between two moments of its row: `{ "hoursBetween": ["started_at", "stopped_at"] }` works a time entry out as 2.50 for 09:15 to 11:45, rounded to the column's places, on Postgres, MySQL and SQLite. The hours are the time that really passed: a time kept without a zone is read on the server's clock, so the night the clocks change counts an hour less or more. A stop stamped `now`, and a time sent without a zone for a column that keeps one, are counted as the moment that is stored. On SQLite a start filled by `unixepoch()`, and a text with its zone after a space, are read as the moments they are. An empty start or stop, a day the calendar does not have (30 February), or a stop before its start, leaves the hours empty rather than wrong. Hours the column cannot hold are refused with 422 `VALIDATION_FAILED`, the code `out-of-range` on the moments they are counted from, on every engine; so is any formula whose result its column cannot hold.
- 69ba57d: A manifest is refused when a column the outbox gives to Adminium (its status, sent time, error, skip reason, approver or effect columns) also has a rule that decides its value, such as a stamp of who approved, or one that refuses a value (allowed values, a validation, required, a date bound). The install used to accept it, and then every message the desk made was refused with "approved_by is written by Adminium", or stuck when Adminium's own write was refused. The address and the language the outbox writes when it looks them up take no rule that decides them, nor allowed values or required; a validation of an address a person types is still fine. Nor may another column's rule read one of them where the read could refuse Adminium's write: a note required once a message is sent, a formula worked out from when it went, or a date kept after it. The refusal names the column and the rule, and a Studio save refuses the same rules on an installed outbox's columns. Adminium's own writes to its outbox are never held to a column required only for some values, so such a rule, however it got there, never stops a message.
- @adminium/add-on-contracts@0.3.3

## 0.3.2

### Patch Changes

- ba84748: An app's document can leave rows out of a list it prints. A `collection` in a document mapping takes `where` (keep only the rows whose column holds one of the values) and `unless` (leave out a row whose column is true or set), the same words a statement's sources use, so a till receipt can skip voided lines with `"unless": "voided"`. Both must name a column of the listed table, or the manifest is refused.
- ba84748: An app's staff screen can send values for the slots its app lets a request fill when it asks for a document, so a label sheet can print as many labels as the screen asks for: `POST /api/v1/apps/<key>/documents/render` takes `values`, by slot id, and a document entry in the manifest lists the slots a request may fill in `requestValues` (up to 8, each one it does not map). Only those are taken: a slot the entry does not list, one that reads a column, one the add-on fills itself (the date, the number, the currency), one that holds money, a percentage, an address or a date, one the document's own typed values fill, or a value the slot cannot hold is refused with 400 and names the slot, and nothing is drawn. An app that lists a slot its add-on keeps for itself is refused at install. A document drawn with values names the slots they filled, is never emailed on its own (someone settles it, as with a customer's own request), and a later print of the same row takes nothing from it. The same values give back the same document; different ones draw it again.
- 2a3e2e3: Two public keys on one database can no longer be set up so that a person signed in on both changes where their own row points through one key and reads another person's rows through the other. Where one key reads rows by a column of their parent (a proposal naming its terms), a key, endpoint, scope or app install that would let another key write that column is refused and says which key and column. Server keys, which no person holds, are not affected.
- e9b4473: An app's email template can list every variable Adminium fills in its `vars`: `appName`, an add-on's public setting (`addOn.<key>.<setting>`), and columns with a number in their name. Before, the list refused them even though the template could use them.
- @adminium/add-on-contracts@0.3.2

## 0.3.1

### Patch Changes

- d332dda: A document's states hold on every write (moves, requirements, roles, locks, child rows, no-delete, dates that only move later); a payment's date may be bounded by today and by its invoice (`notAfter`, `notBefore`); an accepted document is sealed with a fingerprint; a hook may make its judgement part of the update (`expect`).
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
- 85e813a: A few more words an app's manifest may use:
  
  - `rules.normalize`: a text value stored trimmed (`trim`), or trimmed and in
    lower case (`email`), whoever writes it — so an address kept unique and a
    person signing in with it agree on every database.
  - A stamp may copy another column of the same row as it stands when the stamp
    is written (`{copy: <column>}`), and a `byOrigin` stamp may leave staff
    their own choice by naming only the public side's value.
  - A public entry's `writableWhen` may say a date is `before-today`.
  - An app may ship up to 32 email templates.
- 5310571: An outbox producer may be switched off by a bool of the app's settings row
  of its own (`gate: {setting}`), so each notice a studio receives can have its
  own switch.
- 36b94b6: An app's outbox sends only what it made or a person approved. A message an import or an undo brings back waiting to go now waits for a person (held, or failed to queue again) instead of going by itself; one approved with no day worked out goes at once instead of never; and a batched message is dropped or overtaken like any other while its window is open. A batch takes its window as its due, so a manifest may no longer give it another.
- 709f318: A public entry may say which columns a write through it must fill
  (`requires`: accepting a proposal carries the typed name), and a child
  entry reached through its parent (`visibleWith`) may change the rows it
  reaches, naming what it may write.
- 64f6162: A sample bundle must spell a gapless number `null` in every row, so adding sample data never numbers a row into the real series.
- 47cd78c: Sample data can date a row by a day of a month (`{"@month": -2, "@dom": 14}`), so history counted in calendar months keeps its shape whatever day it is added on.
- eb78d63: A sample row can say `"@onlyIfEmpty": true` — an app's own settings row is added only when the operator has none, and never stops the add or takes theirs over.
- c519311: A shared link's key may no longer name an `enabledBy` switch, which nothing read: a shared link is switched off in its own row.
- 4ca20c3: An app's table can be built on an add-on's shape: the install checks it against the installed add-on's pinned shape (409 SHAPE_MISMATCH naming the column), records which columns the shape owns, and the column inspector marks the shape's rules as set by the add-on and asks before one is switched off — after which it stays the operator's.
- Updated dependencies [c440bee]
- Updated dependencies [7426bc4]
  - @adminium/add-on-contracts@0.3.1

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
