---
title: Booking rules and limits
description: How an app books a person's time with a booking rule, and how its limits keep pickup slots, ticket types, portions and rooms from being oversold — holds, locks, availability and the refusals a writer sees.
---

Some apps book **people** rather than seats: a clinician, a stylist, a tutor. A table of visits
then carries a **booking rule**. Each visit takes one person for its own length, and two visits of
one person never overlap. The time must also fall inside that person's hours, off their break, on
the booking grid and outside any closure.

The app declares the rule, and the install stores it on the app's real tables. Every write to the
table goes through it: the app's own screens, your pages in the dashboard, the public API,
automations. The fields are listed in the [manifest reference](/reference/manifest/#booking).

## What a rule reads

| Part | What it is |
|---|---|
| The visit | Its start, its length in minutes, the person it takes and its kind (a visit type). The length is usually copied from the kind. |
| Who does what | A list of which people offer which kinds. A person with no line for a kind is never booked for it. |
| The people's order | An order for "anyone" to pick in, and two switches per person: **active**, and **bookable online**. |
| Opening hours | One row per weekday: opens, closes, and an optional break. A weekday can be switched off. |
| A person's own hours | Optional. A person with rows here follows them every day, and a weekday with no row is their day off. A person with none follows the opening hours. |
| Closures | Dated closures, from one day to another, for everyone or for one person. A closure can be switched off. |
| Settings | The grid, the booking window, the notice and the late-cancellation hours. Each can be a number in the app's settings row, so you change it there without an update. |

Only visits whose status is one of the counted values take time. A cancelled visit takes none.

## When a time can be booked

A booking is taken only when all of these hold:

- **Offered.** The person offers the kind and is active. A guest booking online can have only a
  person marked bookable online.
- **In hours.** The visit starts at or after opening and ends by closing. It does not touch the
  break. Hours that would cross midnight count as a closed day.
- **On the grid.** Starts are every *grid* minutes, counted from opening. With opening at 08:30
  and a grid of 15, a visit can start at 08:30 or 08:45, never 08:40.
- **Not closed.** No closure covers that day for everyone or for that person.
- **Not in the past.** See [walk-ins](#walk-ins) for the one exception.
- **Inside the window.** The booking window counts **working days** from today, both days
  included. A working day has opening hours and no closure for everyone. With a window of 20,
  the twentieth working day from today is the last one bookable.
- **Far enough ahead,** for a guest. The notice is in minutes. Staff are never held to it.
- **Free.** No other counted visit of that person overlaps it. Each visit is measured by its own
  length, and the end is open: a 30-minute visit at 09:00 leaves 09:30 free.

A 45-minute kind is judged as 45 minutes. If it would run into the break or past closing, that
start is not offered for it, even when a 15-minute kind fits there.

### "Anyone"

A visit created with no person means anyone. Adminium tries each person who offers the kind, in
the people's order, and books the first one the time suits. It skips anyone not active and, for a
guest, anyone not bookable online. The pick is written with the visit, so the page learns who it
is only from the saved booking.

When nobody fits, the refusal is the one nearest to a yes: taken, then closed, then out of hours,
then out of range, then not offered.

### Walk-ins

A visit may not start in the past, with one exception. Staff may create a **walk-in** in the grid
slot that holds the current time: at 09:35 on a 15-minute grid, that is the 09:30 slot. It counts
as a walk-in when it is created with a counted status other than the first, for example
`checked_in` rather than `booked`.

### Moving and changing a visit

The rule runs on a create, and on a change that **moves** the visit: its start, length, person or
kind. A cancelled visit booked again is checked for overlap only.

A change between two counted statuses runs nothing. Checking a person in at 09:05 for their 09:00
visit, or on a day a closure was added since, is never refused.

## The venue's clock

Every time is read on the venue's clock: the time zone of the app's connection, or UTC when none
is set. Hours are wall times, so a 09:00 opening stays 09:00 across a clock change. "Today", the
window and the notice are the venue's too.

## Late cancellations

A rule can declare a cancellation window, in hours before the visit's start. What happens inside
it depends on the rule's mode:

| Inside the window | Mode `flag` | Mode `refuse` |
|---|---|---|
| A guest cancels | Goes through, and the visit is flagged late | Refused with `PUBLIC_TOO_LATE` |
| Staff cancel | Goes through, and the visit is flagged late | Goes through, not flagged |
| A guest moves the visit | Refused with `PUBLIC_TOO_LATE` | Refused with `PUBLIC_TOO_LATE` |
| Staff move the visit | Goes through | Goes through |

A guest can always cancel or move a visit outside the window. Inside it, the page tells them to
ring instead. The late flag is set by Adminium and never by a browser. An undo in the dashboard
puts it back as it was. An import, sample data and an undo never set it.

## What availability answers

A booking page asks for free times with the table's availability endpoint (see
[An app's public access](/guides/apps/public-access/)). It asks for one kind and one person, or
`any`, and then either one day or a strip of days:

```bash
# Every time of one day
curl 'https://admin.example.com/api/v1/public/availability/appointments_availability?kind=3&date=2026-10-06' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
# A strip of up to 31 days
curl 'https://admin.example.com/api/v1/public/availability/appointments_availability?kind=3&from=2026-10-05&days=7' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "time": "08:30", "state": "full" }, { "time": "08:45", "state": "free" }] }
{ "data": [{ "date": "2026-10-05", "open": 29, "state": "open" },
           { "date": "2026-10-10", "open": 0, "state": "closed" }] }
```

- **A day** lists each time at least one person in question works, on their grid, off their
  break and not away. A time is **free** when one of them could be booked for it, and **full**
  otherwise. A time in the past or inside the notice reads full.
- **A strip** gives each day's number of free times and a state: **open** when any time is free;
  **full** when people work that day and nothing is free; **closed** when nobody in question
  works, the day is shut, past or beyond the window.

The answer is worked out by the same checks as a booking, so a time shown free is a time the
booking takes, unless someone takes it first. A guest's answer never names a person or counts
anything, and it covers only people bookable online.

**Moving one's own visit.** Add `exclude=<id>` with the visit being moved, so its own time does
not block the new one. It works only for a visit the guest's session reaches. For any other id
the answer is the same as without it.

Leaving out the kind, asking with a party size, or mixing a day with a strip is refused
`400 PUBLIC_QUERY_REFUSED`.

### The staff answer

The app's staff screens ask `GET /api/v1/data/<connection>/<table>/booking-slots` with the same
`kind`, `resource`, `date` or `from` and `days`, and `exclude`. It needs read access to the
table. Staff are not held to the notice, see people who are not bookable online, may exclude any
visit, and, when they ask about `any`, learn which person each free time would book.

## What a writer is told

Through the public API:

| Code | Status | When |
|---|---|---|
| `PUBLIC_SLOT_FULL` | 409 | The time was taken while the guest was choosing. |
| `PUBLIC_SLOT_BUSY` | 409 | Someone else is booking that day this instant. Try again. |
| `PUBLIC_TOO_LATE` | 409 | A late move, or a late cancellation in mode `refuse`. |
| `PUBLIC_WRITE_REFUSED` | 400 | The time is not bookable. `params` says the column and why: `closed`, `out-of-hours`, `out-of-range` or `not-offered`. |

In the dashboard and the REST API:

| Code | Status | When |
|---|---|---|
| `BOOKING_TAKEN` | 409 | Another counted visit of that person overlaps it. |
| `BOOKING_CLOSED` | 409 | A closure covers the day. |
| `BOOKING_BUSY` | 409 | Another booking of that day is being written. Try again. |
| `VALIDATION_FAILED` | 422 | `details.reason` is `BOOKING_OUT_OF_HOURS`, `BOOKING_OUT_OF_RANGE` (past, beyond the window, inside the notice) or `BOOKING_NOT_OFFERED`, and the field is named. |

A change to several visits at once that moves them, or gives them a counted status, is refused
`409` with the reason `CAPACITY_ONE_AT_A_TIME`: each has to be judged on its own. Marking several
visits cancelled or no-show together goes through.

## Booking rules and capacity

A table carries one or the other, never both.

| | [Capacity](/reference/manifest/#capacity) | Booking rule |
|---|---|---|
| Suits | A restaurant: tables and covers | A clinic or a salon: one person's time |
| Counts | The party sizes that start at each slot, up to a limit per slot | Overlaps per person, by each visit's own length |
| Hours | Every slot of the day | Opening hours or a person's own, breaks, closures |
| Availability asks for | A day and a party size | A kind, a person or `any`, and a day or a strip of days |
| Picks a person | No | Yes, for "anyone" |

## Limits

Most apps that sell to guests do not book a person. They sell a share of a **pool**: a kitchen's
orders per pickup slot, the seats of a ticket type, today's portions of a dish, the rooms of a
type on each night. A table says so with `capacity`, and Adminium keeps its rows inside the pool
on every write, whoever makes it. The fields are listed in the
[manifest reference](/reference/manifest/#capacity).

A limit is one of three kinds:

| Kind | A row takes | For example |
|---|---|---|
| `slot` | Its amount from the pool of the time it starts at | Orders per 15-minute pickup slot |
| `parent` | Its amount from a limit held on the row it points at | Tickets of a type, portions of a dish today, uses of a code |
| `night` | One unit on every night of its stay, from a pool counted in another table | Rooms of a type, one stay per room, parking spaces |

A rule with no `kind` is a slot rule.

### Slot limits

A pickup kitchen takes six orders every 15 minutes, while it is open, for the next week. See
[Slot limits](/reference/manifest/#slot-limits) for every field.

```json
"capacity": {
  "kind": "slot",
  "slot": "pickup_at",
  "amount": 1,
  "perSlot": { "table": "settings", "column": "orders_per_slot" },
  "slotMinutes": 15,
  "windowDays": 6,
  "noticeMinutes": { "table": "settings", "column": "lead_minutes" },
  "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" },
  "closures": { "table": "closures", "from": "from_date", "to": "to_date", "active": "active" },
  "pauses": { "table": "slot_pauses", "slot": "slot_at", "active": "active" },
  "countWhere": { "column": "status", "values": ["held", "placed", "ready", "collected"] },
  "hold": { "column": "held_until", "states": ["held"] }
}
```

| Field | Rule |
|---|---|
| `slot` | The row's start, a `timestamptz`. |
| `amount` | How much a row takes: a number, or an `int` column of the row (a party size). |
| `perSlot` | The pool of each slot: a number, or a column of the app's settings row. |
| `slotMinutes` | The grid. Slots start every so many minutes, counted from the day's opening. |
| `hours` | Opening hours per weekday: a table with a `weekday` enum of `mon` to `sun`, `opens` and `closes` as `HH:MM` text, and an optional `open` switch. A weekday with no row, or switched off, has no slots. |
| `opens`, `closes` | One opening for every day, in place of `hours`. |
| `closures` | Dated closures, `from` to `to` inclusive. An empty `to` has no end. |
| `pauses` | Slots the venue has paused, such as a kitchen that is full. |
| `noticeMinutes` | How far ahead a guest's slot must be. |
| `windowDays` | How many days ahead a slot may be, counted from the venue's today. |
| `resource` | A column the limit applies per value of too, such as a table or a room. |
| `cancelHours` | How many hours before its slot a guest may still cancel online. |

With `hours`, a slot starts at or after opening and before closing: `[opens, closes)`. With a
kitchen open 11:00 to 14:00 on a 15-minute grid, the last slot is 13:45. With `opens` and
`closes`, a slot must also end by closing. Hours whose closing is at or before their opening run
past midnight, and the small hours belong to the evening before.

A new slot, or a row moved to another slot, is checked in this order, and the first failure is
the refusal: a closed day (`closed`), outside the day's hours (`out-of-hours`), off the grid
(`out-of-range`), a paused slot (`paused`), in the past or inside the notice (`out-of-range`),
beyond the window (`out-of-range`). Pauses and the notice hold a guest only. Staff may take a
paused slot or one five minutes away, but never one in the past.

A row that only counts again, such as a cancelled order put back, is never refused by a pause, a
closure or a window that came later. It is only counted.

### Parent limits

A box office sells each ticket type up to its own capacity, only inside its sales window, at most
`max_per_order` of a type to one order, and never more than the hall holds across all of a show's
types. See [Parent limits](/reference/manifest/#parent-limits).

```json
"capacity": {
  "kind": "parent",
  "via": "ticket_type_id",
  "size": { "column": "capacity" },
  "countWhere": [
    { "column": "status", "values": ["valid", "returned", "checked_in"] },
    { "column": "status", "values": ["held", "paid"], "via": "order_id" }
  ],
  "window": { "opens": "sales_start", "closes": "sales_end" },
  "perWrite": { "max": { "column": "max_per_order" }, "within": "order_id" },
  "also": [{ "via": "event_id", "size": { "via": "hall_id", "column": "capacity" } }],
  "lockBy": "event_id",
  "hold": { "column": "held_until", "states": ["held"], "via": "order_id" },
  "reserved": { "states": ["returned"] }
}
```

| Field | Rule |
|---|---|
| `via` | The foreign key to the row that holds the limit. A row whose `via` is empty is left out of this rule. |
| `size` | The limit: a number, a setting, or a numeric column of the row `via` points at. An empty column means no limit. |
| `amount` | How much a row takes: an `int` column of the row or a number. Absent, one. |
| `window` | Two `timestamptz` columns of the pointed-at row. A guest buys only between them. An empty one is no bound. Staff are not held to it. |
| `perWrite` | At most `max` of one pool per row of `within`, such as six tickets an order. `max` takes the same forms as `size`. |
| `also` | Up to two wider pools the same rows take from. `size` is a number, a setting, a column of the wider row, or `{ "via", "column" }` one hop further (the event's hall). |
| `day` | A `timestamptz` of the row, or `{ "column", "via" }` of its owner. Only rows of the same venue day count together. |
| `lockBy` | The column whose value names the lock: `via`, or a wider pool's key that the table copies from the `via` row. Absent, one lock for the whole rule. |

A kitchen's portions of a dish for today are a parent limit that counts by day. The number
written on the dish holds only on the day it is written for; on any other day there is no limit.

```json
"capacity": {
  "kind": "parent",
  "via": "menu_item_id",
  "size": { "column": "portions", "onDay": "portions_on" },
  "amount": "qty",
  "countWhere": { "column": "status", "values": ["held", "placed", "ready", "collected"], "via": "order_id" },
  "day": { "column": "pickup_at", "via": "order_id" },
  "hold": { "column": "held_until", "states": ["held"], "via": "order_id" }
}
```

The row `via` points at must exist, or the write is refused `out-of-range`. A guest outside the
sales window is refused `not-on-sale`. More than `perWrite` allows is refused `too-many`.

### Night limits

A guest house sells its rooms by the night. A stay takes one room of its type on every night from
its arrival to the night before it leaves. The pool is the number of rooms of that type, less those
out of service that night. A second rule keeps each room to one stay a night. Parking is an extra
with its own limit, taken on the stay's nights. See [Night limits](/reference/manifest/#night-limits).

```json
"capacity": [
  {
    "kind": "night",
    "from": "arrive",
    "to": "depart",
    "countWhere": { "column": "status", "values": ["held", "booked", "in_house"] },
    "pool": {
      "via": "room_type_id",
      "count": {
        "table": "rooms",
        "column": "room_type_id",
        "outOfService": { "table": "room_closures", "room": "room_id", "from": "from_date", "to": "to_date", "active": "active" }
      },
      "fits": { "column": "sleeps" },
      "given": { "via": "room_id", "column": "room_type_id" }
    },
    "nights": { "min": 1, "max": { "table": "settings", "column": "max_nights" }, "minByArrival": { "sat": 2 }, "aheadDays": { "table": "settings", "column": "ahead_days" } },
    "hold": { "column": "held_until", "states": ["held"] },
    "arrived": { "states": ["in_house"] }
  },
  {
    "kind": "night",
    "from": "arrive",
    "to": "depart",
    "countWhere": { "column": "status", "values": ["held", "booked", "in_house"] },
    "pool": {
      "via": "room_id",
      "size": 1,
      "outOfService": { "table": "room_closures", "room": "room_id", "from": "from_date", "to": "to_date", "active": "active" }
    },
    "hold": { "column": "held_until", "states": ["held"] },
    "arrived": { "states": ["in_house"] }
  }
]
```

On the extras a stay books, the nights come from the stay:

```json
"capacity": {
  "kind": "night",
  "from": { "via": "stay_id", "column": "arrive" },
  "to": { "via": "stay_id", "column": "depart" },
  "countWhere": { "column": "status", "values": ["booked", "in_house"], "via": "stay_id" },
  "pool": { "via": "extra_id", "size": { "column": "per_night" } },
  "arrived": { "states": ["in_house"], "via": "stay_id" }
}
```

| Field | Rule |
|---|---|
| `from`, `to` | The arrival and the departure: `date` columns of the row, or `{ "via", "column" }` of the row it belongs to. |
| `pool.count` | The pool is the number of rows of `table` whose `column` points at the same row as `via`: the rooms of a type. |
| `pool.size` | Instead of `count`: `1` (one stay a night on each row pointed at, such as a room) or `{ "column" }` of that row (spaces of an extra). |
| `outOfService` | Dated closures of single rooms, `from` to `to` inclusive, an empty `to` open-ended. Each takes one unit from the pool on the nights it covers. |
| `fits` | A column of the pool's row a guest count must fit, such as how many a room type sleeps. Availability lists only the types that fit the guests asked. |
| `given` | When the row's `via` link is set (a room given), it counts against that room's type, not the one booked. |
| `nights` | `min` and `max` nights, `minByArrival` per weekday of arrival, and `aheadDays`, how far ahead a guest may arrive. |
| `arrived` | The states of a stay whose guest is in the house (its own, or its owner's with `via`). |

A stay must leave after it arrives, and its length must be inside `nights`, or it is refused
`out-of-range` on `to`. A guest may not arrive before the venue's today or further ahead than
`aheadDays`: `out-of-range` on `from`.

**A guest in the house.** A change of a stay whose guest has arrived (another room, another type,
new dates) is judged from the venue's today on. The nights already slept are never judged again: a
room closed last night takes nothing from a guest moved today. A room closed tonight or later
still refuses the move. The extras whose nights come from that stay are judged the same way.

`fits` does not refuse a write. To refuse a stay for more guests than the room sleeps, give the
create entry an `agrees` check (see [An app's public access](/guides/apps/public-access/)).

## Several limits on one table

A table may carry up to three rules, as a list. At most one of them is a slot limit. Each is
judged on its own: the stay above must fit both its room type and its room.

### Which rows count

`countWhere` says which rows take from the pool. It is one condition, or a list of two: one on the
row itself and one on the row it belongs to, through `via`. A ticket counts while it is valid,
returned or checked in, and while its order is held or paid. Without `countWhere`, every row
counts.

A rule reads one owner: every `via` in its conditions, hold and day is the same foreign key.

Two cases count on the side that never oversells:

- A row created without its state column counts, as the column's default may be a counted one.
- A row whose owner link is empty counts.

A row that counts always takes more than nothing. A party of zero or less is refused
`out-of-range`, never counted as places given back.

## Holds

A checkout holds places while the guest pays. `hold` makes a row count only while its hold has not
ended, and only while its state is one of `hold.states`. A paid order counts whatever its old hold
says. See [Holds](/reference/manifest/#holds).

```json
"hold": { "column": "held_until", "states": ["held"], "via": "order_id" }
```

| Field | Rule |
|---|---|
| `column` | Where the hold ends: a `timestamptz` column of the row (or of its owner with `via`), or `{ "column", "via", "or" }` read through a link. |
| `states` | The states that are held. Each must be a counted state. |
| `via` | Read the state and the end on the row this row belongs to (the order of a ticket). |

The end must be a column Adminium stamps, never one a guest writes. Give it a stamp, for example
ten minutes from the create, never later than the doors open:

```json
{
  "ref": "held_until",
  "type": "timestamptz",
  "nullable": true,
  "rules": {
    "stamp": {
      "set": { "addMinutes": { "minutes": { "table": "settings", "column": "hold_minutes" }, "notAfter": { "via": "event_id", "column": "doors_at" } } },
      "on": "create"
    }
  }
}
```

Nothing else may watch that column: no other stamp, no code renewal and no copy that follows it.
A new hold writes it directly as it lets the old one go, and no rule runs on that write.

A hold with an empty end holds. A hold whose end has passed stops counting at once, by the clock,
whether or not a timed move has marked the row expired yet.

**A hold read through a link.** An order made from a waitlist offer is held until the offer ends,
and otherwise until its own end. `column.via` is a foreign key of the row the hold reads, and the
first end of `or` that is filled answers when the link is empty:

```json
"hold": {
  "column": { "column": "offer_until", "via": "waitlist_id", "or": [{ "column": "held_until" }] },
  "states": ["held"],
  "via": "order_id"
}
```

### Places kept for the waitlist

`reserved` keeps places that came back, such as a returned ticket, counted against the public
while staff decide who gets them. Staff do not count them, so the desk can sell or offer them.
Its states must be counted ones and not also held. It belongs to parent limits.

```json
"reserved": { "states": ["returned"] }
```

An order that leaves its hold for a paid state takes no new place. It is counted as staff count,
so the places kept back for the waitlist it was offered are not counted against it twice.

### One live hold per guest

A guest who goes back and changes their tickets makes a new hold. The old one is let go in the same
write, rather than counted until its time runs out. Adminium finds the old hold only through proof,
never a typed address:

- **The page's own link.** A create answers the new row's own link and a session on it. The page
  sends that session back as `replaces` with its next create. The session then moves to the new
  hold. This needs the create entry's `shareLink`.
- **A signed-in guest.** A guest with a verified session has their other live holds let go.

A hold let go has its end moved to one second before the new write began. Only a hold whose end is
a column of the row itself can be let go. A dry run with `replaces` judges the old places as let
go, and writes nothing.

## Locks and busy writers

Two guests pressing Buy for the last seat must not both get it. So Adminium counts a pool under a
lock only the writers of that pool wait for, held until the write commits:

| Kind | Rows judged together |
|---|---|
| `slot` | Every row of one venue day. |
| `parent` | Every row sharing the `lockBy` value, or the whole rule without one. A wider pool `lockBy` does not follow takes a lock of its own. |
| `night` | Every row of the table. |

A write names its locks before it starts. If the row moved to another pool in between, it names
them again and starts over, up to three times, then answers `409` `WRITE_CONFLICT` with
`details.retry: true`.

On Postgres and MySQL a writer waits at most 10 seconds for a lock another writer holds, then
answers `409` `CAPACITY_BUSY`. Try again. Writers of one server also queue in memory before they
take a database connection, so a rush on one show does not starve every other page.

A write of several rows at once (a bulk change, a public batch) holds no pool lock. A row in it
that could take from a limit (a create that counts, or a change that moves a row's pool, what it
takes, or into a counted state) is refused: staff get `409` `CONFLICT` with the reason
`CAPACITY_ONE_AT_A_TIME`, a guest `400` `PUBLIC_WRITE_REFUSED`. A change out of counting goes
through: a bulk cancel is fine. An import and sample data are written as history and are not
judged.

:::caution[Upgrading]
The names of the limit locks changed after 0.3.4: a slot limit now locks a whole venue day.
Two servers running different versions take different names, so during a rolling deploy a slot
can be oversold. Deploy every server at once.
:::

### An index for the counts

A limit counts rows by their foreign keys: the pool's `via`, a wider pool's, `perWrite.within`,
the owner's and a stay's. Mark those columns `index: true`, so the count under the lock reads the
rows it needs and not the whole table:

```json
{ "ref": "ticket_type_id", "type": "fk", "references": "ticket_types", "index": true }
```

`index` is only for a foreign key a limit or a [total](/reference/manifest/#totals-that-count-and-climb)
counts by, and not for a unique column.

## What a guest can ask

A page asks with an entry of `kind: "availability"` on the limited table. See
[Availability](/reference/manifest/#availability).

```json
{ "table": "tickets", "kind": "availability", "methods": ["GET"], "under": "event_id", "showLeft": { "belowShare": 10 } }
```

| Field | Rule |
|---|---|
| `rule` | Which of the table's limits it answers, `0` to `2`. Absent, the first. |
| `showLeft` | Say how many are left, but only when few are: `{ "below": 3 }`, or `{ "belowShare": 10 }` percent of the pool. Parent and night limits only. |
| `under` | A parent limit only: the column of the pool's rows a page asks by, such as a ticket type's event. |

The answer is counted exactly as a write counts, with no lock. Held places and places kept for
the waitlist count against the guest. A number is said only where `showLeft` says, and only when it
is low. Asking a parameter the kind does not take is refused `400` `PUBLIC_QUERY_REFUSED`.

**Slot.** `date`, or `from` with `days` (up to 31), and `party`. Each time is `free`, `full` or
`paused`. A strip gives each day `open` with its number of free times, `full`, or `closed`.

```bash
curl 'https://admin.example.com/api/v1/public/availability/kitchen_orders_availability?date=2026-10-09' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "time": "11:30", "state": "free" }, { "time": "11:45", "state": "paused" },
           { "time": "12:00", "state": "full" }] }
```

A slot whose rows each take a fixed amount is asked for that amount. A party column is never asked
for more than one row may hold, so a page cannot learn how full a slot is by asking ever larger
parties. The validator therefore requires `validation.max` on that column:

```json
{ "ref": "party", "type": "int", "default": 2, "rules": { "validation": { "min": 1, "max": 8 } } }
```

A slot rule written before limits had kinds is asked, as before, for one `date` and a `party`.

**Parent.** `under` (required when the entry names one), `date` (a limit that counts by day;
absent, the venue's today) and `qty`. Each row the limit is held on is `on`, `soon`, `ended`, or
`soldout` when fewer are left than `qty`, in its own pool or a wider one. `qty` is capped at what
one order may take and at the `showLeft` threshold, and at one without `showLeft`.

```bash
curl 'https://admin.example.com/api/v1/public/availability/boxoffice_tickets_availability?under=12&qty=2' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "id": "31", "state": "on", "left": 4 }, { "id": "32", "state": "soldout" },
           { "id": "33", "state": "soon" }] }
```

**Night.** `from` and `to` (at most 31 nights), `guests`, and `earliest`, how many days (up to 90)
to look for a later arrival of the same length. Each pool is `open`, `full`, or `closed` when those
dates are not a stay the venue sells. With `earliest`, each pool and the whole answer carry the
first later arrival with room.

```bash
curl 'https://admin.example.com/api/v1/public/availability/guesthouse_stays_availability?from=2026-10-09&to=2026-10-11&guests=2&earliest=14' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "pool": "1", "state": "full", "earliest": "2026-10-16" },
           { "pool": "2", "state": "open", "left": 2, "earliest": "2026-10-10" }],
  "earliest": "2026-10-10" }
```

A parent or night answer lists only the rows a guest may already see: those a plain public read of
the pool's table shows (no claim, no parent), at most 200. So a night limit needs an entry such as
`{ "table": "room_types", "methods": ["GET"], "select": ["id", "name", "sleeps"] }`, and a ticket
type shown only with a code is listed only when the guest sends that code in the
`x-adminium-code` header. A code in the query string is refused.

**Moving one's own row.** `exclude=<id>` leaves the guest's own row out of the count: a stay being
moved, or the order a checkout already holds. It works only for a row, or an owner row, the
guest's session reaches. Any other id is ignored, and the answer is the same as without it.

Sample rows are real rows. While they are in the table, those in a counted state take places from
the pools guests see. Remove the sample data before you open for sales (see
[Sample data](/guides/apps/sample-data/)).

### The desk's counts

Staff screens ask `GET /api/v1/data/<connection>/<table>/capacity-counts` for size, taken, held
and left per pool. It is counted as a write counts, from staff's view: no notice, pause or sales
window hides a pool, and places kept for the waitlist are shown apart as `kept`, not taken. A pool
made smaller after it sold, such as a room out of service, can show less than nothing left.

| Kind | Ask | Each row |
|---|---|---|
| `slot` | `date`, or `from` and `days` (up to 31) | `time` or `date`, `size`, `taken`, `held`, and `paused` or `closed` |
| `parent` | `ids`, or `under` with `value` or up to 50 `values` (up to 500 rows, each naming its `under` when asked by `values`), and `date` for a limit that counts by day | `id`, `size`, `taken`, `held`, `kept`, `left`, and `also` for the wider pools |
| `night` | `from` and `days` (up to 62), optionally `ids` | `pool`, `date`, `size`, `outOfService`, `taken`, `held`, `left` |

`rule` picks the limit, `0` by default. The asker needs read access to the table, to the pools'
tables (the ticket types, the room types, the rooms and their closures) and to every column the
rule reads. A column asked `under` must be one they see unmasked. A table with no limit answers
`404`.

## When a limit refuses a write

In the dashboard and the REST API:

| Code | Status | When |
|---|---|---|
| `CAPACITY_FULL` | 409 | The pool has no room. `details` has `kind`, `column` (the column the pool is counted by), `rule`, `row`, `pool` (`key`, and `at`, the day or night), and `left`, the places that were left before this write. |
| `CAPACITY_BUSY` | 409 | Another write holds the pool's lock. Try again. |
| `VALIDATION_FAILED` | 422 | The place is not one the venue offers. The field is named, and `details.reason` is `CAPACITY_OUT_OF_RANGE`, `CAPACITY_OUT_OF_HOURS`, `CAPACITY_CLOSED`, `CAPACITY_PAUSED`, `CAPACITY_NOT_ON_SALE` or `CAPACITY_TOO_MANY`. |

A caller who may not read a column the rule reads is told the code and the column, without `pool`
and `left`. A slot rule written before limits had kinds answers `CAPACITY_FULL` with the column
only, and its `422` without a reason.

Through the public API:

| Code | Status | When |
|---|---|---|
| `PUBLIC_SLOT_FULL` | 409 | A slot limit is full. `params.column`. |
| `PUBLIC_SOLD_OUT` | 409 | A parent limit is sold out. `params.column`, and in a create with child rows which row. |
| `PUBLIC_NO_ROOM` | 409 | A night limit has no room. `params.night` is a night of the guest's stay that has none. |
| `PUBLIC_SLOT_BUSY` | 409 | Someone else is writing to that pool this instant. Try again. |
| `PUBLIC_TOO_LATE` | 409 | A cancel inside the slot limit's `cancelHours`. |
| `PUBLIC_WRITE_REFUSED` | 400 | The place is not offered. `params.column`, and `params.reason`: `out-of-range`, `out-of-hours`, `closed`, `paused`, `not-on-sale` or `too-many`. |

A guest is never told how full a pool is or whose rows fill it. Every code is listed in the
[error reference](/reference/errors/).
