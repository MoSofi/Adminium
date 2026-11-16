<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

A refused move is `409` `STATE_DATE_PASSED`, never `STATE_MOVE_REFUSED`, so a screen can tell "its
day has passed" from "it is not in a state that allows this". `details` carry `column` (the state
column), `from`, `to`, `date` (the date column) and `until` (the day it held). Through the public
API it is `409` `PUBLIC_TOO_LATE` with no `params`: the entry may not show the date. The row is
still read as before, so a page opened by its link can say the quote ran out. Needs Adminium
0.3.28.

#### No payment on its way

`requires.noPaymentInFlight: true` refuses a move while a payment for the row is on its way: the
payment service has said it is processing it (a bank confirming), or it succeeded and Adminium is
writing it into the record. A diner who chose "Pay when you pick up instead" (`paying → placed`)
while their card payment is landing is told to wait, rather than leaving the order unpaid with
money arriving for it.

```json
"moves": {
  "paying": [{ "to": "placed", "requires": { "noPaymentInFlight": true } }, "cancelled"]
}
```

- It holds every writer alike — the public API, a person on the dashboard, a bulk edit, the app's
  code, a rule, a timed move — except the payment's own move to paid, which may be the very same
  move (`status.paid`, from `status.from`).
- "On its way" is the test a timed move's [`waitsForPayment`](https://docs.adminium.dev/reference/manifest/#timed-moves) waits on: an attempt for
  the row that is `processing`, `succeeded` or `recording`, younger than seven hours. A payment
  that did not finish, was cancelled or ran out of time is not on its way.
- Only on a table of the app's `payments.payables`; a part left out that takes the payable away
  takes the condition with it.

A refused move is `409` `PAYMENT_IN_FLIGHT`, never `STATE_MOVE_REFUSED`, with `column`, `from` and
`to`. Through the public API it is `400` `PUBLIC_WRITE_REFUSED` with `{ "column", "reason":
"payment-in-flight" }`: show "Your payment is still going through" and read the record again
([`payments.state`](https://docs.adminium.dev/reference/manifest/#paying-from-the-apps-own-customer-screens) says when it settles). Needs Adminium
0.3.62.

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
