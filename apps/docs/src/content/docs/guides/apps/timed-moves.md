---
title: Timed moves on the venue's clock
description: How an app's rows move by themselves when a moment passes, how a moment is read on the venue's clock, the job that makes the moves and the rows it sets aside, and the moves that wait for a time or are judged late.
---

Some rows should move on without anyone touching them. An online order still `placed` when the
kitchen closes will never be cooked. A ticket offered to a friend who never accepts should go back
to its buyer. A hotel guest who has not arrived by the next morning is a no-show. An app says so
with **timed moves**: listed moves Adminium makes by itself once a moment of the row has passed.

A timed move is one of the table's [states](/reference/manifest/#states). It moves the row by a move
the table already lists, as an ordinary write: its stamps are written, its effects made, its emails
queued. The fields are in the [manifest reference](/reference/manifest/#timed-moves).

## A timed move

```json
"states": {
  "column": "status",
  "initial": "placed",
  "moves": {
    "placed": ["confirmed", "cancelled"],
    "confirmed": ["preparing", "cancelled"],
    "preparing": ["ready"],
    "ready": ["picked_up"]
  },
  "timed": [
    {
      "from": "placed",
      "to": "cancelled",
      "at": {
        "column": "pickup_at",
        "time": {
          "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" },
          "edge": "closes"
        }
      },
      "set": { "cancel_code": "closed" }
    }
  ]
}
```

An order for Friday's 12:30 pickup that nobody confirmed is cancelled at Friday's closing hour, and
its `cancel_code` reads `closed`, so the order page and the email can say why.

| Field | Rule |
|---|---|
| `from` | The state the row must still be in. At most one timed move leaves each state. |
| `to` | Where it goes. The table must list the move from `from` to `to`, and that move may not be an [undo](/guides/apps/undo-a-status-move/). |
| `at` | A [moment](#moments) of the row's own columns. It never reads a linked row's time, in its fallbacks either. |
| `set` | Optional. One to eight other columns of the row and the fixed value each gets: text, a number, true or false, or `null` for a column that may be empty. Never the state column, the key, or a column another rule writes (a stamp, a total, a code). |

A table has up to eight timed moves. What `set` writes goes through the table's
[lock](/reference/manifest/#states) as a stamp does: a cancelled order may be locked, and still take
its `cancel_code` with the move.

## Moments

Every rule that reads a point in time reads it the same way: a timed move's `at`, a move that
[waits for a time](#moves-that-wait-for-a-time), a [late move](#late-moves), a stamp's deadline, a
guest's window. That shape is a **moment**
([reference](/reference/manifest/#moments)).

| Part | Rule |
|---|---|
| `column` | A `date` or `timestamptz` column. A date has no clock, so it needs a `time`. |
| `via` | This row's foreign key: the moment is read from the row it points at. Not in a timed move's `at`. |
| `time` | A wall time on the column's day. See [below](#time-of-day). |
| `plus` or `minus` | A shift of exactly one of `minutes`, `hours` or `days`. Each is a whole number, or a whole-number column of the settings row. Never both `plus` and `minus`. |
| `or` | Up to three moments read in turn when this one has no value. |

### Time of day

`time` puts the moment at a wall time on the column's day. For a `timestamptz` column that day is
the venue's day of the stored instant: a 12:30 pickup on Friday reads Friday.

| `time` | Example | Reads |
|---|---|---|
| `"HH:MM"` | `"10:00"` | That wall time. |
| A setting | `{ "table": "settings", "column": "no_show_at" }` | A text column of the settings row holding `HH:MM`. It must hold at least 5 characters. |
| An opening-hours edge | `{ "hours": { … }, "edge": "closes" }` | The venue's opening (`opens`) or closing (`closes`) hour that weekday, from a weekly hours table. |
| A time kept on the row | `{ "column": "arrival_time" }` | A text column of the same row (of the linked row, with `via`): the arrival time a guest gave. |

The hours table has one row per weekday: an enum of `mon` to `sun`, text `HH:MM` times, and
optionally a yes/no that the venue is open that day. A closed day, or a weekday with no row, ends
at midnight: an order for a closed Monday is cancelled at the end of Monday. A closing hour at or
before the opening hour is past midnight, on the next day's clock. Two rows for one weekday say two
things, so neither is read and that day's moment has no value.

A time kept on the row may be written `HH:MM`, `H:MM` as a person types it, or `HH:MM:SS` as a
database keeps it. Anything else, or an empty column, is no moment.

### Shifts

**Minutes and hours are elapsed time.** 48 hours before 15:00 is 48 real hours earlier, whatever the
clocks did in between. **Days are calendar days** at the same wall time: one day after 10:00 on
Saturday is 10:00 on Sunday, even on the night the clocks go back.

A shift read from a setting that is empty, negative or not a number is no shift: the moment has no
value.

### A moment with no value

A moment whose column is empty, whose linked row is missing, or whose setting cannot be read has no
value. Its `or` moments are read in turn, and the first one that answers stands in:

```json
"at": {
  "column": "offer_until",
  "or": [{ "column": "valid_to", "minus": { "hours": { "table": "settings", "column": "offer_hours" } } }]
}
```

What no value means is the reading rule's: a timed move never fires, a move waiting for the time is
refused, a late rule is not late.

## The venue's clock

Every moment is read on the venue's clock: the time zone of the app's connection, or UTC when none
is set. The server's own zone never matters. A 21:00 closing is 21:00 where the venue is, in
winter and in summer.

A wall time the clocks skip in spring is read as the hour after: 02:30 on the morning the clocks go
forward is 03:30. A wall time they pass twice in autumn is read as the first.

## The job that makes the moves

Once a minute, Adminium runs one job for each connection whose apps list a timed move. Only one runs
per connection at a time, however many servers you run. A paused connection is skipped; once it is
resumed, every row already due moves.

### Which rows

For each timed move, the job finds the rows still in `from` whose moment has passed, and judges each
row's moment exactly on the venue's clock. The longest-due rows go first, across every rule of the
connection. At most 500 rows move per connection per minute; the rest go the next minute.

### How a row moves

Each move is its own write, in its own transaction, made as the app's declared move:

- It moves the row only while it is still in `from` and its moment, read again on the row as it is
  held, has passed. A row a person moved or re-dated meanwhile is left as it is. Two servers never
  move a row twice.
- A move kept for some of the app's roles is still made: the clock is not a person. Everything else
  holds. What the move [waits for](#moves-that-wait-for-a-time), the lock, the limits and the
  totals are judged as for anyone.
- It is audited as a change by **Timed move**, and open screens see it at once.

### What a timed move sets off

The same as any change of the row:

- **Stamps.** A `cancelled_at` stamp watching the state is written.
- **Code renewals.** A ticket offer that lapses empties the friend's address with `set`. The link
  code renews when that address changes, so the friend's old link opens nothing from then on.
- **Effects.** A move that moves a linked row moves it too, as that table's declared move.
- **Emails.** A producer that watches the state queues its message: "Your order was cancelled
  because we closed". See [An app's emails](/guides/apps/emails/).
- **Automations.** A rule that watches the table hears the change.

## Rows the job sets aside

A due row's move can be refused: the lock keeps a column shut, a condition of the move no longer
holds, the connection's database role may not write a column, or the database refuses a value.
The job then **sets the row aside for an hour**. It is logged, and the rows after it move as usual.
A refused row never keeps newer rows waiting.

A row set aside stays in its old state. Staff notice it in the app's screens: an order still
`placed` after closing. The server log names each one with the warning
`timed move refused; left alone for an hour`, with the connection, the table, the row's key, the
number of the rule and the refusal's code.

To fix a row set aside, do one of these:

- **Move it by hand.** A row that has left `from` is never tried again.
- **Fix what refused it,** such as the value a condition waits for. The job tries the row again
  once its hour is over.
- **Give it a new moment.** A row re-dated to a later time is due again only when that time passes.

Two refusals are not set aside. A row that another writer holds (`WRITE_CONFLICT`, or a `*_BUSY`
lock) is tried again the next minute. If the database itself goes away, the minute's job stops and
the next minute starts again, and the rows set aside so far stay set aside.

## What a timed move never does

- **An undo.** A move marked `undo: true` is made only by a person who names the state they saw.
  The manifest check refuses a timed move by one, with the sentence `the move from "ready" to
  "preparing" is an undo, which only a person makes`. See
  [Undo a status move](/guides/apps/undo-a-status-move/).
- **A move that could never pass.** A move that waits until after the moment it is made at would be
  refused every time. The check refuses it when both read the same column of the row, with no time
  of day and no fallback: a timed move at `offer_until` by a move that waits until `offer_until`
  plus 30 minutes. Anything that depends on the row or the settings is the app's to get right. A
  row refused that way is [set aside](#rows-the-job-sets-aside).
- **Read another row's time.** A timed move reads its own row's columns only. A time that belongs
  to a parent, such as an event's doors, is copied onto the row first.
- **Decide when a hold ends.** A hold never waits for this job. A held order stops counting
  against a limit at its moment by the clock, whether or not it has been moved yet.

## Three cases

### An order still placed at closing

The example [above](#a-timed-move). At most one timed move leaves each state, so an order that
can also be stuck in `confirmed` gets a second rule, `from: "confirmed"`, with the same `to`, `at`
and `set`.

### A ticket offer that lapses

A buyer offers a ticket to a friend. The offer runs for `offer_hours` from the moment it is made.
If the friend has not accepted by then, the ticket goes back to `valid` for the buyer:

```json
"columns": [
  { "ref": "pending_email", "type": "text", "maxLength": 254, "nullable": true },
  { "ref": "pending_name", "type": "text", "maxLength": 120, "nullable": true },
  {
    "ref": "link_token", "type": "text", "maxLength": 16, "nullable": true,
    "rules": { "code": { "length": 16, "renew": { "on": { "column": "pending_email", "changed": true } } } }
  },
  {
    "ref": "offer_until", "type": "timestamptz", "nullable": true,
    "rules": {
      "stamp": {
        "set": { "addMinutes": { "hours": { "table": "settings", "column": "offer_hours" } } },
        "on": { "column": "status", "values": ["offered"] }
      }
    }
  }
],
"states": {
  "column": "status",
  "initial": "valid",
  "moves": { "valid": ["offered", "checked_in"], "offered": ["valid", "checked_in"] },
  "timed": [
    { "from": "offered", "to": "valid", "at": { "column": "offer_until" }, "set": { "pending_email": null, "pending_name": null } }
  ]
}
```

The lapse empties the friend's name and address, and the link code renews with it.

### A guest who never arrives

A stay arrives on a date. A guest still `booked` at 10:00 the day after is a no-show:

```json
"timed": [
  {
    "from": "booked",
    "to": "no_show",
    "at": { "column": "arrive", "time": { "table": "settings", "column": "no_show_at" }, "plus": { "days": 1 } }
  }
]
```

`arrive` is a date, so the moment names a time on it: `no_show_at` from the settings row. One
calendar day later keeps the wall time: a guest due on Saturday 24 October 2026 in London becomes a
no-show at 10:00 on Sunday, although the clocks went back that night.

## Sample data

Sample rows are moved like any other. A sample order whose pickup time passes is cancelled at
closing, as a real one is. The move sends no email, because the outbox leaves sample rows alone.
A sample row a timed move changed is still sample data: **Remove sample data** takes it, and every
row its effect moved too.

Write sample times relative to the moment the sample is added, so a fresh sample is not swept at the
next minute. `{"@in": "PT20M", "@slot": "orders"}` puts an order on the next open pickup slot, and
`@byStay` gives a stay the status that matches the clock. See
[Sample data](/guides/apps/sample-data/) and the [format](/reference/manifest/#sample-data).

## Moves that wait for a time

A move a person makes may be open only after one moment, before another, or between the two
([reference](/reference/manifest/#conditions-a-move-waits-for)). A ticket is let in from half an
hour before the doors, and not after the ticket's own end:

```json
"valid": [
  "offered",
  {
    "to": "checked_in",
    "requires": {
      "time": {
        "after": { "via": "event_id", "column": "doors_at", "minus": { "minutes": 30 } },
        "before": { "column": "valid_to" }
      },
      "setting": [{ "table": "settings", "column": "door_on", "eq": true }]
    }
  }
]
```

`after` lets the move through from its moment on; `before` lets it through until just before its
moment. These moments may read a linked row with `via`. The time is the one read inside the write,
under its locks. A move whose moment has no value is refused.

A new row can wait for a time in the same way, with `states.create.requires.time`.

## Late moves

A move made close to a moment can be marked, or turned away
([reference](/reference/manifest/#late-moves)). A hotel flags a cancellation inside 48 hours of the
arrival:

```json
"late": [
  {
    "to": "cancelled",
    "from": ["booked"],
    "moment": { "column": "arrive", "time": { "table": "settings", "column": "arrive_from" } },
    "within": { "hours": { "table": "settings", "column": "cancel_hours" } },
    "mode": "flag",
    "flag": "late_cancel"
  }
]
```

| Field | Rule |
|---|---|
| `to` | The move judged. One late rule per move, and none beside a [booking rule](/guides/apps/booking-rules/#late-cancellations)'s own cancellation window for the same move. |
| `from` | Optional. Only moves from these states; each must list a move to `to`. |
| `moment` | The moment the window leads up to. |
| `within` | How long before it the window opens: one of `minutes`, `hours` or `days`, as a shift. |
| `mode` | `flag` lets the move through and marks it. `refuse` turns it away. |
| `flag` | For `flag`: a yes/no column of the row, set when the move is late. Not the state column, not a column another rule writes, not the flag of another late rule. |
| `refuse` | For `refuse`: `public` (the default) turns away a guest; `everyone` turns away staff too. |

A move is late when the moment is less than `within` away, or has already passed. The moment is
read from the row as it is stored, never from the write: a guest who types a later arrival in the
same change does not move the window they are cancelling in. The flag belongs to Adminium: a value
a writer sends for it is dropped when the move is not late. An import and sample data are never
judged late.

## Reminders at a wall time

An outbox reminder before a moment is sent a number of hours before it
([emails](/guides/apps/emails/#what-queues-a-row)). With `lead.at`, it is sent at a wall time on the
venue's day the lead reaches instead:

```json
"producers": [
  {
    "kind": "reminder",
    "link": "order_id",
    "before": {
      "table": "orders",
      "at": "pickup_at",
      "lead": {
        "via": "customer_id", "table": "customers", "column": "reminder_hours",
        "fallback": { "table": "settings", "column": "reminder_hours" },
        "max": 48,
        "at": "09:00"
      }
    }
  }
]
```

With a lead of 24 hours before a Saturday 20:00 pickup, the reminder goes at 09:00 on Friday. With
a lead of 3 hours, the day it reaches is Saturday, so it goes at 09:00 on Saturday. Without `at`,
it goes at the hour itself, 17:00. A reminder is sent only while its moment is still ahead, so a
wall time later in the day than the moment sends nothing that day: pick an early one.

## Settings a moment reads

A setting written `{table, column}` is read from **one** row. Otherwise which row is "the"
settings is anybody's guess, such as another guest's arrival time. So every setting in a manifest
must name either:

- the app's settings table, the outbox's `settings.table`, or
- a table standing alone: it has no foreign key of its own, no table points at it, and it keeps no
  states, limits or booking rule.

Anything else is refused by the manifest check. A stay's own arrival time read as a setting gets:

> "stays" may hold many rows, so "stays.arrival_time" is no setting: read settings from the app's
> one-row settings table (outbox.settings.table), or from a table that links nowhere, that no table
> links to, and that keeps no states or limits

A time kept on each stay is written `"time": {"column": "arrival_time"}` instead.

If a settings table is found holding two rows, a moment, a move's setting condition or a stamp's
amount reads no setting from it at all. The moment has no value, so a timed move reading it waits,
and a move waiting for the setting is refused. Keep one row there.

## A hold that nobody finishes

A [posting](/guides/apps/postings/) into an action that holds keeps its hold until the moment
`heldUntil` names. The job that makes the timed moves also looks, each minute, for holds whose
moment has passed and gives each back as the posting's `reverse` would — whatever state the row is
in, and with no move of the row itself. A hold that a move of the row already took or gave back is
simply let go of.

It is the same for a payment an add-on decided as the row was made (a gift card charged to a till
ticket nobody finishes): at its moment the amount is given back to the card and taken off the
row. Once the row reaches a state its posting takes for good, the payment stands and is not looked
at again.

A give-back that is refused (the ledger's own cap would be broken) is left alone for an hour and
tried again, as a refused timed move is.

## What a writer is told

In the dashboard and the REST API:

| Code | Status | When |
|---|---|---|
| `STATE_MOVE_REFUSED` | 409 | A move made outside the time it waits for. `details.requires` is `time`, `details.bound` is `after` or `before`, and `details.at` is the moment. With `details.reason` `no-moment`, the moment has no value. |
| `STATE_TOO_LATE` | 409 | A late move in mode `refuse` with `refuse: "everyone"`. `details.at` is the moment. |
| `WRITE_CONFLICT` | 409 | A late move's window opened while the write was made. Try again. |

Through the public API:

| Code | Status | When |
|---|---|---|
| `PUBLIC_TOO_EARLY` | 409 | The move opens later. `params.from` is when it opens, `params.at` the row's time it is counted from. |
| `PUBLIC_TOO_LATE` | 409 | The move closed, or a late move in mode `refuse`. `params.at` is when. |

A window closed by a moment with no value, or by a linked row, is refused without naming a time. The
full list is in [Errors](/reference/errors/).
