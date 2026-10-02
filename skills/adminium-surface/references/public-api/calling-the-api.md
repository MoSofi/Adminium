<!-- produced from apps/docs/src/content/docs/guides/public-api/endpoints-and-keys.md § Calling the API; do not edit -->

# Endpoints and keys: Calling the API

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
| 400 | `PUBLIC_WRITE_REFUSED` | A column that is not writable, a PUT missing one, a batch of 0 or more than 500 rows, or a write the database refused. A value refused for itself in a writable column names it: `params.column` and `params.reason` (`too-long`, `format`, `invalid-character`, `required` on a create, and the others in [Error codes](https://docs.adminium.dev/reference/errors/#a-refused-write)) |
| 400 | `PUBLIC_QUERY_REFUSED` | A filter or sort the endpoint does not allow, or a path or query parameter holding U+0000 (`%00`), which `params.parameter` names |
| 409 | `PUBLIC_SLOT_FULL` | The time a booking asks for has no room left |
| 409 | `PUBLIC_SLOT_BUSY` | The write lost a race: another visitor is booking that time, or taking the same number or row, this instant; try again in a moment |
| 409 | `PUBLIC_TOO_LATE` | Too close to the time to make this change online; the venue still can. `params.at`, when known, is when it closed |
| 409 | `PUBLIC_TOO_EARLY` | The guest's own row is not yet inside the endpoint's time window. `params.at` is the row's time and `params.from` when the window opens |
| 429 | `PUBLIC_RATE_LIMITED` | Over the limit. `Retry-After` says when to try again |
| 503 | `PUBLIC_API_DISABLED` | The Public API switch is off |

Every code, with its `params`, is in [Error codes](https://docs.adminium.dev/reference/errors/#public-api-codes).

### Rate limits

An endpoint's own limit applies per visitor for a browser key, and across the whole key
for a server key. A batch counts one request per row. A browser key is also held as a
whole, across every visitor together, to 3,000 reads and 300 writes a minute (a batch counts
once here); anyone can copy a browser key out of a page, so this is what stops many
addresses together from using it up. A request that is refused (an unknown endpoint, a
missing record) does not count here, and no one visitor may use more than a twelfth of it:
250 reads and 25 writes a minute. An app whose guests arrive all at once can give its key a
budget of its own, up to five times that, with the key's `peak` in its manifest; each visitor
still gets a twelfth of it, and the API keys page shows it beside the key. A signed-in person counts as a visitor of their own, so
people signed in behind one shared network (a venue's Wi-Fi) each get their own share, while
visitors who are not signed in share their address's; a staff screen counts by the staff
member signed in on it. Separately, every address is held
to 600 requests a minute across all endpoints. The counters live in each server process,
so with several replicas each one counts on its own.

**Requests · 24h** on the keys page is counted in memory and written every minute, so it
is approximate.
