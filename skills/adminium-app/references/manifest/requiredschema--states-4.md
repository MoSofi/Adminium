<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

```json
"effects": [
  { "on": { "to": "in_house" }, "via": "room_id", "set": { "status": "occupied" } },
  { "on": { "to": "departed" }, "via": "room_id", "set": { "status": "cleaning" } },
  { "on": { "change": "room_id", "in": ["in_house"] },
    "old": { "set": { "status": "cleaning" } }, "new": { "set": { "status": "occupied" } } }
]
```

There are two kinds, up to 8 effects a table:

- **On a move** (`on.to`): when this row moves to the state, the row `via` points at moves to the
  state `set` names. At most one such effect per state and link.
- **On a changed link** (`on.change`, a foreign key): when the link really changes while the row
  is in one of `on.in` (before and after the write; absent: any state), the row it pointed at
  moves by `old` and the row it now points at by `new`; either may be left out. A link first set
  or emptied moves only the side there is. One such effect per link. Without `in`, a booked
  guest's room assignment would flip rooms too; a hotel says `in: ["in_house"]`.

`set` names one column, the linked table's state column, and a state one of its listed moves goes
to. The linked row is moved by that declared move and judged as it: its conditions, the limits and
totals it moves, its own states. A row already in the state an effect's `old` side names is left as
it is; a new row already in the state `new` names refuses the whole write (`409`
`STATE_MOVE_REFUSED` with `details.effect: "new"`: the new room is not ready). Any refusal refuses
the whole write.

The linked row is moved by its own table's declared move, with that move's conditions, its lock
and its totals, and not by what the person who made the first move may do to it: whoever may
make the move that sets an effect off thereby moves the linked row too, whatever their role
writes of that table and whichever of its rows they reach. Give an effect only a link whose
row belongs with the row that moves. A link that points at the moving row itself moves nothing.

An effect moves one row, one link away, never a chain. The linked table may not be one whose rows
are lines of another table's states, one that books people by the day, or the app's outbox; the
state it sets may not be one the linked table's own effects start from (a table with effects may
be moved to any other state, its own rows included: a quote that is sent withdraws the quote it
replaces); and the move it makes may not wait for another row, be an
undo, or be judged late by another row's time. A table a project hook watches is refused at run
time. History (an import, sample data) sets off no effect. A move that set off an effect offers no
Undo.

#### A new child moves its parent

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
