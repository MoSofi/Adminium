<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

`requires` takes `where`, `linked`, `time` and `setting`, at least one, in the shapes above (no
`children`). They are judged inside the create's transaction on every door but an import, which
is history; a staff device's `occurredAt` stands in for now. A refusal is `409`
`STATE_MOVE_REFUSED` with `details.create: true` and `from: null`, beside `to`, `requires` and
the parts above. The row's formulas, and its copies of a linked row's columns, are worked out
before the conditions are judged. On a table [built on an add-on's shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape)
the app may add only `where` conditions on columns it added itself (Adminium 0.3.35).

#### Once means once

`strict` refuses a write that names the state the row already holds, rather than letting it pass:
a ticket let in once is not let in again. The refusal is `409` `STATE_UNCHANGED`, with `details.at`
and `details.by`, when and by whom the row got there. `{ "show": [...] }` repeats up to 4 more
columns of the row in the refusal (the door it came in by); never a secret or personal one.
Through the public API it is `PUBLIC_WRITE_REFUSED` with `reason: "unchanged"`. A parent form that
sends a child row's unchanged state back is not refused.

#### Late moves

`late` judges a move made close to a moment: a cancellation inside the last 48 hours before a
stay's arrival.

```json
"late": [{ "to": "cancelled", "from": ["booked"], "moment": { "column": "arrive", "time": "15:00" },
           "within": { "hours": 48 }, "mode": "flag", "flag": "late_cancel" }]
```

| Field | Rule |
|---|---|
| `to` | The state moved to. Each late rule judges its own move; a move the [booking](https://docs.adminium.dev/reference/manifest/#booking) rule's `cancel` already judges takes no second one. |
| `from` | 1–16 states the move comes from, each a listed move to `to`. Absent: any. |
| `moment` | The [moment](https://docs.adminium.dev/reference/manifest/#moments) it is close to, read from the row as stored: a guest who types a later arrival in the same change does not move the window. |
| `within` | How close: one of `minutes`, `hours` or `days`, a number or a setting. A moment already past is inside the window too. |
| `mode` | `"flag"`: the move goes through and sets `flag`, a bool column of the table no other rule writes, whoever writes. `"refuse"`: the move is turned away, for a public writer, or with `"refuse": "everyone"` for every writer. |
| `where` | 1–8 [conditions](https://docs.adminium.dev/reference/manifest/#conditions-a-move-waits-for) on the row as the write leaves it. Only a move that meets them is judged: `[{ "column": "cancel_code", "in": ["guest", "no_card"] }]` leaves a cancellation by the house out, even inside the window. A flag sent for a move the `where` leaves out is dropped. |

A refused late move is `409` `STATE_TOO_LATE` for staff, and `PUBLIC_TOO_LATE` through the public
API.

#### Timed moves

`timed` lists moves Adminium makes by itself once a moment of the row has passed: an order still
held when its hold ends is released, an order still placed at the kitchen's closing hour is
cancelled.

```json
"timed": [{ "from": "placed", "to": "cancelled",
            "at": { "column": "pickup_at", "time": { "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" }, "edge": "closes" } },
            "set": { "cancel_code": "closed" } }]
```

| Field | Rule |
|---|---|
| `from`, `to` | A listed move, never one marked `undo`. One timed move leaves each state. |
| `at` | A [moment](https://docs.adminium.dev/reference/manifest/#moments) of the row's own columns (no `via`). A move whose `requires.time.after` is certainly later than `at` could never be made in time, and is refused by the validator. |
| `set` | 1–8 other columns of the row and the fixed value (or `null` on a nullable column) the move writes with it: why an order still open at closing was cancelled. Never the state column, the key, or a column another rule writes. |

A timed move is a write by Adminium like any other: it is judged as the declared move (its
conditions, limits and totals), and sets off stamps, code renewals, effects and emails. See [Timed moves on the venue's clock](https://docs.adminium.dev/guides/apps/timed-moves/).

#### Effects

An effect moves the row one of this row's links points at, in the same write: a guest checked out
turns the room to cleaning.

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
