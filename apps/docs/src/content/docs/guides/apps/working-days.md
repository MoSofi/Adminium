---
title: Ready-by dates in working days
description: How an app writes the date an order will be ready, counted in the shop's working days, with its own working week, a daily cut-off and a table of closures, and what the customer is told.
---

A print shop promises "ready in 3 working days", a workshop "dispatched in 5". Counting that by hand
goes wrong on Fridays, after the afternoon cut-off and around bank holidays. Adminium counts it for
the app: a [stamp](/reference/manifest/#stamps) with `addWorkingDays` writes the date when the order
comes in, and counts it again whenever what it reads changes.

## Declaring it

The date is a `date` column with a stamp. The stamp names where the count starts, how many days, the
working week, the cut-off and the closures:

```json
{ "ref": "ready_by", "type": "date", "nullable": true,
  "rules": { "stamp": {
    "set": { "addWorkingDays": { "from": "received_at", "days": "service",
                                 "map": { "standard": 3, "express": 1 },
                                 "weekdays": "working_days", "cutoff": "cutoff",
                                 "closures": { "table": "closures", "from": "starts_on",
                                               "to": "ends_on", "active": "active" } } },
    "on": { "columns": ["received_at", "service"] } } } }
```

- **`from`** is the moment the order came in: a `date` or `timestamptz` column of the row, or `"now"`.
- **`days`** is a fixed number, or a column. Here it is the order's `service`, an enum, and `map`
  gives each service its days. An `int` column is read as the days themselves.
- **`weekdays`** and **`cutoff`** name two of the app's own [settings](/guides/apps/settings/), so the
  shop changes them on its settings page and no one edits the manifest. Either may instead be written
  in: `["mon", "tue", "wed", "thu", "fri"]`, `"14:00"`.
- **`closures`** is a table of the app: one row per closure, from one date to another, both
  included. An `active` column lets the shop switch a row off without deleting it.

The full rules for each field are in the [manifest reference](/reference/manifest/#working-days).

### The settings

The week is a `string` setting holding the days as a comma list, and the cut-off one holding a time
on a 24-hour clock. Give both a default, so a new install counts sensibly before anyone opens the
settings page:

```json
"settings": [
  { "key": "working_days", "type": "string", "default": "mon,tue,wed,thu,fri" },
  { "key": "cutoff", "type": "string", "default": "14:00" }
]
```

A saved value that is not a week or a time (somebody typed `"weekdays"`) is read as the default. With
no readable default the write is refused with `unreadable-setting`; Adminium never falls back to
counting calendar days.

### The closures table

Any table with two date columns does:

```json
{ "id": "closures", "columns": [
  { "ref": "id", "type": "int", "primaryKey": true },
  { "ref": "name", "type": "text" },
  { "ref": "starts_on", "type": "date" },
  { "ref": "ends_on", "type": "date" },
  { "ref": "active", "type": "bool", "nullable": true }
] }
```

A row with an empty `active` counts as active. The closures are read in the write itself, so a bank
holiday added a moment ago counts for the very next order.

## How the count goes

1. **The day it is received.** The order is received on the shop's day of `from`, when that is a
   working day and the time is before the cut-off. Otherwise it is received on the next working day.
   A `from` that is a date with no time ignores the cut-off.
2. **The days after it.** The date is the `days`-th working day after the received day. `0` days is
   the received day itself.
3. **A working day** is a day of the working week that no active closure covers.

With a Monday-to-Friday week and a 14:00 cut-off, 3 working days:

| Order in | Received | Ready by |
|---|---|---|
| Friday 13:59 | Friday | Wednesday |
| Friday 14:01 | Monday | Thursday |
| Saturday 10:00 | Monday | Thursday |
| Friday 13:59, the Monday a bank holiday | Friday | Thursday |

The day is the one on the shop's wall: `from` is read on the connection's time zone, so an order in
at 23:30 the night the clocks change lands on the day the shop would say.

## When it is counted again

The stamp fires like any stamp: on a create, and whenever a column in its `on` list changes. In the
example, changing an order from standard to express moves its date. To count again from the moment
something happens (the proof approved), add a second stamp that sets the same column from `"now"`
when the status moves.

A guest's value for the date is dropped: a customer cannot pick their own ready-by. Staff may move it
by hand, as with any stamp, until the stamp fires again.

## Showing the customer

A quote (`dryRun`) counts the same way and reads the same closures, so the date a checkout shows
before the customer pays is the date the save stores. Show the stored date on the confirmation, not
one worked out in the browser.

## Limits

- At most 400 working days; more is refused `out-of-range` on the days' column.
- Closures are read over 800 calendar days from `from`. A count that would run past them is refused
  `out-of-range`, never guessed.
- Negative days are refused.
- The rule has no editor in the Studio yet: write it in the manifest.
