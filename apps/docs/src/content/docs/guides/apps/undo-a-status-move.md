---
title: Undo a status move
description: How an app lets staff take back a status move made by mistake — the move marked undo, the state a write names, the stamps it empties, the email that waits — and which doors can never make one.
---

The kitchen taps **Ready** on order #2113, then sees it was the wrong ticket. The dish is still on
the pass. The order should go back to `preparing`, as if the tap never happened: the time it was
marked ready is empty again, the customer is not told their food is waiting, and whoever cooks it
next marks it ready properly.

A table that keeps [states](/reference/manifest/#states) cannot just be put back as it was. A sent
invoice put back to draft after its email went would be a lie. So an app says which moves may be
taken back, and Adminium makes each one as a move of its own, judged like any other
([reference](/reference/manifest/#undo-of-a-move)).

## A move back

A move marked `undo: true` takes back the listed move the other way:

```json
"states": {
  "column": "status",
  "initial": "placed",
  "moves": {
    "placed": ["confirmed"],
    "confirmed": ["preparing", { "to": "placed", "undo": true }],
    "preparing": ["ready", { "to": "confirmed", "undo": true }],
    "ready": [
      "picked_up",
      {
        "to": "preparing",
        "undo": true,
        "requires": { "time": { "before": { "column": "ready_at", "plus": { "minutes": 1 } } } }
      }
    ]
  }
}
```

`ready → preparing` takes back `preparing → ready`. The table must list that forward move; an undo
with nothing to take back is refused by the manifest check: `no listed move goes from "ready" to
"placed", so this move takes nothing back`.

An undo is a move like any other. It may be kept for some of the app's roles, and it may wait for
things with `requires`. It differs in three ways:

- it is made only by a write that names the state it saw the row in ([below](#naming-the-state-it-saw));
- what it waits for is judged on the row as it stands, before anything is emptied;
- it empties the stamps the forward move wrote, and keeps the ones of the state it returns to
  ([below](#stamps)).

## Naming the state it saw

Two screens show the same order. The pass tablet marks it Ready. A second tablet, still showing it
as `confirmed`, taps **Start**. Without a check, that tap would move the order from `ready` back to
`preparing` and silently take back the pass's Ready.

So a staff change may name the state the writer saw, as `from` beside the values:

```http
PATCH /api/v1/data/<connection>/<table>/2113
Content-Type: application/json

{ "values": { "status": "preparing" }, "from": "ready" }
```

- The change is made only while the row is still in `from`. A row another screen moved since is
  refused `409` `STATE_MOVE_REFUSED`, with `details.from` the state it is in now, `details.to` the
  state asked for and `details.named` the state the writer saw. Nothing is written.
- **A move marked `undo` is made only with `from`.** Without it, the undo is refused `409`
  `STATE_MOVE_REFUSED` with `details.undo: true`. A forward move needs no `from`, but is held to it
  when it is sent.
- A table that keeps no states takes no `from`: `422` `VALIDATION_FAILED`, the field `from` marked
  `not-allowed`.

The dashboard's records page sends `from` whenever a save changes the state: the state the form
loaded. A move back the app allows is made, and a row someone else moved since is refused rather
than moved from wherever it is now. The same `from` works on the staff change's dry run.

## Only shortly after

An undo is for a mistake noticed at once. `requires.time` keeps it to the minute after the Ready:

```json
"requires": { "time": { "before": { "column": "ready_at", "plus": { "minutes": 1 } } } }
```

The undo is judged on the row as it stands, so it reads `ready_at` as the Ready wrote it, before the
undo empties it. Two minutes later the undo is refused `409` `STATE_MOVE_REFUSED`, with
`details.requires: "time"`, `details.bound: "before"` and `details.at`, the end of the minute. The
order moves on the normal way instead. See [Moves that wait for a time](/guides/apps/timed-moves/#moves-that-wait-for-a-time).

## Stamps

The Ready wrote two [stamps](/reference/manifest/#stamps): when (`ready_at`) and who (`ready_by`).
Taking the Ready back should empty them. A stamp marked `clearOnBack` is emptied by an undo that
leaves the state it watches:

```json
{
  "ref": "ready_at", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["ready"] }, "clearOnBack": true } }
},
{
  "ref": "ready_by", "type": "text", "maxLength": 120, "nullable": true,
  "rules": { "stamp": { "set": "user-name", "on": { "column": "status", "values": ["ready"] }, "clearOnBack": true } }
}
```

The stamps of the state the undo returns to keep what they had. `preparing_at` still says 11:22,
when cooking first started, and `confirmed_by` still says Sam. Entering `preparing` again by an undo
is not a new start, so nothing is stamped again.

The manifest check holds a `clearOnBack` stamp to three things:

| Rule | Refused with |
|---|---|
| The column may be empty. | `"orders.ready_by" is not nullable, so an undo cannot empty it` |
| The stamp watches the table's state column. | `only a stamp written when the state moves is emptied by an undo: watch the table's state column` |
| Some move marked `undo` leaves a state it watches. | `no move marked undo leaves "confirmed", so nothing ever empties it` |

## Columns the move back empties

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

## An email that waits

The customer's "Your order is ready" email must not go the instant the kitchen taps Ready: the tap
may be taken back. An outbox producer can wait a few seconds with `holdSeconds`, and `dropWhen`
drops the message if the order is no longer ready by then:

```json
{
  "kind": "order-ready",
  "link": "order_id",
  "onChange": { "table": "orders", "column": "status", "to": "ready" },
  "holdSeconds": 20,
  "dropWhen": [{ "column": "status", "in": ["placed", "confirmed", "preparing"], "reason": "no-longer-needed" }]
}
```

- The message is queued with its due time 20 seconds on, in the outbox's due column. `holdSeconds`
  is 1 to 3600, and needs that column. It takes no `hold`, `due`, `batchMinutes` or `before` as
  well.
- The sender takes it on its next pass once it is due, so it goes up to about a minute after the
  hold ends. Just before it goes, the drop conditions are asked again.
- An order taken back in time has its message `skipped`, with the reason `no-longer-needed`.
- **A dropped message does not stop the next one.** An email of a kind is normally sent once per
  row. A message dropped while it waited does not count, so Ready, Undo, Ready sends exactly one
  email, for the second Ready.

A `dropWhen` needs a message that waits: without `holdSeconds` (or a hold, a due date or a batch)
the check says `only a message that waits (held, or due later) can be dropped`. See
[An app's emails](/guides/apps/emails/).

## The Undo button

After most saves, the dashboard offers **Undo** for 60 seconds, to the person who made the change.
The save's reply carries an `undoToken`, and `POST /api/v1/data/undo/<token>` spends it.

**For a status move the app lists an undo for,** the button makes that move back. It is the same
write as the PATCH above, naming the state the save left the row in: judged, stamped and told like
any move. A row moved on since is refused, and so is an undo past its time.

**For a status move that also changed another row, there is no Undo.** A guest checked out turns
their room to `cleaning` by an [effect](/reference/manifest/#effects). A move back of the stay would
leave the room as it is, so no undo is offered. Moving the stay back is still the app's to offer, as
a move of its own.

**For any other change to a table that keeps states,** or to the rows tied to one (a sent
invoice's lines), there is no Undo either. A mistake there is moved on, voided or sent back, never
unwritten.

**For a change to a table without states,** Undo restores the columns as they were, without judging
any rule. It is history put back:

- **Emails.** A producer that watches for "these columns changed" hears the undo, so a stay whose
  dates are put back is mailed the dates as they are again. A producer that watches for a column
  changing *to* a value does not hear it, and nothing is queued for a new row.
- **Automations** do not hear an undo.
- **Codes.** A code nothing renews is put back as it was. A code that a change of hands renews is
  never put back. Undoing a hand-over puts the old holder back and makes the code again, so neither
  the code the row had before nor the one handed on works afterwards. Any other undo keeps the
  row's current code.

## Doors that never make an undo

An undo needs a person who names the state they saw. A door that names none can never make one.
The manifest check refuses a timed move by an undo, and refuses the other doors a state that only
undo moves reach:

| Door | Refused with |
|---|---|
| A [timed move](/guides/apps/timed-moves/) | `the move from "ready" to "preparing" is an undo, which only a person makes` |
| An [effect](/reference/manifest/#effects) of another table's move | `every move of "orders" to "preparing" is an undo, which only a person makes` |
| An email's change once it has gone (`onSent`) | `every move of "projects" to "active" is an undo, which only a person makes` |
| A value a guest may write through the public API | `every move to "offered" is an undo, which only a person makes` |

An automation rule that writes such a state is refused when it is saved, for the same reason.

## After a posting

A save that handed something to an [add-on's ledger](/guides/apps/postings/) answers no undo token,
whatever the move says, and no Undo is offered for it: taking it back is more than putting a
column back. The posting's own `reverse` point is the way back — cancel the order, void the line.
An Undo of an earlier change that would cross a posting's point, or change a column an open round
read, is refused `POSTING_REFUSED {reason: "one-at-a-time"}`.

## What a writer is told

| Code | Status | When |
|---|---|---|
| `STATE_MOVE_REFUSED` | 409 | The row is not in the state the write named (`details.named`), an undo named no state (`details.undo: true`), the undo's time has passed (`details.requires: "time"`), or the write sent a value for a column the undo empties (`details.clears`). `details.from` and `details.to` name the move. |
| `VALIDATION_FAILED` | 422 | `from` sent for a table that keeps no states. |
| `UNDO_EXPIRED` | 410 | The Undo button's 60 seconds are over. |
| `CONFLICT` | 409 | Undo on a table that keeps states and lists no move back (`details.reason: "UNDO_STATES"`), or a row changed since the save (`details.code: "UNDO_CONFLICT"`). |
| `WRITE_CONFLICT` | 409 | The row was moved back and on again by someone else while the undo was made (`details.retry: true`). Make it again. |

The full list is in [Errors](/reference/errors/).

## Upgrading

- A records-page save that changes the state now names the state the form loaded. A row another
  screen moved since is refused `STATE_MOVE_REFUSED`, where before it was moved from wherever it
  was.
- Undo of a change to a table without states now sends the app's "these columns changed" emails.
