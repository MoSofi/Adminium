<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

When a `sign_offs` row is created, its job moves to `signed-off` by the job's own listed move,
once the new row is in: that move's conditions are judged on the job as held, with the new row
already counted (`children: { "sign_offs": 1 }` passes on the first sign-off), and its stamps,
totals and limits are written as for any move of the job. It is announced as a change of the job
by the same person: the job's screens refresh, its audit names the sign-off's maker, and a rule
that runs on the job's move to `signed-off` runs.

- A job **already** `signed-off` is left as it is, and the row is made: a correction, a new
  sign-off that names the one it corrects, moves nothing.
- A job in a state with **no listed move** to `signed-off` (still `open` above), or whose move's
  conditions do not hold (a snag still blocking), refuses the whole write: `409`
  `STATE_MOVE_REFUSED`, and no row is made. List `"open": ["installed", "signed-off"]` and a
  sign-off made on an open job signs it off too.
- **Whoever may create the child moves the parent.** The move is the app's own declared move, as an
  [effect](https://docs.adminium.dev/reference/manifest/#effects)'s is: the roles a move is kept for do not stop it, and the person needs no
  right to read or change the parent. A refusal about the parent is told as that person reads the
  parent's table. Give `moveOnCreate` only to a child whose rows belong with the parent they move.
- Only a create moves the parent. A change of the child, its move to another parent, or its delete
  moves nothing. Importing rows and loading sample data are history: they move nothing either. A
  save that moved its parent offers no Undo.

The move is made as an effect's is, so the same tables are refused: the state must be one a listed
move goes to, from a state the child is added in (`createIn` or `parentIn`, when given); not only
by an undo, nor only by an add-on's ledger (`planned`); not one that waits for another row or is
judged late by another row's time; not one that sets off this table's own [effects](https://docs.adminium.dev/reference/manifest/#effects) (an
effect moves one row, never a chain). The parent may not be a line of another table's states, book
people by the day, keep a [limit](https://docs.adminium.dev/reference/manifest/#capacity) of its own, be private, be the app's outbox, or be
watched by a project hook (refused when the row is made). An add-on's shape keeps its children's
`moveOnCreate` as it wrote it.

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
