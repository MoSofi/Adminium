<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Capacity; do not edit -->

# Manifest spec: requiredSchema — Capacity

| Field | Required | Rule |
|---|---|---|
| `kind` | yes | `"night"`. |
| `from`, `to` | yes | The arrival and the departure: `date` columns of the row, or `{ "via", "column" }` of the row it belongs to (an extra's nights are its stay's). |
| `countWhere` | no | Which rows count (above). |
| `pool` | yes | Either the rows of another table: `{ "via", "count": { "table", "column", "outOfService"? }, "fits"?, "given"? }`, the rows of `count.table` whose `column` points where the row's `via` points (the rooms of a type); or one unit per row pointed at, or a number of that row: `{ "via", "size": 1 or { "column" }, "outOfService"? }` (a room holds one stay a night; an extra's parking spaces). |
| `pool.count.outOfService`, `pool.outOfService` | no | `{ "table", "room", "from", "to", "active"? }`: rooms out of service between two dates, `room` a foreign key to the counted rows. They are taken off the pool on those nights. |
| `pool.fits` | no | `{ "column" }`: a number column of the pool's row a stay's guests must fit (how many a type sleeps). It filters what [availability](https://docs.adminium.dev/reference/manifest/#availability) offers; to refuse a stay with too many guests, use the entry's [`agrees`](https://docs.adminium.dev/reference/manifest/#a-create-with-its-child-rows). |
| `pool.given` | no | `{ "via", "column" }`: when the row's `via` link is set (a room given), it counts against that row's `column` instead (the room's type, not the one booked). |
| `nights` | no | `{ "min"?, "max"?, "minByArrival"?, "aheadDays"? }`: the shortest and longest stay (a stay is at least one night), a shortest stay per arrival weekday (`{ "fri": 2 }`, 1–60), and how many days ahead a stay may start. |
| `hold` | no | See [Holds](https://docs.adminium.dev/reference/manifest/#holds). |
| `arrived` | no | `{ "states", "via"? }`: the counted states of a stay whose guest has arrived. A change of such a stay (another room, another type, other dates) is judged from the venue's today on; the nights already slept are never judged again, so a room closed last night takes nothing from a guest moved today. Extras whose nights come from the stay are judged the same way. |

Parent and night availability for guests read the pool's rows, so the key also needs a plain
read entry on the pool's table (the ticket types, the room types).

#### Holds

A **hold** makes a row count only for a while: an order a guest is paying for keeps its tickets
for ten minutes, and gives them back when it lapses.

```json
"hold": { "column": "held_until", "states": ["held"] }
```

| Field | Rule |
|---|---|
| `column` | When the hold ends: a `timestamptz` column of the row (or of its owner, with `via`) that a [stamp](https://docs.adminium.dev/reference/manifest/#stamps) writes, never one a guest writes. Or `{ "column", "via", "or"? }`: a moment of a linked row, `via` a foreign key of the row the hold reads, and `or` 1–2 fallbacks `{ "column", "via"? }` read when the link is empty (a waitlist offer's end, else the order's own). |
| `states` | 1–8 counted states in which the row is held. A row in one of them counts only until its hold ends; a row in any other counted state counts whatever its old hold says (a paid order). |
| `via` | The owner the states and the column are read on. |

One live hold per buyer. A public create sends `replaces`, the page's own-link session for the
hold it takes the place of (a checkout changed before it was confirmed): that hold is let go in the
same write, and the session moves to the new hold. A verified signed-in person's other holds are
let go the same way. A [dry run](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries) takes `replaces` too, and
judges the places as if the old hold were gone, letting nothing go. Letting a hold go writes its
end directly, with no rule run on that write, so nothing may watch a hold's end column: no stamp,
code renewal or followed copy is set off by it.

A row that leaves a hold state (a waitlist claim) counts the places kept back by `reserved` as
staff do, so a returned place offered on is not counted twice.

#### How a limit is judged

A write that adds to what a pool counts is judged inside its transaction, under a named lock (a
slot limit's per venue day, a parent limit's per `lockBy` value, a night limit's per table), so two
writers never both take the last place. A writer waits at most 10 seconds for another's lock, then
is answered `409` `CAPACITY_BUSY` (or `NUMBER_BUSY`) to try again. A bulk edit cannot move a row
whose limit needs a lock (`409` `CONFLICT`, `details.reason: "CAPACITY_ONE_AT_A_TIME"`), nor can a
public batch (`400` `PUBLIC_WRITE_REFUSED`); an import records history, and is not judged.

Staff are refused `409` `CAPACITY_FULL`, with `details` naming the rule's kind, the column, the
pool (`key`, `at`) and `left`, the places that were left before the write; a place the venue does
not offer is refused with a reason (out of range, out of hours, closed, paused, not on sale, too
many). A guest is told `PUBLIC_SLOT_FULL`, `PUBLIC_SOLD_OUT` or
`PUBLIC_NO_ROOM` (with the `night`), never how full anything is; see
[Error codes](https://docs.adminium.dev/reference/errors/). Sample rows count against real availability like any other.
For the whole picture, see [Booking rules and limits](https://docs.adminium.dev/guides/apps/booking-rules/).
