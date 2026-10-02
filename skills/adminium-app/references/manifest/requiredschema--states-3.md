<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

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

An effect moves one row, one link away, never a chain. The linked table may not be one whose rows
are lines of another table's states, one that books people by the day, the app's outbox, or one
whose rows set off effects of their own; and the move it makes may not wait for another row, be an
undo, or be judged late by another row's time. A table a project hook watches is refused at run
time. History (an import, sample data) sets off no effect. A move that set off an effect offers no
Undo.

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
