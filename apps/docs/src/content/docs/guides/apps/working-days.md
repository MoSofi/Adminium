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
  gives each service its days. An `int` column is read as the days themselves, and that column may
  be a [formula](/reference/manifest/#formulas) (see [Days a formula works out](#days-a-formula-works-out)).
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

#### Public holidays from the Holiday Calendars add-on

The shop need not type its bank holidays in. The Holiday Calendars add-on keeps each country's
public holidays as rows of its own table, `holidays`. An app that suggests the add-on can give its
closures table a link into that table, with [`addOnLink`](/reference/manifest/#column-rules):

```json
{ "ref": "holiday_id", "type": "int", "nullable": true,
  "rules": { "addOnLink": { "addOn": "holiday-calendars", "table": "holidays" } } }
```

The app's own screen then offers "Add as a closure" beside a holiday: it writes a closures row with
the holiday's date as both ends and the link filled in. The add-on never writes the app's table.
The count reads only the closure's dates and `active`, so a closure made from a holiday counts like
one typed by hand. Maker Shop and Print Shop do this. See
[Add-ons with tables](/guides/add-ons-with-tables/).

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
example, changing an order from standard to express moves its date.

A column has one stamp. To count again from the moment something happens (the proof approved),
count from `"now"` and give `on` a list of the moments that count, up to three:

```json
{ "ref": "ready_by", "type": "date", "nullable": true,
  "rules": { "stamp": {
    "set": { "addWorkingDays": { "from": "now", "days": "turnaround_days",
                                 "weekdays": "working_days", "cutoff": "cutoff",
                                 "closures": { "table": "closures", "from": "starts_on",
                                               "to": "ends_on", "active": "active" } } },
    "on": ["create",
           { "column": "proof_state", "values": ["approved"] },
           { "columns": ["turnaround_days"] }],
    "notEarlier": true } } }
```

A guest's value for the date is dropped: a customer cannot pick their own ready-by. Staff may move it
by hand, as with any stamp, until the stamp fires again.

### A date the customer was told never comes forward

Counting again can give an earlier date than the one the customer was told. A job promised for
Friday, approved on Monday with three working days to go, would move to Thursday. With
`"notEarlier": true` the column keeps the later of the date it holds and the new one: a later date
moves it on, an earlier one leaves it where it is. An empty column takes the new date. It works for
a `date` or a `timestamptz` column. Needs Adminium 0.3.53.

### Days a formula works out

`days` may name a formula column of the row, and `on` may watch one
(`{ "columns": ["turnaround_days"] }`): standard or express days, plus a day for each change the
customer asked for. The stamp is then worked out after the formulas, on a create and on a change.
When the formula reads a total of child rows (a count of the proofs sent back), adding, changing or
removing one of those rows counts the date again, as a change of the row itself would. An import of
history and an undo never do. Needs Adminium 0.3.44.

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
