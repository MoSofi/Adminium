<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

- **Every door.** A create from a staff screen or the data API (with or without a retry key, one
  row or several in one save), a guest's public write, a rule's `record.create`, a project's code:
  each new row moves the earlier ones. Several rows made in one save move each other in order: the
  last is the one left in `initial`.
- **The new row itself is never moved**, and a new row whose `by` is empty moves nothing. A row in
  a state not in `from` (an approved proof) is left as it is, and so is a row of another line.
- **One write.** A move refused (an earlier row whose move's conditions do not hold) refuses the
  whole create, `409` `STATE_MOVE_REFUSED`, and no row is made or moved. A create refused for any
  other reason moves nothing.
- **In turn.** The row `by` points at is held first, so two rows made for one line at the same
  moment take their turns: the second finds the first, and one row is left waiting.
- **The table's rule, not the person's.** As with an [effect](https://docs.adminium.dev/reference/manifest/#effects), the earlier rows move
  whether or not the person who made the new one may read or change them, and the roles a move is
  kept for do not stop it.
- Only a create moves them. A change of a row's link, or a move of its own, moves no other row.
  Importing rows and loading sample data are history: they keep the state each row was in and move
  nothing. A save that moved an earlier row offers no Undo.

The moves are made as an effect's are, so the same limits apply: each move from `from` to `to` is
not an undo, not a ledger's own (`planned`), and does not wait for another row; a move to `to` is
not judged late by another row's time, and sets off none of this table's own [effects](https://docs.adminium.dev/reference/manifest/#effects).
The table may not be a line of another table's states, book people by the day, keep a
[limit](https://docs.adminium.dev/reference/manifest/#capacity), be private, be the app's outbox, or be watched by a project hook (refused
when the row is made). An add-on's shape keeps its `supersedes` as it wrote it: an app adds none.

#### Undo of a move

A move marked `"undo": true` takes back the listed move the other way: the kitchen marked an
order ready by mistake, and moves it back to preparing.

```json
"moves": {
  "preparing": ["ready"],
  "ready": [{ "to": "preparing", "undo": true,
              "requires": { "time": { "before": { "column": "ready_at", "plus": { "minutes": 1 } } } } }]
}
```

An undo move is made only by a write that names the state it saw the row in (`from` on a staff
change): a stale screen's tap never takes back another screen's move, and is refused `409`
`STATE_MOVE_REFUSED` naming both states. What it waits for is judged on the row as it stands. The
stamps written when the row entered the state it returns to keep what they had; the stamps marked
[`clearOnBack`](https://docs.adminium.dev/reference/manifest/#stamps) that watch the state it leaves are emptied. A state reached only by undo
moves is never written by a door that names no state it saw: a timed move, an effect, an email's
`onSent`, or a value a guest may write. An outbox producer with [`holdSeconds`](https://docs.adminium.dev/reference/manifest/#outbox) waits long
enough for an undo to drop its message.

An undo may empty further columns that the move it takes back filled, with `clears`: a hand-over
taken back is unpaid again.

```json
"moves": {
  "ready": [{ "to": "picked_up", "requires": { "where": [{ "column": "paid_method", "isNull": false }] } }],
  "picked_up": [{ "to": "ready", "roles": ["manager"], "undo": true, "clears": ["paid_method"] }]
},
"lock": { "when": ["picked_up"], "except": ["link_stopped"] }
```

- The move empties each column it `clears`, whether or not the writer sends it. A writer may leave
  it out or send it as `null`; a value is refused `409` `STATE_MOVE_REFUSED`, with
  `details.clears` naming the column, and nothing is written.
- What an undo empties, its `clearOnBack` stamps and its `clears`, is open to the table's `lock`
  for that move only, and only to be emptied. The same column changed by any other write stays
  locked (`409` `RECORD_LOCKED`). The lock's other columns and the rows of `children` tied to it
  stay as they are.
- `clears` names 1–8 columns of the table, each once, that may be empty. It never names the state
  column, the key, or a column another rule writes (a stamp is emptied by `clearOnBack` instead).
  It is refused on a move not marked `undo`: `only a move marked undo empties columns as it goes`.
  A states rule saved in Studio is held to the same checks.
- A move is taken by its target: the first listed from a state to another is the one made. A
  second move between the same two states is refused when either is marked `undo` or names
  `clears`: `another move from "picked_up" to "ready" comes first, so this one is never made`.
- The dashboard's Undo of the forward move makes this move back when the forward change filled
  a column the undo `clears` from empty. When the change overwrote a value already there, the move
  back would lose it, so no Undo is offered. Nor is one offered to a person who holds none of the
  move back's `roles`.
- A take-back whose row was moved back and on again by someone else while it was made is refused
  `409` `WRITE_CONFLICT` with `details.retry: true`: make it again.

A code nothing renews is put back by an undo as it was. A code a change of hands renewed is never
put back: undoing the hand-over makes a code neither holder had. See
[Undo a status move](https://docs.adminium.dev/guides/apps/undo-a-status-move/).
