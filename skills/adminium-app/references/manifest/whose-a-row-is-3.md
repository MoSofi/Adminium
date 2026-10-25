<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Whose a row is; do not edit -->

# Manifest spec: Whose a row is

| Key | Meaning |
| --- | --- |
| `table` | A table of the app with a foreign key to this one. |
| `via` | That foreign key. |
| `column` | The child's staff column (`rules.staff`) that moves: only rows where it names the row's OLD person move, and they are given the new one. |
| `from` | The staff column of this row the person is read from: one of the columns the button `ask`s for. Left out when the button asks for one staff column. |
| `where` | 1–8 conditions on the child row, as a move's `requires.where` writes them (`eq`, `in`, `isNull`, `gt`…): every one must hold. |

One to eight carries, each table and column once, on a button with `handOver: true`. Each carried
row is changed as its own update, inside the hand-over's transaction: its rules and hooks run,
it is written to the audit log, its live frame is sent and the rules and the outbox that watch
its table are told. The person handing over must hold the child table's update and reach each
row moved (else `403`, and nothing moves); the column itself is the button's to write, as the
columns it sets are, whatever the role's `writable` says. Each row is judged as a hand-over
judges its own row: the new person works the child table, and a child that is a listing lists
them only against rows they can open (`422`, the field marked `cannot-open`). A child table that
takes a resource for a time ([`occupies`](https://docs.adminium.dev/reference/manifest/#a-resource-and-a-time) or [`booking`](https://docs.adminium.dev/reference/manifest/#booking)) has
each carried row placed as a single change places it, under its day's lock: a visit the new person
is already busy for refuses the hand-over (`409 BOOKING_TAKEN`). One refusal refuses
the whole hand-over. A hand-over that carried rows offers no Undo. Needs Adminium 0.3.35
(`states.carries`).
