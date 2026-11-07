<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

A child row may move the row it belongs to, in the same write: the crew's sign-off, made on a
phone by somebody who reads no job, signs the job off, and the office's counts and the rules that
run on a job signed off follow. Say it on the child, under the parent's `children`, with
`moveOnCreate` (Adminium 0.3.30):

```json
"states": {
  "column": "state", "initial": "open",
  "moves": {
    "open": ["installed"],
    "installed": [{ "to": "signed-off",
                    "requires": { "children": { "sign_offs": 1 }, "where": [{ "column": "blocking_snags", "eq": 0 }] } }]
  },
  "children": {
    "sign_offs": { "via": "job_id", "createIn": ["open", "installed", "signed-off"], "moveOnCreate": "signed-off" }
  }
}
```

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

#### A new row supersedes the earlier ones

A new row may move the earlier rows of its own table that share one of its links, in the same
write: a proof sent again for an order line moves the line's earlier proof, still waiting for the
shopper's answer, to "sent again". Say it with `supersedes` (Adminium 0.3.50):

```json
"states": {
  "column": "state", "initial": "sent",
  "moves": {
    "sent": ["approved", "change_asked", "superseded"],
    "change_asked": ["superseded"]
  },
  "supersedes": { "by": "line_id", "from": ["sent", "change_asked"], "to": "superseded" }
}
```

| Field | Rule |
|---|---|
| `by` | A foreign key of this table (a `fk` column, not the key). The earlier rows are those pointing at the same row. |
| `from` | 1–16 states, each named once. Only rows in one of them move. |
| `to` | The state they move to: not one of `from`, and every state in `from` has a listed move to it. |

When a row is created, every other row of the table with the same `by` value and a state in
`from` moves to `to`, once the new row is in. Each moves by this table's own listed move from its
state, judged as that move: its conditions on the row, its lock, its stamps, the totals and limits
it moves. Each is announced as a change of that row by whoever made the new one: its screens
refresh, its audit names them, and a rule that runs on the move runs.

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
