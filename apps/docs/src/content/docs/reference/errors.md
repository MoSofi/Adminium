---
title: Error codes
description: The error codes Adminium's API answers with, their status, what their details or params carry, and how a refusal made on the desk's side reaches a guest.
---

Every refusal carries a stable `code`. Branch on the code, never on the `message`: messages are
for people, and are reworded and translated. This page lists the codes a write can meet, what
comes with each, and when each is said. Signing in, keys and the rest of the REST API are in the
[REST API reference](/reference/rest-api/).

## The two envelopes

### Staff and API-key routes

Everything under `/api/v1/` except the public API answers a refusal with one shape:

```json
{
  "error": {
    "code": "CAPACITY_FULL",
    "message": "That is sold out.",
    "requestId": "req_8f2a91cd",
    "details": { "column": "ticket_type_id", "rule": 0, "kind": "parent", "row": 0, "pool": { "key": "3" }, "left": 1 }
  }
}
```

`requestId` is the same id the server log carries for the request. `details` is there only when
the refusal has something to say, and its keys are listed with each code below.

### The public API

`/api/v1/public/*` answers with a smaller shape, with no request id and no details:

```json
{ "error": { "code": "PUBLIC_SOLD_OUT", "message": "That is sold out.", "params": { "column": "ticket_type_id" } } }
```

`params` is there only when the code has something to add, and says no more than the page
already knows: the column a guest filled in, the time they picked, their own row's place in the
request. It never says how many places are left, what another row holds, or which constraint
refused. `@adminiumjs/public-client` throws a `PublicApiError` with `code`, `status`, `params` and
`retryAfterSeconds`; a request that never got an answer is `PUBLIC_NETWORK_UNAVAILABLE`, status
`0`, which the server itself never sends.

### Headers a page reads

| Header | When | What it says |
|---|---|---|
| `Retry-After` | Every `429` `PUBLIC_RATE_LIMITED`; a `503` `PUBLIC_UPSTREAM_UNAVAILABLE` for a picture being prepared (`1`) | Seconds to wait before asking again. |
| `x-adminium-session-ended` | The first request after the session the page sent was ended from elsewhere | `elsewhere`: the person pressed "Sign out everywhere" on another device. `forgotten`: the person deleted their details, or their own links were stopped as part of it. |

The session-ended header is sent once, only to the holder of that session's token and on its own
key; the request itself goes on with no session. After that the token is simply unknown. Both
headers are exposed to cross-origin pages, so `headers.get()` reads them, and
`client.sessionEnded()` returns the reason.

## Public API codes

| Code | Status | When | params |
|---|---|---|---|
| `PUBLIC_API_DISABLED` | 503 | The Public API switch is off for this instance. | none |
| `PUBLIC_KEY_INVALID` | 401 | No key, or a key that is unknown, revoked or expired. | none |
| `PUBLIC_ORIGIN_REFUSED` | 403 | A browser key from an origin not allowed, or a server key used from a browser. | none |
| `APP_DISABLED` | 503 | The app that made this key is switched off. | none |
| `SURFACE_OFF` | 503 | The app is on, but the side of it this key serves is switched off. | none |
| `PUBLIC_STAFF_REQUIRED` | 403 | A kiosk's key used without its staff member signed in on that screen. | none |
| `PUBLIC_KEY_OFF` | 503 | A key the app switches in its settings row is off. | none |
| `PUBLIC_RATE_LIMITED` | 429 | Over a rate limit, or out of [guesses at a typed code](#a-typed-code). `Retry-After` says when. | none |
| `PUBLIC_PROOF_REQUIRED` | 403 | The human check is missing, wrong, expired or used, or a batch of creates on an entry that asks for one. | none |
| `PUBLIC_REF_NOT_FOUND` | 404 | No such endpoint, a method the key does not have, a row outside the endpoint's filter or someone else's, or an unknown shared link. All look the same on purpose. | none |
| `PUBLIC_ACTION_NOT_ALLOWED` | — | Listed for the client, not sent by this server: a method an endpoint lacks is `PUBLIC_REF_NOT_FOUND`. | — |
| `PUBLIC_QUERY_REFUSED` | 400 | A read the endpoint does not take. See [below](#a-refused-query). | `parameter` for U+0000 only |
| `PUBLIC_UPSTREAM_UNAVAILABLE` | 503 | The database cannot be reached, is paused, or a document could not be drawn. | none |
| `PUBLIC_SWITCHED_OFF` | 403 | The app switched this off in its settings. See [below](#switched-off). | none |
| `PUBLIC_WRITE_REFUSED` | 400, or 409 | A write refused. See [below](#a-refused-write). | several shapes |
| `PUBLIC_WRITE_REJECTED` | 400 | A project hook refused the write. Its `message` is the project's own text, meant for people. | none |
| `PUBLIC_SLOT_FULL` | 409 | The time asked for has no room left. | `column` |
| `PUBLIC_SLOT_BUSY` | 409 | The write lost a race. Send it again in a moment. | none, or the row's place |
| `PUBLIC_SOLD_OUT` | 409 | What a line asks for is sold out. | `column`, and the row's place |
| `PUBLIC_NO_ROOM` | 409 | No room of the type asked for is free on one of the nights. | `column`, `night` |
| `PUBLIC_TOO_EARLY` | 409 | The guest's own row is not yet inside the window its change needs. | `at`, `from` |
| `PUBLIC_TOO_LATE` | 409 | Too close to the time for this change online. | `at` when known |
| `PUBLIC_PRICE_CHANGED` | 409 | The write came to another price than the one the guest was shown. Nothing was written. | `total`, `lines` |
| `PUBLIC_LIMIT_REACHED` | 409 | As many as may be made online have been made. See [below](#limits-reached). | none |
| `PUBLIC_CLAIM_NO_MATCH` | 403 | A lookup that matched no row. | none |
| `PUBLIC_CLAIM_UNAVAILABLE` | 403 | The key has no claim or identity for this, or the identity declares no "delete my details". | none |
| `PUBLIC_CLAIM_LEVEL` | 403 | The session found the person but has not confirmed the emailed code, on an entry that needs it. | none |
| `PUBLIC_CLAIM_NO_EMAIL` | 409 | The person has no address a code could go to. | none |
| `PUBLIC_CLAIM_LOCKED` | 403 | Too many wrong codes for this person today. | none |
| `PUBLIC_CODE_TOO_SOON` | 429 | A code went a moment ago. | `retryAfter` |
| `PUBLIC_CODE_LIMIT` | 429 | This session has asked for as many codes as it may. | none |
| `PUBLIC_CODE_LOCKED` | 429 | The last code died of wrong tries; the session waits. | `retryAfter` |
| `PUBLIC_CODE_WRONG` | 403 | Not the code. | `triesLeft` |
| `PUBLIC_CODE_EXPIRED` | 410 | No code is open: expired, used or replaced. | none |
| `PUBLIC_CODE_STEP_UP` | 403 | Changing the address or deleting one's details needs a code confirmed, or a link pressed, in the last few minutes. | none |
| `PUBLIC_CODE_UNAVAILABLE` | 503 | No email can go from this server right now. See [below](#no-email-can-go). | none |
| `PUBLIC_EMAIL_CHANGE_LIMIT` | 429 | The address was changed today already. | none |
| `LINK_EXPIRED` | 410 | A sign-in link or a shared link that opens nothing any more: used, expired, stopped or given a new code. | none |

The sign-in codes are covered step by step in [An app's public
access](/guides/apps/public-access/#the-emailed-code). The rest of this section takes the write
codes one at a time.

### A lost race

`409` `PUBLIC_SLOT_BUSY` means another write held what this one needed at the same instant. It is
said for every race a guest's write can lose:

- another booking of the same slot or day was being written (`CAPACITY_BUSY`, `BOOKING_BUSY`);
- another row was taking the next number of the same series (`NUMBER_BUSY`);
- two writers changed the same rows at once, a row moved while it was judged, or the database gave
  this write up in a deadlock, a serialization failure or a lock wait (`WRITE_CONFLICT`);
- two creates made the same new person by address at once, twice running.

The same request a moment later goes through or gets its real answer. With a retry key
([`clientKey`](/reference/manifest/#dry-runs-price-checks-and-retries)), a retry of a create that
did go through answers that create, marked `replayed`, and makes no second one. On a create with
child rows, `params` names the row where it happened: `child` (the list), `index` and `path`.
The published client counts it as transient (`isTransient`).

It is never said for a slot that is full, a line that is sold out, or a value the guest typed.

**Upgrading:** a lost race used to answer `400` `PUBLIC_WRITE_REFUSED`. Treat both as "try again"
while pages built for the older answer are still in use.

### Full, sold out, no room

A limit that has no room left answers by what it counts, and names the column the guest chose it
by, never how many are left or who took them:

| Limit | Code | params |
|---|---|---|
| A [slot limit](/reference/manifest/#slot-limits): a pickup time, a table at 19:30 | `409` `PUBLIC_SLOT_FULL` | `column`, the time column. A table whose limit is the single slot rule of the original form (no `kind`, an `amount` column, one condition on the row) answers with no params. |
| A [booking rule](/guides/apps/booking-rules/): the time went while the guest was choosing | `409` `PUBLIC_SLOT_FULL` | none |
| A [parent limit](/reference/manifest/#parent-limits): tickets of a type, today's portions of a dish | `409` `PUBLIC_SOLD_OUT` | `column`, the line's link to what ran out (`ticket_type_id`) |
| A [night limit](/reference/manifest/#night-limits): rooms of a type | `409` `PUBLIC_NO_ROOM` | `column`, and `night`, a night of the stay with no room (`2026-12-24`) |

On a create with child rows, a refusal about a child row adds its place: `child` (the list's
name), `index` (its place in the list) and `path` (the whole way down, such as
`["order_items", 3, "order_item_modifiers", 0]`):

```json
{ "error": { "code": "PUBLIC_SOLD_OUT", "message": "That is sold out.",
  "params": { "child": "tickets", "index": 1, "path": ["tickets", 1], "column": "ticket_type_id" } } }
```

A limit that counts the uses of a [typed code](/reference/manifest/#typed-codes) is not "sold out"
for a guest: a code whose uses are all taken answers `PUBLIC_WRITE_REFUSED` with the reason
`used-up` on the column the code was typed into.

### Too early and too late

A change a guest makes can be open only inside a window: a check-in from half an hour before the
doors, a cancellation until two days before the stay.

- `409` `PUBLIC_TOO_EARLY`, `params: { at, from }`: the guest's own row is not yet inside the
  window. `at` is the time the window is counted from (the row's time, or the linked row's, such
  as the doors), and `from` is when the window opens. Both are instants. A kiosk check-in shows
  the guest their time with it.
- `409` `PUBLIC_TOO_LATE`, `params: { at }`: the window has closed, or a
  [late move](/reference/manifest/#late-moves) in mode `refuse` turns the change away. `at` is
  when it closed, when that is known. A late cancellation under a slot limit's `cancelHours` or a
  booking rule's window says it with no params.

Neither is said when the window is shut by something else: a linked row that is not in the state
the window asks for (the show takes no refunds), or a moment with no value. Those are a bare
`PUBLIC_WRITE_REFUSED`, since naming them would say what another row holds. A row outside the
guest's reach is `404` `PUBLIC_REF_NOT_FOUND`, never `PUBLIC_TOO_EARLY`. See
[windows on a moment](/reference/manifest/#windows-on-a-moment).

### Price changed

A page that shows a price and sends it back as `expect: { "total": "84.00" }` is held to it,
where the entry [checks a price](/reference/manifest/#dry-runs-price-checks-and-retries). If the
write works out another figure, nothing is written and the answer is `409`
`PUBLIC_PRICE_CHANGED`:

- `total` is the figure the write would have saved, as text with the column's places, or `null`;
- `lines`, on a create with child rows, is those rows as the reply would have shown them, so the
  page can redraw the basket.

A change answers `total` alone. An `expect` sent to an entry that checks no price is a bare
`PUBLIC_WRITE_REFUSED`, and so is one sent with any quote: a quote shows the figures and checks
none.

### A refused write

`PUBLIC_WRITE_REFUSED` is `400`, and `409` on "delete my details" and "make a new link". It takes
one of these shapes:

| params | When |
|---|---|
| none | Anything the guest cannot be told more about: a column the entry does not let them write, a value outside what it allows, a unique or foreign-key refusal, a state move, a locked row, a balance, a refusal that would say what another row holds. |
| `{ column }` | A value the entry `requires` was left empty, or text that must be plain holds a link, a handle or a web address. On a child row, with `child`, `index` and `path`. |
| `{ column, reason }` | The guest's own value, for the reason below. |
| `{ child, reason }` | A list the request sends: `not-offered` (the entry declares no such list), `too-many` or `too-few` (outside its least and most, or more than 200 rows in all). `path` is added for a list below a row. |
| `{ child, index, path }` | A child row writes a column, or a value, its entry does not let a guest write. |
| `{ child, index, path, column, reason }` | A child row's own value. `group` is added when a count by group refused it (too many options of one group). |
| `{ index }`, `{ index, column, reason }` | A row of a batch, by its place in `rows`. |
| `{ max }` | A batch of 0 rows or more than 500, or a request that costs more than the endpoint's rate allows in one window. |

The reasons:

| Reason | The value |
|---|---|
| `required` | Left empty on a create. A change is never told `required`. |
| `too-long` | Longer than the column allows. |
| `too-short`, `too-small`, `too-large` | Outside the column's bounds. Named on a create that goes the tree's way only: child rows, a dry run, a price check, a retry key, a person found by address, a row's own link or an agreement. |
| `format` | Not an address, phone number or web address the column asks for; a time of day that does not read as `HH:MM`; a retry key that is not 22 to 64 letters, digits, `-` or `_`. |
| `invalid-character` | Holds the character U+0000. |
| `unknown` | A typed code that finds no code. |
| `used-up` | A typed code whose uses are all taken. |
| `unchanged` | The row is already in the state the write names (a ticket already let in). |
| `closed` | A closure covers the day, or the venue is closed then. |
| `out-of-hours` | Outside the hours. |
| `out-of-range` | In the past, beyond the booking window, inside the notice, or no place the venue offers (a party of none, no time at all). |
| `not-offered` | The kind is not offered with that person, or the row is not one the entry [agrees](/reference/manifest/#a-create-with-its-child-rows) with (an option that is not the chosen dish's). |
| `paused` | The venue paused that slot. |
| `not-on-sale` | What the line asks for is not on sale now. |
| `too-many` | More than one order may take ("up to six per order"), or more than a list or a group allows. |
| `too-few` | Fewer than a list or a group needs. |

`unknown` and `used-up` also spend one of the visitor's guesses at a code.

### A refused query

`400` `PUBLIC_QUERY_REFUSED` answers a read the endpoint does not take:

- a filter or a sort on a column it does not allow, or on a [withheld
  column](/reference/manifest/#withheld-columns);
- a search on an endpoint with no searchable column;
- `?code=` on a list or on availability: a code travels in the `x-adminium-code` header, never in
  the address, which logs and proxies keep;
- an endpoint that answers one row, when more than one matched;
- an availability question with a parameter its limit does not take, or without one it needs:
  a slot limit takes the `party` and one `date`, or a `from` date and `days` (the original single
  slot rule takes one `date` only); a parent limit `under`, `date`, `qty`, `exclude`, `code`; a
  night limit `from`, `to` (31 nights at most), `guests`, `earliest`, `exclude`; a booking rule a
  `kind` and one `date`, or a `from` date and `days`;
- a malformed request: an unknown parameter, a value out of bounds, a cursor this list never gave;
- U+0000 in a path or query parameter, which `params.parameter` names.

When it is a list's own `where`, `order` or `q` that was refused, `params.parameter` names which,
and the message says what a page does instead: read with `limit`, `offset` or `cursor` and sort or
narrow the rows itself. The app decides what a list holds (`filters` in its public access), and a
person reaches their own row by a [claim](/guides/apps/manifest-by-task/#let-a-customer-find-their-own-row).

### Limits reached

`409` `PUBLIC_LIMIT_REACHED` carries no params. The page offers the phone instead. It is said
when:

- a signed-in person already holds as many open rows as the entry's `maxOpen` allows (a hold
  the same write lets go does not count);
- a create nobody signed in for is over one of the entry's `anonymous` caps: `perValue` (so many
  a day for one phone number or address), `perKeyHour` (so many an hour through the key),
  `perIpHour` (so many an hour from one visitor), or the 60 an hour any one visitor may make
  through a key;
- a change is over the entry's `limits.perValue` (so many a day written to one address);
- a row's own link has been renewed 5 times today with "Make a new link".

A quote is never charged and never told a cap is spent. A create refused for the guest's own
value gives its charge back. See [limits on a guest's
change](/reference/manifest/#limits-on-a-guests-change).

### Switched off

`403` `PUBLIC_SWITCHED_OFF` means the app's settings row switches this off: online booking,
new patients online. Every write through that entry is refused. A create sent again with a retry
key that went through before the switch still answers that create.

### No email can go

`503` `PUBLIC_CODE_UNAVAILABLE` is said when email is not set up, or the message cannot be sent:
asking for a code, changing an address, asking for a sign-in link, and asking for a new link to a
row. For a new link it is said before anything changes, so the guest keeps the link they have.

### A typed code

A code a guest types (a discount, a gift card) is a guess. Each miss (`unknown`, `used-up`)
costs the visitor one of 5 a minute, and the key one of 60 a minute. Once they are spent, a
request with a code answers `429` `PUBLIC_RATE_LIMITED` with `Retry-After`, before anything is
looked up. A code that works costs nothing.

## How a desk refusal reaches a guest

A guest's write runs the same checks as a staff write. The public API then answers with its own
code:

| Staff refusal | Public answer |
|---|---|
| `CAPACITY_FULL`, kind `slot` | `409` `PUBLIC_SLOT_FULL`, `{ column }` |
| `CAPACITY_FULL`, kind `parent` | `409` `PUBLIC_SOLD_OUT`, `{ column }` |
| `CAPACITY_FULL`, kind `night` | `409` `PUBLIC_NO_ROOM`, `{ column, night }` |
| `CAPACITY_FULL` for a code's uses | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason: "used-up" }` |
| `BOOKING_TAKEN` | `409` `PUBLIC_SLOT_FULL` |
| `CAPACITY_BUSY`, `BOOKING_BUSY`, `NUMBER_BUSY`, `WRITE_CONFLICT` | `409` `PUBLIC_SLOT_BUSY` |
| `CAPACITY_TOO_LATE`, `BOOKING_TOO_LATE` | `409` `PUBLIC_TOO_LATE` |
| `STATE_TOO_LATE` | `409` `PUBLIC_TOO_LATE`, `{ at }` |
| `WRITE_WINDOW_CLOSED`, or `STATE_MOVE_REFUSED` waiting for a time: before it opens | `409` `PUBLIC_TOO_EARLY`, `{ at, from }` |
| The same, after it closed | `409` `PUBLIC_TOO_LATE`, `{ at }` |
| The same, shut by a linked row or a moment with no value | `400` `PUBLIC_WRITE_REFUSED` |
| `STATE_UNCHANGED` | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason: "unchanged" }` |
| `BOOKING_CLOSED` | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason: "closed" }` |
| `VALIDATION_FAILED` with `details.reason` `BOOKING_OUT_OF_HOURS`, `BOOKING_OUT_OF_RANGE`, `BOOKING_NOT_OFFERED`, or a `CAPACITY_*` reason | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason }` |
| `VALIDATION_FAILED` on a column the entry writes, for a reason a guest is told | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason }` |
| A project hook's refusal | `400` `PUBLIC_WRITE_REJECTED` |
| Anything else: `STATE_MOVE_REFUSED`, `RECORD_LOCKED`, `DELETE_REFUSED`, `BALANCE_EXCEEDED`, `FOLLOW_TOO_MANY`, `NIGHTLY_RATE_UNREADABLE`, `UNIQUE_VIOLATION`, `FK_VIOLATION`, `CONFLICT` | `400` `PUBLIC_WRITE_REFUSED` |

On a create with child rows, each public answer about a child row adds `child`, `index` and
`path`.

## Staff and API-key write codes

A write through the data routes (`/api/v1/data/:connection/:table…`), a desk screen or a
role-bound key answers with the staff envelope:

| Code | Status | When | details |
|---|---|---|---|
| `VALIDATION_FAILED` | 422 | A value refused, or a request the route does not take. | See [below](#validation_failed) |
| `UNIQUE_VIOLATION` | 409 | A unique rule already holds that value. | `constraint`, `detail`, `columns` |
| `FK_VIOLATION` | 409 | A link to a row that is not there, or a delete of a row others still link to. | `constraint`, `detail` |
| `CAPACITY_FULL` | 409 | A limit has no room for the row. | See [below](#capacity_full) |
| `CAPACITY_BUSY` | 409 | Another write held the limit's lock longer than a write waits (10 seconds). Try again. | none |
| `CAPACITY_TOO_LATE` | 409 | A guest's cancellation inside a slot limit's `cancelHours`. | `column` |
| `NUMBER_BUSY` | 409 | Another write is taking the next number of the same series. Try again. | none |
| `BOOKING_TAKEN` | 409 | Another counted visit of that person overlaps it. | `column` |
| `BOOKING_CLOSED` | 409 | A closure covers the day. | `column` |
| `BOOKING_BUSY` | 409 | Another booking of that day is being written. Try again. | none |
| `BOOKING_TOO_LATE` | 409 | A guest's move or cancellation inside a booking rule's window. | `column` |
| `BALANCE_EXCEEDED` | 409 | A payment or a change that takes a balance kept at zero or above below zero. | `column`, `balance` (what it was) |
| `CONFLICT` | 409 | A write of many rows that must be made one at a time: `details.reason` is `CAPACITY_ONE_AT_A_TIME` (rows that take from a limit) or `BALANCE_ONE_AT_A_TIME` (rows that move a balance). | `reason` |
| `WRITE_CONFLICT` | 409 | Two writers at once, a row that moved between being found and being held, or the database giving this write up (a deadlock, a serialization failure, a busy SQLite file). The same write a moment later goes through. | `retry: true`, and `column` or `table` when known |
| `STATE_MOVE_REFUSED` | 409 | A move the table's [states](/reference/manifest/#states) do not allow now. | See [below](#states) |
| `STATE_UNCHANGED` | 409 | The write names the state a strict row already holds. | `column`, `state`, `at`, `by`, the `show` columns |
| `STATE_TOO_LATE` | 409 | A [late move](/reference/manifest/#late-moves) in mode `refuse`, inside its window. | `column`, `at` |
| `WRITE_WINDOW_CLOSED` | 409 | A change outside the [window](/reference/manifest/#windows-on-a-moment) its entry opens. | `column`, `bound`, `at`, `rowAt`, `reason` |
| `RECORD_LOCKED` | 409 | A column that can no longer change, or a child row whose parent is not in a state that lets it change. | See [below](#states) |
| `DELETE_REFUSED` | 409 | A row that is numbered, in a state that is never deleted, or locked. Void it instead. | `state`, `numbered` |
| `FOLLOW_TOO_MANY` | 409 | More than 500 rows [follow](/reference/manifest/#copies-that-follow) the changed row. Change them in smaller steps. | `table`, `count` |
| `PRICE_CHANGED` | 409 | The save came to another figure than the price the desk showed (`expect`). Nothing was kept. | `column`, `total` |
| `ROW_CHANGED` | 409 | A column the form loaded (`seen`) holds another value now. Nothing was kept; read the row again. | `column`, `expected`, `retry` |
| `DOCUMENT_NOT_FOR_ROW` | 409 | The app's document kind is only for some rows (its `where`), and this row is not one of them: money given back has no receipt. Nothing was drawn. | `kind` |
| `NIGHTLY_RATE_UNREADABLE` | 409 | A [price by the night](/reference/manifest/#prices-by-the-night) reads a rate rule that cannot be read. Correct the rule. | `table`, `key`, `column` |
| `COLUMN_FORBIDDEN` | 403 | A column the caller's role does not read, reads masked, or may not change. | `table`, `column`, `reason` |
| `TABLE_FORBIDDEN` | 403 | The caller's role lacks the table permission the write needs, on the table or a child table. | `permission` |

A bulk edit or delete adds the row's `id` to a state refusal's details. The rest of this section
takes the codes with the most to say.

### VALIDATION_FAILED

`details.fields` names each refused column with its `code`: `required`, `too-long`, `too-short`,
`too-small`, `too-large` (with `n`, the bound), `format`, `invalid`, `invalid-character`,
`out-of-range`, `not-allowed`, `unknown`, `used-up`.

- **A time of day a moment reads.** A column a [moment](/reference/manifest/#moments) reads its
  time of day from (`time: { column }`) is held to `HH:MM`. Anything else is `format`, since it
  would otherwise read as no moment at all. A column of weekdays a price by the night reads
  (`fri,sat`) is held to its form the same way.
- **A price check and a retry key.** `fields.expect` is `not-allowed` when the table names no
  figure to check, the column holds no number, or the save cannot carry one (a repeat, a table a
  hook runs for, a change that sends link fields). `fields.clientKey` is `not-allowed` when the
  table keeps no retry key or the save cannot carry one, and `format` when the key is not 22 to 64 letters, digits, `-` or `_`.
- **A state the writer saw.** `fields.from` is `not-allowed` when the table keeps no states.
- **Dates that only move later.** `details.reason` `ONLY_LATER`, with `out-of-range` on the column.
- **A place the venue does not offer.** `details.reason` is `CAPACITY_OUT_OF_RANGE`,
  `CAPACITY_OUT_OF_HOURS`, `CAPACITY_CLOSED`, `CAPACITY_PAUSED`, `CAPACITY_NOT_ON_SALE` or
  `CAPACITY_TOO_MANY`, with the column in `fields` and the refused row in `row`. The original
  single slot rule gives no reason. A booking rule gives `BOOKING_OUT_OF_HOURS`,
  `BOOKING_OUT_OF_RANGE` or `BOOKING_NOT_OFFERED`
  (see [booking rules](/guides/apps/booking-rules/#what-a-writer-is-told)).
- **A create with child rows.** A refusal of a child row adds `relation`, `row`, and `under` for
  a row two levels down.

### UNIQUE_VIOLATION

`details.columns` lists the columns the broken unique rule keeps unique together, so a form can
mark each; it is left out when the rule is not the table's own. `constraint` is the database's
name for the rule, or `null`. On the data routes `detail` is always `null`: Postgres's own sentence
spells out the other row's values, masked and hidden columns included.

### CAPACITY_FULL

```json
{ "column": "room_type_id", "rule": 0, "kind": "night", "row": 0, "pool": { "key": "2", "at": "2026-12-24" }, "left": 0 }
```

| Key | What it says |
|---|---|
| `column` | The column the row takes by: the slot's time, the line's link, the stay's room type. |
| `rule` | Which of the table's [capacity](/reference/manifest/#capacity) rules, from 0. |
| `kind` | `slot`, `parent` or `night`. |
| `row` | The refused row's place among the rows the write handed the guard. |
| `pool` | `key`: the slot's instant, the parent row's key, or the night pool's key. `at`: the venue day or the night counted. |
| `left` | What the pool had left besides this write's rows, when it has a size. |
| `fields` | For a limit on a code's uses: `{ "<typed column>": { "code": "used-up" } }`. |

The original single slot rule answers `{ column }` alone.

### States

`STATE_MOVE_REFUSED` names the state column and the move, `{ column, from, to }`, and adds why:

| Also in details | Why |
|---|---|
| none | The table allows no move from `from` to `to`. |
| `roles` | Only those roles may make this move. |
| `named` | A stale `from`: the writer said the row was in `named`, and it has moved on to `from` since. Look again. |
| `undo: true` | A move marked `undo` is made only by a change that sends `from`, the state it takes the row back from. See [undo of a move](/reference/manifest/#undo-of-a-move). |
| `clears` | A move marked `undo` empties this column (`clears` on the move), and the change sent a value for it. Send it empty, or leave it out. |
| `requires`, `min` | The move needs at least `min` rows of the child table `requires`. |
| `requires` | The move [waits for](/reference/manifest/#conditions-a-move-waits-for) something: a column name (`requires: "paid"`), `linked` with `via` (and `column` for a condition on the linked row), `setting`, or `time` with `bound` (`after` or `before`) and `at`. A time with no value gives `reason: "no-moment"`; a link the database no longer has gives `unresolved: true`. |
| `create: true` | A new row: `from` is `null`, and `to` is the state it would start in. A new row that names another state than the first has `from: null` without `create`. See [conditions on a new row](/reference/manifest/#conditions-on-a-new-row). |
| `effect: "new"` | A change of a link whose [effect](/reference/manifest/#effects) moves the row it now points at, when that row is already in the state (`from` and `to` are that state, `column` is the link). |

Two shapes carry no `from`. A move whose effect would move a row of a table that cannot be moved
that way (it keeps a limit or a parent, its own move waits for another row, or a hook watches it)
gives `{ column, to, effect }`, `effect` naming that table, and `hooked: true` for a hook. A hook
that judged the row as it was, on a row that has moved on since, gives `{ expected, retry: true }`.

`RECORD_LOCKED` details:

| Details | Why |
|---|---|
| `{ column, state }` | The row is in a locked state and this column can no longer change. |
| `{ column, linkedFrom }` | A row of `linkedFrom` links to this one and keeps this column as it is. |
| `{ table, parent, state }` | The parent is in a locked state. |
| `{ table, parent, state, parentIn, on }` | The parent is not in one of `parentIn`. `on` is `create` for a row joining the parent, `change` for one staying with it or leaving. |
| `{ column, unresolved: true }`, with `table` on a new link | A link the table's rules follow is no longer in the database, so the row it points at cannot be kept or moved. |
| `{ column }` | The change moves another row too, and this kind of write cannot make that move. |

`STATE_UNCHANGED` repeats when and by whom the strict row got to its state (`at`, `by`, read from
its stamps) and the columns its `strict.show` names, so a scanner can say "already let in at 19:42
by Door 2".

### What a read limit leaves out

A role that reads a table [only in part](/reference/manifest/#roles) gets the same codes, with
every value read from a column it may not read left out of `details`: a strict row's `at`, `by`
and `show` columns, a full pool's `pool`, `left` and `at`, the moment a window or a move waits
for, a parent's `state`, a `balance`. The code, the column's name and where it happened stay, so
a form still marks the right field. Naming such a column in a filter, a sort or a price check is
`403` `COLUMN_FORBIDDEN` with `reason: "read-limit"`; a masked column gives no reason; a column a
role may not change gives `reason: "update-limit"` and `writable`.

## Codes met outside a request

### An email that is not sent

An email is never sent without its list. When the table or link an [email that lists
rows](/reference/manifest/#emails-that-list-rows) reads is gone (after a rename, say), the outbox
row is marked `failed` with the sentence "Not sent: the email lists rows from a table or link that
is not there" in its error column. This is text on the row, not an HTTP code. An empty list still
sends. The other sentences are in [app emails](/guides/apps/emails/#sending).

### An app's install check

`POST /apps/plan` lists what stops an install in `problems`, each with a `code`, `table` and
`column`. An install that meets one is refused `422` `VALIDATION_FAILED` with
`details.reason: "PLAN_REFUSED"` and the same `problems`.

| Code | Meaning |
|---|---|
| `UNIQUE_DUPLICATES` | A unique rule the install adds, which rows already in the table break. Make them differ, then check again. |
| `UNIQUE_KEY_TOO_LONG` | On MySQL, a unique column or set of columns wider than MySQL can index (3072 bytes together, 768 characters for one text column). Make the text columns shorter. |

### Saving an endpoint in Studio

An endpoint Studio cannot compile is refused `422` `VALIDATION_FAILED`, with
`details.issues` listing each problem's `code`, `message` and, where there is one, `column`. The
codes the endpoint features for app pages raise (child rows, quotes, retries, windows, codes):

| Code | Meaning |
|---|---|
| `ENDPOINT_CHILDREN_NO_CREATE` | Child rows, or a dry run, on an endpoint that makes nothing, a batch, an identity or a child endpoint. |
| `ENDPOINT_CHILDREN_NEED_PROOF` | A create anyone may make with child rows must ask the human check. |
| `ENDPOINT_CHILD_UNKNOWN`, `ENDPOINT_CHILD_TWICE`, `ENDPOINT_CHILD_VIA_NOT_PARENT` | A child list names a table that is not there, a table already in the write, or a link that does not point at its parent. |
| `ENDPOINT_CHILD_ROWS`, `ENDPOINT_CHILD_DEPTH` | A list's least is above its most, or lists go more than two levels down. |
| `ENDPOINT_CHILD_SELECT_UNKNOWN`, `SCOPE_CHILD_UNKNOWN_COLUMN` | A child list names a column its table does not have. |
| `ENDPOINT_CHILD_WRITABLE_DECIDED`, `ENDPOINT_WRITABLE_DECIDED` | A column Adminium decides (a total, a stamp) cannot be writable. |
| `ENDPOINT_CHILD_COUNTS`, `ENDPOINT_CHILD_AGREES_PATH` | A count by group or an agreement that does not follow foreign keys to what it compares. |
| `ENDPOINT_CLIENT_KEY` | A retry key must be a text column the caller writes and nothing shows, filters or orders by. |
| `ENDPOINT_EXPECT_COLUMN` | A price check must name a number column Adminium works out, which the endpoint shows. |
| `ENDPOINT_AVAILABILITY_SHAPE`, `ENDPOINT_AVAILABILITY_ONE_ROW` | `show_left` or `under` on a limit that cannot answer them, or availability of a night limit whose pool is a single row (one room). |
| `ENDPOINT_VISIBLE_WITH_GUARDED` | A child endpoint on a table with a booking limit is created one row at a time, never in a batch. |
| `SCOPE_WRITABLE_WHEN_MOMENT_INVALID` | A window on a moment that cannot be read: its ends mix linked and own columns, a column that is not a date or time, or, on an endpoint that only creates, a window not keyed by the link to its parent. |
| `ENDPOINT_UNLOCK_NOT_A_CODE` | The column an unlock looks codes up in must be unique (alone, or with its scope) and stored as a code (`normalize: "code"`). |
| `ENDPOINT_UNLOCK_SHARE_CODE` | The column opens rows by a shared link, so it is never looked up. |
| `ENDPOINT_UNLOCK_ALONE`, `ENDPOINT_UNLOCK_READ_ONLY`, `ENDPOINT_UNLOCK_UNKNOWN_COLUMN`, `SCOPE_UNLOCK_SHAPE` | An unlock is its own read-only endpoint, with no claim, identity, parent or availability, over columns that exist. |
| `ENDPOINT_SHARE_LINK_NOT_A_CODE` | A row's own link must be a code of 16 characters Adminium makes, never shown, on a single create. |
| `ENDPOINT_NEW_LINK_SHAPE` | "Make a new link" renews a row's own link code on a signed-in person's rows. |
| `ENDPOINT_OWN_ADDRESS_SHAPE` | A link is emailed to its row's own address only for the row's own link, from a text column holding an address, each named once. |
| `ENDPOINT_FIND_OR_CREATE_SHAPE`, `SCOPE_FIND_OR_CREATE_READS_PERSON` | A person found by address: on a create alone (or a change through the row's own link), never batched, and never showing columns of the person a stranger could have typed the address of. |
| `ENDPOINT_LIMITS_SHAPE` | `limits` count a guest's changes one at a time: a PATCH, never a batch. |
| `ENDPOINT_WITHHOLD_SHAPE`, `SCOPE_WITHHOLD_SHAPE` | Withheld columns: only on a signed-in person's rows read through a parent (or on a row's own link), shown by the endpoint, never filtered, searched or ordered by, and decided by columns that are not writable. |
| `ENDPOINT_SESSION_ONLY_READS`, `SCOPE_SESSION_ONLY_WRITES` | A read for a session's holder alone is an authenticated GET with no claim of its own, and only reads. |
| `SCOPE_FORGET_COLUMN` | "Delete my details" is declared on the identity, empties columns that can be emptied (never a key), stamps a time column, and stops own links that exist. |
| `ENDPOINT_PICTURES_READ_ONLY`, `ENDPOINT_PICTURES_CLAIMED`, `ENDPOINT_PICTURES_UNKNOWN_COLUMN`, `ENDPOINT_PICTURES_NOT_SELECTED`, `ENDPOINT_PICTURES_WRITABLE` | Pictures are shown to every visitor through a read-only endpoint, from columns it shows and no caller writes. |
| `ENDPOINT_COLUMN_UNKNOWN`, `SCOPE_COLUMN_UNKNOWN` | A column named by one of these settings is not in the table. |
