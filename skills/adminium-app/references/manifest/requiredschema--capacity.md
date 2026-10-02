<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Capacity; do not edit -->

# Manifest spec: requiredSchema — Capacity

### Capacity

`capacity` limits how much of a pool a table's rows may take: the guard behind a booking form, a
ticket shop and a hotel's rooms. A rule names its pool one of three ways:

| Kind | The pool | Example |
|---|---|---|
| `slot` (the default) | Rows add up per start time. | Tables in a restaurant, orders in a pickup slot. |
| `parent` | Rows take from a limit held on the row they point at. | Tickets of a type, today's portions of a dish, the uses of a code. |
| `night` | A row takes one unit on every night of its stay, from a pool counted in another table. | Rooms of a type, a hotel's parking spaces. |

`capacity` is one rule, or a list of up to three (a pool per room type and a pool per room on the
same stays). A table has one slot rule at most. Numbers can be literal, or read from the app's
[one-row settings table](https://docs.adminium.dev/reference/manifest/#values-from-elsewhere) as `{ "table": "<ref>", "column": "<ref>" }`, so a
venue can change them without a new release. Every table a rule names is one of the app's own, by
its short ref; columns of a row reached through a foreign key (`via`) are named plainly.

Which rows count is said by `countWhere`: `{ "column", "values", "via"? }`, only rows whose column
holds one of the values (a cancelled order holds nothing), or a list of two, one on the row and one
on the row it belongs to (a ticket's status and its order's), `via` being the foreign key to that
owner. A rule reads through one owner only: every `via` of its conditions, hold and day names the
same foreign key.

Give the foreign keys a limit counts by [`index: true`](https://docs.adminium.dev/reference/manifest/#columns), so the count under the limit's
lock reads the rows it needs rather than the whole table.

#### Slot limits

```json
"capacity": {
  "slot": "pickup_at", "amount": 1, "perSlot": { "table": "settings", "column": "orders_per_slot" },
  "slotMinutes": 15,
  "countWhere": { "column": "status", "values": ["placed", "confirmed", "preparing", "ready"] },
  "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" },
  "closures": { "table": "closures", "from": "from_date", "to": "to_date", "active": "active" },
  "pauses": { "table": "slot_pauses", "slot": "slot_at", "active": "active" },
  "windowDays": 7, "noticeMinutes": 20
}
```

| Field | Required | Rule |
|---|---|---|
| `kind` | no | `"slot"`, or left out. A rule with no `kind` is a slot rule, and reads exactly as it always has. |
| `slot` | yes | The `timestamptz` column holding each row's time. |
| `amount` | yes | How much a row takes: an `int` column (a party size), or a number from 1 to 1000. A column a guest asks [availability](https://docs.adminium.dev/reference/manifest/#availability) about needs a largest value, `validation.max`. |
| `perSlot` | yes | How much one slot holds. A non-negative integer, or a settings reference. |
| `slotMinutes` | yes | Slot length in minutes, or a settings reference; at least 1. |
| `countWhere` | no | Which rows count (above). |
| `windowDays` | no | How many days ahead bookings are open. |
| `opens`, `closes` | no | `"HH:MM"`, or a settings reference. Not with `hours`. |
| `hours` | no | Weekly hours in place of `opens` and `closes`: `{ "table", "weekday", "open"?, "opens", "closes" }`, one row per weekday. `weekday` is an enum of exactly `mon` … `sun`, `opens` and `closes` are `text` columns holding `HH:MM`, `open` a bool. |
| `closures` | no | Days the venue is closed, `{ "table", "from", "to", "active"? }`, `from` to `to` included (`date` columns). |
| `pauses` | no | Slots the venue has paused (a kitchen that is full): `{ "table", "slot", "active"? }`, `slot` a `timestamptz`. |
| `noticeMinutes` | no | How many minutes ahead a guest's slot must be. Staff are never held to it. |
| `resource` | no | A column (a table, a room): the limit applies per value of it too. |
| `cancelHours` | no | Until how many hours before its time a guest may still cancel through the public API. Staff are never held to it. |
| `hold` | no | Rows count only while their hold lasts; see [Holds](https://docs.adminium.dev/reference/manifest/#holds). |

The slots of a day run on the grid from opening. With an `hours` table the day is
`[opens, closes)`: the last slot starts before closing. With plain `opens` and `closes`, a slot
also ends by closing.

#### Parent limits

```json
"capacity": {
  "kind": "parent", "via": "ticket_type_id",
  "size": { "column": "quantity" },
  "countWhere": [{ "column": "status", "values": ["valid", "offered", "checked_in"] },
                 { "column": "status", "values": ["held", "paid"], "via": "order_id" }],
  "window": { "opens": "sales_open_at", "closes": "sales_close_at" },
  "perWrite": { "max": 6, "within": "order_id" },
  "also": [{ "via": "event_id", "size": { "column": "sell_limit" } }],
  "hold": { "column": "held_until", "states": ["held"], "via": "order_id" }
}
```

| Field | Required | Rule |
|---|---|---|
| `kind` | yes | `"parent"`. |
| `via` | yes | The foreign key to the row holding the limit. A row with it empty is left out of this rule. |
| `size` | yes | How many the pool holds: a number, a settings reference, or `{ "column" }`, a number column of the row `via` points at (empty there: no limit). With `{ "column", "onDay" }`, `onDay` a `date` column of that row, the number holds only on that venue day and any other day has no limit (today's portions); it needs `day`. |
| `amount` | no | How much a row takes: an `int` column of the row, or a number. Absent: one. |
| `countWhere` | no | Which rows count (above). |
| `window` | no | `{ "opens"?, "closes"? }`: `timestamptz` columns of the parent a sale must fall between (empty: no bound). |
| `perWrite` | no | `{ "max", "within" }`: at most `max` (a size, as above) per row of `within`, a foreign key of this row (up to six tickets an order). |
| `also` | no | 1–2 wider pools the same rows also take from: `{ "via", "size" }`, where `via` is another foreign key of the row and `size` a size of the row it points at, or `{ "via", "column" }` one more hop away (a room's cap across its ticket types). |
| `day` | no | Count only the rows of the same venue day as this time: a `timestamptz` column, or `{ "column", "via"? }` on the owner. |
| `lockBy` | no | The column whose value names the lock: `via`, or a wider pool's `via` that is itself a `copy` through `via`. Absent: one lock for the whole table. |
| `hold` | no | See [Holds](https://docs.adminium.dev/reference/manifest/#holds). |
| `reserved` | no | `{ "states", "via"? }`: counted states whose places are kept back from the public while staff decide what to do with them (a refunded ticket held for the waitlist). Not a held state. |

#### Night limits

```json
"capacity": [{
  "kind": "night", "from": "arrive", "to": "depart",
  "countWhere": { "column": "status", "values": ["booked", "in_house"] },
  "pool": { "via": "room_type_id",
            "count": { "table": "rooms", "column": "room_type_id",
                       "outOfService": { "table": "room_blocks", "room": "room_id", "from": "from_date", "to": "to_date", "active": "active" } },
            "fits": { "column": "sleeps" },
            "given": { "via": "room_id", "column": "room_type_id" } },
  "nights": { "min": 1, "max": 28, "aheadDays": 365 },
  "arrived": { "states": ["in_house"] }
}]
```

A stay takes one unit on every night from its arrival to the day before it leaves.
