---
title: Booking rules
description: How an app's booking rule books a person's time — hours, closures, the booking window, notice, the slot grid and no overlaps — what availability answers, and the refusals a writer sees.
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
