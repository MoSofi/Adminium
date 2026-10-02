<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § Stamps; do not edit -->

# Undo a status move: Stamps

The Ready wrote two [stamps](https://docs.adminium.dev/reference/manifest/#stamps): when (`ready_at`) and who (`ready_by`).
Taking the Ready back should empty them. A stamp marked `clearOnBack` is emptied by an undo that
leaves the state it watches:

```json
{
  "ref": "ready_at", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["ready"] }, "clearOnBack": true } }
},
{
  "ref": "ready_by", "type": "text", "maxLength": 120, "nullable": true,
  "rules": { "stamp": { "set": "user-name", "on": { "column": "status", "values": ["ready"] }, "clearOnBack": true } }
}
```

The stamps of the state the undo returns to keep what they had. `preparing_at` still says 11:22,
when cooking first started, and `confirmed_by` still says Sam. Entering `preparing` again by an undo
is not a new start, so nothing is stamped again.

The manifest check holds a `clearOnBack` stamp to three things:

| Rule | Refused with |
|---|---|
| The column may be empty. | `"orders.ready_by" is not nullable, so an undo cannot empty it` |
| The stamp watches the table's state column. | `only a stamp written when the state moves is emptied by an undo: watch the table's state column` |
| Some move marked `undo` leaves a state it watches. | `no move marked undo leaves "confirmed", so nothing ever empties it` |
