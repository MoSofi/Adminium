<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § Columns the move back empties; do not edit -->

# Undo a status move: Columns the move back empties

A stamp is Adminium's own; other columns the forward move filled are the writer's. The hand-over
of an order writes how it was paid, `paid_method`, with the move to `picked_up`, and a hand-over
taken back should be unpaid again. The undo names such columns with `clears`:

```json
"picked_up": [{ "to": "ready", "roles": ["manager"], "undo": true, "clears": ["paid_method"] }]
```

The move empties `paid_method` whether or not the writer sends it. A writer may leave it out or
send it as `null`; a value is refused `409` `STATE_MOVE_REFUSED` with `details.clears:
"paid_method"`. `clears` is allowed only on a move marked `undo`, names 1–8 columns that may be
empty, and never the state column, the key or a column another rule writes. A states rule saved in
Studio is held to the same checks. A second move from `picked_up` to `ready` beside the undo is
refused, since the first listed is the one made.

**A locked state.** An order is often locked once it is picked up (`lock.when` includes
`picked_up`). What the undo empties, its `clearOnBack` stamps and its `clears`, is open to the lock
for that move only, and only to be emptied. The same columns changed by any other write stay
locked (`409` `RECORD_LOCKED`), and so does every other column the lock holds. The rows of
`children` tied to the order stay locked while it is picked up.

The dashboard's Undo of a hand-over that filled `paid_method` from empty makes this move back. A
hand-over that changed a payment already there offers no Undo, since the move back would lose it.
Nor is an Undo offered to a person who holds none of the move back's roles: the kitchen's own
hand-over has none, since only a manager takes one back.
