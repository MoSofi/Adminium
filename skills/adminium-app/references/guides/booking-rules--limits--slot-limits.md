<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Limits — Slot limits; do not edit -->

# Booking rules and limits: Limits — Slot limits

### Slot limits

A pickup kitchen takes six orders every 15 minutes, while it is open, for the next week. See
[Slot limits](https://docs.adminium.dev/reference/manifest/#slot-limits) for every field.

```json
"capacity": {
  "kind": "slot",
  "slot": "pickup_at",
  "amount": 1,
  "perSlot": { "table": "settings", "column": "orders_per_slot" },
  "slotMinutes": 15,
  "windowDays": 6,
  "noticeMinutes": { "table": "settings", "column": "lead_minutes" },
  "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" },
  "closures": { "table": "closures", "from": "from_date", "to": "to_date", "active": "active" },
  "pauses": { "table": "slot_pauses", "slot": "slot_at", "active": "active" },
  "countWhere": { "column": "status", "values": ["held", "placed", "ready", "collected"] },
  "hold": { "column": "held_until", "states": ["held"] }
}
```

| Field | Rule |
|---|---|
| `slot` | The row's start, a `timestamptz`. |
| `amount` | How much a row takes: a number, or an `int` column of the row (a party size). |
| `perSlot` | The pool of each slot: a number, or a column of the app's settings row. |
| `slotMinutes` | The grid. Slots start every so many minutes, counted from the day's opening. |
| `hours` | Opening hours per weekday: a table with a `weekday` enum of `mon` to `sun`, `opens` and `closes` as `HH:MM` text, and an optional `open` switch. A weekday with no row, or switched off, has no slots. |
| `opens`, `closes` | One opening for every day, in place of `hours`. |
| `closures` | Dated closures, `from` to `to` inclusive. An empty `to` has no end. |
| `pauses` | Slots the venue has paused, such as a kitchen that is full. |
| `noticeMinutes` | How far ahead a guest's slot must be. |
| `windowDays` | How many days ahead a slot may be, counted from the venue's today. |
| `resource` | A column the limit applies per value of too, such as a table or a room. |
| `cancelHours` | How many hours before its slot a guest may still cancel online. |

With `hours`, a slot starts at or after opening and before closing: `[opens, closes)`. With a
kitchen open 11:00 to 14:00 on a 15-minute grid, the last slot is 13:45. With `opens` and
`closes`, a slot must also end by closing. Hours whose closing is at or before their opening run
past midnight, and the small hours belong to the evening before.

A new slot, or a row moved to another slot, is checked in this order, and the first failure is
the refusal: a closed day (`closed`), outside the day's hours (`out-of-hours`), off the grid
(`out-of-range`), a paused slot (`paused`), in the past or inside the notice (`out-of-range`),
beyond the window (`out-of-range`). Pauses and the notice hold a guest only. Staff may take a
paused slot or one five minutes away, but never one in the past.

A row that only counts again, such as a cancelled order put back, is never refused by a pause, a
closure or a window that came later. It is only counted.
