<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

A void invoice's line may set `time_entry_id` to `null`; setting it to another entry, changing
anything else on the line, or deleting it stays `RECORD_LOCKED`, and so does emptying it while the
invoice is sent. While a line points at an entry, a change to one of the entry's listed columns is
refused `409` `RECORD_LOCKED`, `details.column` naming it, and the entry's record page draws those
fields read-only. A line on an invoice in a state that releases its link (`release.when`, with the
link among `release.columns`) keeps nothing: once the invoice is void the hours may change, and
once the line lets go the time may go on another invoice. A line whose invoice is gone, or has no
state, keeps them. A value the line copies from the entry (a `copy` through the link) is read
again when the line is written, holding the entry: an entry changed in between refuses the line
`409` `WRITE_CONFLICT`, to be written again, so a line never bills hours its entry no longer has.
A listed column Adminium works out (a formula) is kept too: a change to what it is worked out from
is refused naming it. A total over the entry's own child rows (a rollup) is Adminium's, and moves.

A `lockLinked` link is followed through its foreign key. Studio refuses to save states whose link
has none, or names a column the linked table does not have. If the link later stops leading
anywhere Adminium can read (its relation removed in Studio, its foreign key or a kept column
dropped), the rule fails closed: a line may no longer be linked through it, and creating one or
changing its link is refused `409` `RECORD_LOCKED` with `details.unresolved: true` and the link as
`details.column`. Emptying the link, and every other change to the line, still goes through, and
the columns that can still be followed stay kept. Put the relation back, or change the states in
Studio, to bill through it again. A refusal names tables by their own names (`linkedFrom`,
`parent`), never with a schema in front.

A move that is not listed is not one the row may make. Columns Adminium keeps (totals, balances,
formulas, stamps) are Adminium's to write whatever the state. A new row starts in `initial`. A
locked row cannot be deleted either, with or without `noDelete`.

The states hold on every write to the table: a form, a bulk edit, an automation, the public API,
and an outbox's `onSent` change. A refusal is `409`: `STATE_MOVE_REFUSED` for a move the row may
not make (or a new row that does not start in `initial`), `RECORD_LOCKED` for a change to a locked
row or to a child row its parent's state does not allow (`details.on` says `create` or `change`,
beside the parent's `state` and the states that allow it), and `DELETE_REFUSED` for a delete. An
`onlyLater` column moved earlier, or emptied, is refused `422` with the code `out-of-range`.
Through the public API each of these is `PUBLIC_WRITE_REFUSED`.

Adding sample data and importing past records are history. A new row they write may start in
any state, and a child row may follow a parent the same import or sample brought in; a child
row under a parent that was already there is judged as any other write. An import that updates
a row already there is judged in full, and a history write empties no `clearOnCreate` column.
An undo is never given for a write to a table with states, or to its child tables: a mistake is
moved on (voided, sent back), never unwritten. The one exception is a status move the app lists an
[undo move](https://docs.adminium.dev/reference/manifest/#undo-of-a-move) for: its Undo is that move back, judged like any move. A table whose
columns a `lockLinked` keeps keeps its undo, and an undo is judged like any other change: an edit
of the hours made before the time was billed is not taken back after.

#### Conditions a move waits for

Beyond `children` and `where`, a move may wait for the row one of its links points at, for a window
on the clock, and for the settings row:

```json
"moves": {
  "valid": [{ "to": "checked_in",
              "requires": { "linked": [{ "via": "order_id", "where": [{ "column": "status", "eq": "paid" }] }],
                            "time": { "after": { "column": "doors_at", "via": "event_id", "minus": { "minutes": 30 } } },
                            "setting": [{ "table": "settings", "column": "door_open", "eq": true }] } }]
}
```

Everything is read inside the write's transaction, holding the linked row, so a ticket scanned
while its order is being paid sees the order as it committed. A condition that cannot be read (an
empty link, a linked row that is gone, a moment with no value) refuses: a move waiting for
something is never let through on nothing. A link that another writer moved while the write was
waiting refuses `409` `WRITE_CONFLICT` (`details.retry: true`). The window is judged by the
write's own clock, or by the time a staff device says a scan was made (`occurredAt`). A refused
move is `409` `STATE_MOVE_REFUSED`, its `details` naming what failed: `requires` (`linked`,
`time` or `setting`), and `via`, `column`, `bound` (`after` or `before`) and `at` where they
apply, so the door can say "Not paid yet", "Not today" or "Too early".

#### A move's last day

`requires.notPast` names a `date` column of the row. The move is made up to and on that day, and
refused from the day after: a quote is accepted no later than its `valid_until`.

```json
"moves": {
  "sent": [{ "to": "accepted", "requires": { "notPast": "valid_until" } },
           { "to": "declined", "requires": { "notPast": "valid_until" } },
           "withdrawn"]
}
```

- The day is the business's: today in the install's time zone, never UTC's and never the
  caller's.
- It holds every writer alike: a person on the dashboard, a bulk edit, a record's button, a rule,
  an import that moves a row already there, another row's [effect](https://docs.adminium.dev/reference/manifest/#effects), and a
  customer through the public API.
- The date read is the one the row held before the write. A later date sent in the same write does
  not open the move; a person who may change the date changes it first, and then makes the move.
- A row whose date is empty is held to none.
- No public entry on the table may list the date column as `writable`: a guest would move their own
  deadline.
- An undo and a planned move take no last day.

A refused move is `409` `STATE_DATE_PASSED`, never `STATE_MOVE_REFUSED`, so a screen can tell "its
day has passed" from "it is not in a state that allows this". `details` carry `column` (the state
column), `from`, `to`, `date` (the date column) and `until` (the day it held). Through the public
API it is `409` `PUBLIC_TOO_LATE` with no `params`: the entry may not show the date. The row is
still read as before, so a page opened by its link can say the quote ran out. Needs Adminium
0.3.28.

A public entry can also close a change by a date with [`writableWhen`](https://docs.adminium.dev/reference/manifest/#public-access)
(`"from-today"`), which refuses a row whose date is empty and holds only that entry's writes. The
move's last day holds the staff too.

#### Conditions on a new row

`create` holds a new row to the same conditions before it is created at all: a check-in recorded
only for a paid ticket, on its day, from half an hour before the doors.

```json
"create": { "requires": {
  "linked": [{ "via": "ticket_id", "where": [{ "column": "status", "in": ["valid", "offered"] }] }],
  "time": { "after": { "column": "doors_at", "via": "event_id", "minus": { "minutes": 30 } } } } }
```
