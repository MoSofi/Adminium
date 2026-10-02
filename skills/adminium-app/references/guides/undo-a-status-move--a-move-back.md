<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § A move back; do not edit -->

# Undo a status move: A move back

A move marked `undo: true` takes back the listed move the other way:

```json
"states": {
  "column": "status",
  "initial": "placed",
  "moves": {
    "placed": ["confirmed"],
    "confirmed": ["preparing", { "to": "placed", "undo": true }],
    "preparing": ["ready", { "to": "confirmed", "undo": true }],
    "ready": [
      "picked_up",
      {
        "to": "preparing",
        "undo": true,
        "requires": { "time": { "before": { "column": "ready_at", "plus": { "minutes": 1 } } } }
      }
    ]
  }
}
```

`ready → preparing` takes back `preparing → ready`. The table must list that forward move; an undo
with nothing to take back is refused by the manifest check: `no listed move goes from "ready" to
"placed", so this move takes nothing back`.

An undo is a move like any other. It may be kept for some of the app's roles, and it may wait for
things with `requires`. It differs in three ways:

- it is made only by a write that names the state it saw the row in ([below](https://docs.adminium.dev/guides/apps/undo-a-status-move/#naming-the-state-it-saw));
- what it waits for is judged on the row as it stands, before anything is emptied;
- it empties the stamps the forward move wrote, and keeps the ones of the state it returns to
  ([below](https://docs.adminium.dev/guides/apps/undo-a-status-move/#stamps)).
