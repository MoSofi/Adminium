<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Late moves; do not edit -->

# Timed moves on the venue's clock: Late moves

A move made close to a moment can be marked, or turned away
([reference](https://docs.adminium.dev/reference/manifest/#late-moves)). A hotel flags a cancellation inside 48 hours of the
arrival:

```json
"late": [
  {
    "to": "cancelled",
    "from": ["booked"],
    "moment": { "column": "arrive", "time": { "table": "settings", "column": "arrive_from" } },
    "within": { "hours": { "table": "settings", "column": "cancel_hours" } },
    "mode": "flag",
    "flag": "late_cancel"
  }
]
```

| Field | Rule |
|---|---|
| `to` | The move judged. One late rule per move, and none beside a [booking rule](https://docs.adminium.dev/guides/apps/booking-rules/#late-cancellations)'s own cancellation window for the same move. |
| `from` | Optional. Only moves from these states; each must list a move to `to`. |
| `moment` | The moment the window leads up to. |
| `within` | How long before it the window opens: one of `minutes`, `hours` or `days`, as a shift. |
| `mode` | `flag` lets the move through and marks it. `refuse` turns it away. |
| `flag` | For `flag`: a yes/no column of the row, set when the move is late. Not the state column, not a column another rule writes, not the flag of another late rule. |
| `refuse` | For `refuse`: `public` (the default) turns away a guest; `everyone` turns away staff too. |

A move is late when the moment is less than `within` away, or has already passed. The moment is
read from the row as it is stored, never from the write: a guest who types a later arrival in the
same change does not move the window they are cancelling in. The flag belongs to Adminium: a value
a writer sends for it is dropped when the move is not late. An import and sample data are never
judged late.
