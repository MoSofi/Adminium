<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § Only shortly after; do not edit -->

# Undo a status move: Only shortly after

An undo is for a mistake noticed at once. `requires.time` keeps it to the minute after the Ready:

```json
"requires": { "time": { "before": { "column": "ready_at", "plus": { "minutes": 1 } } } }
```

The undo is judged on the row as it stands, so it reads `ready_at` as the Ready wrote it, before the
undo empties it. Two minutes later the undo is refused `409` `STATE_MOVE_REFUSED`, with
`details.requires: "time"`, `details.bound: "before"` and `details.at`, the end of the minute. The
order moves on the normal way instead. See [Moves that wait for a time](https://docs.adminium.dev/guides/apps/timed-moves/#moves-that-wait-for-a-time).
