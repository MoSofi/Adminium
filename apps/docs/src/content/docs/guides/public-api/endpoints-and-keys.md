---
title: Endpoints and keys
description: Let your own pages and servers call this database through the public API — endpoints you choose, keys scoped to them, and the exact contract a caller sees.
---

The public API lets code that is not the dashboard read and write your database: a
storefront page, a booking widget, a nightly sync on another server. It answers at
`/api/v1/public/records`, and nothing is reachable through it until you create an
**endpoint** and a **key** that grants it.

## Turn it on

Two switches, and both must be on.

1. **On the server.** Set `ADMINIUM_PUBLIC_API_ORIGINS` and restart. It lists the exact
   origins browser pages may call from, such as `https://shop.example.com`. Add `self` to
   let pages this instance serves itself call it (the `/api-docs` playground is one). With
   the variable unset, the public routes are not served at all.
2. **In Workspace settings.** The **Public API** card has a **Public API** switch. It
   applies the moment you click it. Off, every key stops working at once and nothing is
   deleted.

## Endpoints

An endpoint is one route, such as `/orders`, over one table or view. Open **API keys**
from Workspace settings to see them.

Every table has an endpoint generated from your schema. It stays virtual until a key
grants it or you edit it, and then it is stored. A generated endpoint:

- exposes every column that is not a secret and not marked as personal data;
- offers every method the table supports — GET, POST, PATCH, PUT, DELETE and BATCH on a
  table with a primary key. It offers no DELETE when another table's foreign key would
  cascade into rows the endpoint was never granted, and no POST when the server cannot
  choose the new row's key;
- returns 20 rows by default and at most 200, newest primary key first;
- is limited to 120 requests a minute.

A column added to the table later is never exposed by itself. Open the endpoint and add
it.

An installed app with customer screens makes its own endpoints and one browser key at
install, marked as the app's. That key can never be widened, and it stops when the app is
switched off. See [An app's public access](/guides/apps/public-access/).

**Edit endpoint** opens the builder. The form on the left and the JSON definition on the
right are the same document, and editing one updates the other. The definition also
accepts keys the form does not draw (`writable`, `defaults`, `filterable`, `searchable`,
`orderable`, `identity`, `sensitive`, `allow_cascade`), and the form keeps them when you
edit. Save is refused while the JSON has changes you have not applied, and a save that
would break a live key names that key.

**Default filters** are the rows an endpoint can reach at all. They are part of every
statement the endpoint runs, reads and writes alike, and a caller cannot remove them.

## Keys

A key is a selection: endpoints, and under each one the methods it may use. One key can
cover many endpoints with different methods on each.

- A **browser** key (`adm_pub_…`) is for pages. It works only from the origins
  `ADMINIUM_PUBLIC_API_ORIGINS` lists, and it can be revealed again later.
- A **server** key (`adm_srv_…`) is for your own backend. It needs no `Origin`, is shown
  once and cannot be revealed, and is refused from a browser. Only a server key can be
  granted a **service role** endpoint.

A key expires after 30 days, 90 days or never. **Revoke** ends it on the very next
request, and within 5 seconds on any other replica of this server.

:::caution[A browser key is public]
A browser key sits in your page's source, so anyone can copy it and call exactly what it
grants. If it grants POST, PATCH, PUT or DELETE on an endpoint with no default filter, the
person who copied it can create, overwrite and delete every row of that table. A
generated endpoint also lets a caller write every exposed column. That includes columns
such as `role` or `price` that your own app treats as authorization, so on a `users` table
a copied key can change someone's role.

Give a browser key the read-only preset unless the page must write, add a default filter
to every endpoint it writes through, and remove authorization columns from `writable`.
:::

## Calling the API

Send the key as a bearer token.

```bash
curl 'https://admin.example.com/api/v1/public/records/orders?limit=20' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

| Method | Path | Body | Answers |
|---|---|---|---|
| GET | `/{ref}` | — | The rows, in the endpoint's response shape |
| GET | `/{ref}/{id}` | — | `{ "data": row }` |
| POST | `/{ref}` | `{ "values": { … } }` | `201`, `{ "data": row }` |
| PATCH | `/{ref}/{id}` | `{ "values": { … } }` | `{ "data": row }` |
| PUT | `/{ref}/{id}` | `{ "values": { … } }` with every writable column | `{ "data": row }` |
| DELETE | `/{ref}/{id}` | — | `{ "data": {} }` |
| BATCH | `POST /{ref}/batch` | `{ "rows": [ … ] }`, 1 to 500 | `{ "data": { "count": n } }` |

A batch is **bulk insert or upsert**. A row without its primary key is inserted and the
server chooses the key. A row with its whole primary key updates that row, and the key
must also hold PATCH. All rows are written in one transaction, or none are.

A list answers `{ data, page, cursor }` (wrapped), a bare array with the next cursor in
`X-Next-Cursor`, or exactly one row, as the endpoint's **response shape** says.
`@adminiumjs/public-client` returns `{ data, cursor }` for all three.

An endpoint that needs a signed-in customer also takes `X-Adminium-Public-Session`, the
session a claim returned.

### Free or full

A bookings table with a limit per time slot can have an **availability** endpoint. It
answers one question — which of a day's times have room for a party — and never returns
a row, a name or a count:

```bash
curl 'https://admin.example.com/api/v1/public/availability/reservations_availability?date=2026-09-25&party=4' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "time": "19:00", "state": "free" }, { "time": "19:30", "state": "full" }] }
```

Times are on the venue's clock, every slot from opening to the last one before closing. A
time in the past, or further ahead than the booking window, is full. With a session, the
guest's own booking is not counted against them, so they can make it bigger at the same
time. `@adminiumjs/public-client` asks with `availability(ref, day, party)`, and
`fromTenantLocal(day, minutes, timeZone)` turns the time picked into the instant to book.

An endpoint that takes bookings can also **confirm** them: when a guest's booking includes
an email address, Adminium sends the built-in *Booking confirmation* email — in the guest's
own language, with the booking code, the time on the venue's clock, the party size, the
cancellation window and a link back to manage it. The page itself has no server, so this is
the only way a guest gets one. It needs email set up under Settings → Email; without it the
booking still goes through, and an app's install check says no confirmation will be sent.
Changing or cancelling a booking sends nothing. The template can be reworded, like every
built-in, in the email templates.

The same limit is checked again when the booking is written, so two guests asking for the
last places at once cannot both have them. A guest can cancel only up to the venue's
cancellation window before the time; after that the API answers `PUBLIC_TOO_LATE` and
the venue can still cancel from its own screens.

### Refusals

| Status | Code | When |
|---|---|---|
| 401 | `PUBLIC_KEY_INVALID` | The key is unknown, revoked or expired |
| 403 | `PUBLIC_ORIGIN_REFUSED` | A browser key from an origin not listed, or a server key from a browser |
| 404 | `PUBLIC_REF_NOT_FOUND` | No such endpoint, a method the key was not granted, or a row outside the endpoint's filter. All three look the same on purpose |
| 400 | `PUBLIC_WRITE_REFUSED` | A column that is not writable, a PUT missing one, a batch of 0 or more than 500 rows, or a write the database refused |
| 400 | `PUBLIC_QUERY_REFUSED` | A filter or sort the endpoint does not allow |
| 409 | `PUBLIC_SLOT_FULL` | The time a booking asks for has no room left |
| 409 | `PUBLIC_SLOT_BUSY` | Another visitor is booking that time this instant; try again in a moment |
| 409 | `PUBLIC_TOO_LATE` | Too close to the time to cancel online; the venue still can |
| 409 | `PUBLIC_TOO_EARLY` | The guest's own row is not yet inside the endpoint's time window. `params.at` is the row's time and `params.from` when the window opens |
| 429 | `PUBLIC_RATE_LIMITED` | Over the limit. `Retry-After` says when to try again |
| 503 | `PUBLIC_API_DISABLED` | The Public API switch is off |

### Rate limits

An endpoint's own limit applies per visitor for a browser key, and across the whole key
for a server key. A batch counts one request per row. A browser key is also held as a
whole, across every visitor together, to 600 reads and 60 writes a minute (a batch counts
once here); anyone can copy a browser key out of a page, so this is what stops many
addresses together from using it up. Separately, every address is held
to 600 requests a minute across all endpoints. The counters live in each server process,
so with several replicas each one counts on its own.

**Requests · 24h** on the keys page is counted in memory and written every minute, so it
is approximate.

## Keys for your own scripts

The public API is for pages and integrations that act on a few tables. A script that
should act as a user — with a role's permissions across the whole REST API — needs a
**role-bound** key (`adm_sk_…`) instead. There is no page for those; mint one with the
REST API from a signed-in session:

```bash
curl -c jar.txt -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' \
  https://admin.example.com/api/v1/auth/login
curl -b jar.txt https://admin.example.com/api/v1/roles
curl -b jar.txt -H 'content-type: application/json' \
  -d '{"name":"Nightly sync","roleId":"<role id>"}' \
  https://admin.example.com/api/v1/api-keys
```

The reply carries the key once. See the [REST API reference](/reference/rest-api/#authentication).
