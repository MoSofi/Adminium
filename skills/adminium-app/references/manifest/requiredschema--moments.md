<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Moments; do not edit -->

# Manifest spec: requiredSchema — Moments

### Moments

Every rule that reads a point in time reads it as a **moment**: a move allowed only after or
before a time, a move Adminium makes when a time passes, a deadline a stamp writes, a public change
open only inside a window, a hold that lasts until a time. A moment is a date or time column of the
row, or of the row one of its links points at, at a wall time of the venue's day, shifted by an
amount, with fallbacks when its column is empty.

```json
{ "column": "starts_at", "via": "event_id", "minus": { "minutes": 30 } }
```

| Field | Rule |
|---|---|
| `column` | A `date` or `timestamptz` column: this row's own, or the linked row's with `via`. |
| `via` | A foreign key of this row: the moment is read from the row it points at. One link, never two. |
| `time` | The wall time on the column's day, on the venue's clock; a `date` column needs one. `"HH:MM"`; a `text` setting `{ "table", "column" }` holding one; the venue's opening or closing hour that weekday, `{ "hours": { "table", "weekday", "open"?, "opens"?, "closes" }, "edge": "opens" or "closes" }`; or a time kept on the row itself, `{ "column" }` (a guest's arrival time on their stay). |
| `plus`, `minus` | A shift forward or back, not both: exactly one of `minutes` (up to 1,000,000), `hours` (up to 16,666) or `days` (up to 36,600), each a number or a whole-number setting. |
| `or` | 1–3 fallback moments of the same shape (without their own `or`), read in turn when this one's column is empty: an event's own refund deadline, else seven days before it starts. |

Minutes and hours are elapsed time: 48 hours before 15:00 is 48 real hours, whatever the clocks
did. Days are calendar days at the same wall time: 7 days before 20:00 is 20:00. A day the hours
table marks closed, or has no row for, ends at midnight. A moment whose column is empty, whose
linked row is missing, or whose setting cannot be read, is no moment at all, and the rule reading
it says what that means: a move waiting for it is refused, a deadline capped by it is not capped.

A time kept on the row (`{ "column" }`) is a `text` column of at least 5 characters holding
`HH:MM` (`H:MM` and the database's `HH:MM:SS` read too). Every column a moment reads that way is
checked when it is written: a value that does not read as a time of day ("9pm") is refused `422`
`VALIDATION_FAILED` with the code `format`, on every door. The moment is compared with the clock
the write reads under its locks, or with the time a staff device says a scan was made (see
`occurredAt` in the [REST API](https://docs.adminium.dev/reference/rest-api/)).
