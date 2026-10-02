<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § What a guest can ask; do not edit -->

# Booking rules and limits: What a guest can ask

A page asks with an entry of `kind: "availability"` on the limited table. See
[Availability](https://docs.adminium.dev/reference/manifest/#availability).

```json
{ "table": "tickets", "kind": "availability", "methods": ["GET"], "under": "event_id", "showLeft": { "belowShare": 10 } }
```

| Field | Rule |
|---|---|
| `rule` | Which of the table's limits it answers, `0` to `2`. Absent, the first. |
| `showLeft` | Say how many are left, but only when few are: `{ "below": 3 }`, or `{ "belowShare": 10 }` percent of the pool. Parent and night limits only. |
| `under` | A parent limit only: the column of the pool's rows a page asks by, such as a ticket type's event. |

The answer is counted exactly as a write counts, with no lock. Held places and places kept for
the waitlist count against the guest. A number is said only where `showLeft` says, and only when it
is low. Asking a parameter the kind does not take is refused `400` `PUBLIC_QUERY_REFUSED`.

**Slot.** `date`, or `from` with `days` (up to 31), and `party`. Each time is `free`, `full` or
`paused`. A strip gives each day `open` with its number of free times, `full`, or `closed`.

```bash
curl 'https://admin.example.com/api/v1/public/availability/kitchen_orders_availability?date=2026-10-09' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "time": "11:30", "state": "free" }, { "time": "11:45", "state": "paused" },
           { "time": "12:00", "state": "full" }] }
```

A slot whose rows each take a fixed amount is asked for that amount. A party column is never asked
for more than one row may hold, so a page cannot learn how full a slot is by asking ever larger
parties. The validator therefore requires `validation.max` on that column:

```json
{ "ref": "party", "type": "int", "default": 2, "rules": { "validation": { "min": 1, "max": 8 } } }
```

A slot rule written before limits had kinds is asked, as before, for one `date` and a `party`.

**Parent.** `under` (required when the entry names one), `date` (a limit that counts by day;
absent, the venue's today) and `qty`. Each row the limit is held on is `on`, `soon`, `ended`, or
`soldout` when fewer are left than `qty`, in its own pool or a wider one. `qty` is capped at what
one order may take and at the `showLeft` threshold, and at one without `showLeft`.

```bash
curl 'https://admin.example.com/api/v1/public/availability/boxoffice_tickets_availability?under=12&qty=2' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "id": "31", "state": "on", "left": 4 }, { "id": "32", "state": "soldout" },
           { "id": "33", "state": "soon" }] }
```

**Night.** `from` and `to` (at most 31 nights), `guests`, and `earliest`, how many days (up to 90)
to look for a later arrival of the same length. Each pool is `open`, `full`, or `closed` when those
dates are not a stay the venue sells. With `earliest`, each pool and the whole answer carry the
first later arrival with room.

```bash
curl 'https://admin.example.com/api/v1/public/availability/guesthouse_stays_availability?from=2026-10-09&to=2026-10-11&guests=2&earliest=14' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "pool": "1", "state": "full", "earliest": "2026-10-16" },
           { "pool": "2", "state": "open", "left": 2, "earliest": "2026-10-10" }],
  "earliest": "2026-10-10" }
```

A parent or night answer lists only the rows a guest may already see: those a plain public read of
the pool's table shows (no claim, no parent), at most 200. So a night limit needs an entry such as
`{ "table": "room_types", "methods": ["GET"], "select": ["id", "name", "sleeps"] }`, and a ticket
type shown only with a code is listed only when the guest sends that code in the
`x-adminium-code` header. A code in the query string is refused.

**Moving one's own row.** `exclude=<id>` leaves the guest's own row out of the count: a stay being
moved, or the order a checkout already holds. It works only for a row, or an owner row, the
guest's session reaches. Any other id is ignored, and the answer is the same as without it.

Sample rows are real rows. While they are in the table, those in a counted state take places from
the pools guests see. Remove the sample data before you open for sales (see
[Sample data](https://docs.adminium.dev/guides/apps/sample-data/)).

### The desk's counts

Staff screens ask `GET /api/v1/data/<connection>/<table>/capacity-counts` for size, taken, held
and left per pool. It is counted as a write counts, from staff's view: no notice, pause or sales
window hides a pool, and places kept for the waitlist are shown apart as `kept`, not taken. A pool
made smaller after it sold, such as a room out of service, can show less than nothing left.

| Kind | Ask | Each row |
|---|---|---|
| `slot` | `date`, or `from` and `days` (up to 31) | `time` or `date`, `size`, `taken`, `held`, and `paused` or `closed` |
| `parent` | `ids`, or `under` with `value` or up to 50 `values` (up to 500 rows, each naming its `under` when asked by `values`), and `date` for a limit that counts by day | `id`, `size`, `taken`, `held`, `kept`, `left`, and `also` for the wider pools |
| `night` | `from` and `days` (up to 62), optionally `ids` | `pool`, `date`, `size`, `outOfService`, `taken`, `held`, `left` |

`rule` picks the limit, `0` by default. The asker needs read access to the table, to the pools'
tables (the ticket types, the room types, the rooms and their closures) and to every column the
rule reads. A column asked `under` must be one they see unmasked. A table with no limit answers
`404`.
