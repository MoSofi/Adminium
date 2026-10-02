<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § Naming the state it saw; do not edit -->

# Undo a status move: Naming the state it saw

Two screens show the same order. The pass tablet marks it Ready. A second tablet, still showing it
as `confirmed`, taps **Start**. Without a check, that tap would move the order from `ready` back to
`preparing` and silently take back the pass's Ready.

So a staff change may name the state the writer saw, as `from` beside the values:

```http
PATCH /api/v1/data/<connection>/<table>/2113
Content-Type: application/json

{ "values": { "status": "preparing" }, "from": "ready" }
```

- The change is made only while the row is still in `from`. A row another screen moved since is
  refused `409` `STATE_MOVE_REFUSED`, with `details.from` the state it is in now, `details.to` the
  state asked for and `details.named` the state the writer saw. Nothing is written.
- **A move marked `undo` is made only with `from`.** Without it, the undo is refused `409`
  `STATE_MOVE_REFUSED` with `details.undo: true`. A forward move needs no `from`, but is held to it
  when it is sent.
- A table that keeps no states takes no `from`: `422` `VALIDATION_FAILED`, the field `from` marked
  `not-allowed`.

The dashboard's records page sends `from` whenever a save changes the state: the state the form
loaded. A move back the app allows is made, and a row someone else moved since is refused rather
than moved from wherever it is now. The same `from` works on the staff change's dry run.
