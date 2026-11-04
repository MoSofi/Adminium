<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

An offer that lasts as many hours as the settings row says, but never past the show's doors:

```json
{ "ref": "offer_until", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": {
    "set": { "addMinutes": { "hours": { "table": "settings", "column": "offer_hours" },
                             "notAfter": { "column": "doors_at", "via": "event_id" } } },
    "on": { "column": "status", "values": ["offered"] } } } }
```

#### Working days

`addWorkingDays` writes the date so many working days after an order comes in: the shop's working
week and its daily cut-off kept as its own settings, its closures kept in a table.

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

| Field | Rule |
|---|---|
| `from` | `"now"`, or a `date` or `timestamptz` column of the row other than the stamp's own. |
| `days` | A number (0–3650), or a column: an `int`, or an enum or text column with `map` giving each of its values its days. More than 400 working days is refused (`out-of-range`, on the days' column). |
| `weekdays` | The working week: 1–7 of `"mon"` … `"sun"`, each once; or the key of a `string` [setting](https://docs.adminium.dev/reference/manifest/#settings) the app declares, holding the days as a comma list (`"mon,tue,wed,thu,fri"`), which the shop changes on its settings page. |
| `cutoff` | Optional: the time of day after which an order counts from the next working day, `"HH:MM"` on a 24-hour clock, or the key of a `string` setting holding one. |
| `closures` | Optional: a table of the app with a `date` column the closure starts on (`from`) and one it ends on (`to`), both included, and optionally a `bool` column (`active`) that switches a row off. |

**The count.** The order is **received** on the venue's day of `from` when that day is a working day
and `from` is before the cut-off (or `from` is a date with no time of day, or there is no cut-off);
otherwise on the next working day. The date is the `days`-th working day **after** the received
day; `0` is the received day itself. A working day is a day of the working week that no active
closure covers. With a 14:00 cut-off and a Monday-to-Friday week, 3 days from a Friday at 13:59 is
the Wednesday, from 14:01 the Thursday, and from a Saturday at 10:00 the Thursday; a bank holiday
Monday in the closures pushes each a day. A print job received on Wednesday 5 August 2026 at 10:20
is ready on Monday 10 August, or on Thursday 6 August as express.

**Days a formula works out.** `days` (or `from`) may be a [formula](https://docs.adminium.dev/reference/manifest/#formulas) column of the row,
and the stamp may fire when one changes (`"on": { "columns": ["turnaround_days"] }`): it is then
worked out once the formulas are, on a create and on a change, so a job's standard or express days
plus a day for each change asked count as the formula says. When the formula reads a total of
child rows (a count of the proofs asked to change), adding, changing or removing one of those rows
counts the date again, as the row's own change would; an import of history and an undo never do.
Needs Adminium 0.3.44.

**The venue's clock.** `from` is read on the venue's clock (the connection's time zone), so across a
clock change the day an order lands on is the one on the shop's wall, whatever zone the server runs
in.

**Settings.** A setting the week or the cut-off names is read when the row is written: the value the
shop saved, else the default the app declares. A saved value that is not a week or a time is read
as the app's default for it; with no readable default the write is refused (`422` with the code
`unreadable-setting` on the stamp's column), never counted in calendar days.

**Closures.** The closures are read in the write itself, over 800 days from the day of `from`: a
closure added a moment ago counts for the next order, and a quote reads the same rows the save
reads. A date further than that is refused (`out-of-range`).

It fires as any stamp does: on a create, when a column moves to a value (the ready-by counted again
from `"now"` when the proof is approved), or whenever the columns it reads change. A writer's value
for it is dropped for a guest; staff may still move the date by hand, as with `addDays`, until the
stamp fires again.
