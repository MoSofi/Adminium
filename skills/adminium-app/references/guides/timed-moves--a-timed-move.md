<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § A timed move; do not edit -->

# Timed moves on the venue's clock: A timed move

```json
"states": {
  "column": "status",
  "initial": "placed",
  "moves": {
    "placed": ["confirmed", "cancelled"],
    "confirmed": ["preparing", "cancelled"],
    "preparing": ["ready"],
    "ready": ["picked_up"]
  },
  "timed": [
    {
      "from": "placed",
      "to": "cancelled",
      "at": {
        "column": "pickup_at",
        "time": {
          "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" },
          "edge": "closes"
        }
      },
      "set": { "cancel_code": "closed" }
    }
  ]
}
```

An order for Friday's 12:30 pickup that nobody confirmed is cancelled at Friday's closing hour, and
its `cancel_code` reads `closed`, so the order page and the email can say why.

| Field | Rule |
|---|---|
| `from` | The state the row must still be in. At most one timed move leaves each state. |
| `to` | Where it goes. The table must list the move from `from` to `to`, and that move may not be an [undo](https://docs.adminium.dev/guides/apps/undo-a-status-move/). |
| `at` | A [moment](https://docs.adminium.dev/guides/apps/timed-moves/#moments) of the row's own columns. It never reads a linked row's time, in its fallbacks either. |
| `set` | Optional. One to eight other columns of the row and the fixed value each gets: text, a number, true or false, or `null` for a column that may be empty. Never the state column, the key, or a column another rule writes (a stamp, a total, a code). |

A table has up to eight timed moves. What `set` writes goes through the table's
[lock](https://docs.adminium.dev/reference/manifest/#states) as a stamp does: a cancelled order may be locked, and still take
its `cancel_code` with the move.
