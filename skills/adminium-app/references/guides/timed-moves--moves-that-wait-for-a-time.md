<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Moves that wait for a time; do not edit -->

# Timed moves on the venue's clock: Moves that wait for a time

A move a person makes may be open only after one moment, before another, or between the two
([reference](https://docs.adminium.dev/reference/manifest/#conditions-a-move-waits-for)). A ticket is let in from half an
hour before the doors, and not after the ticket's own end:

```json
"valid": [
  "offered",
  {
    "to": "checked_in",
    "requires": {
      "time": {
        "after": { "via": "event_id", "column": "doors_at", "minus": { "minutes": 30 } },
        "before": { "column": "valid_to" }
      },
      "setting": [{ "table": "settings", "column": "door_on", "eq": true }]
    }
  }
]
```

`after` lets the move through from its moment on; `before` lets it through until just before its
moment. These moments may read a linked row with `via`. The time is the one read inside the write,
under its locks. A move whose moment has no value is refused.

A new row can wait for a time in the same way, with `states.create.requires.time`.
