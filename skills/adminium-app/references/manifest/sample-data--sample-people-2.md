<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Sample data — Sample people; do not edit -->

# Manifest spec: Sample data — Sample people

| Directive | Value |
|---|---|
| `{ "@ref": "<label>" }` | The key of an earlier row with that label. In an add-on's sample it may also be the label of one of the add-on's `seeds` rows (a unit the install wrote). |
| `{ "@person": "<key>" }` | One of the manifest's [sample people](https://docs.adminium.dev/reference/manifest/#sample-people): the staff member made for that key. In a [staff column](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) or another text column that holds a staff member's id, and anywhere inside a json value (a saved filter that names a rep). Only in the app's own sample file, not in its rows for an add-on. |
| `{ "@ago": "PT19M" }` | An ISO 8601 duration before now. |
| `{ "@in": "PT20M", "@grid": 15 }` | An ISO 8601 duration after now. With `@grid`, rounded up to the next step of that many minutes on the venue's own clock, counted from its midnight (never past the next midnight): the first pickup slot at least 20 minutes away. |
| `{ "@in": "PT20M", "@slot": "orders" }` | The first open time of that table's [slot limit](https://docs.adminium.dev/reference/manifest/#slot-limits) at least that far ahead: its hours, closures and pauses, on its grid, with room left after the sample's own rows placed so far; on the next open day when today has none, looking two weeks ahead, else the plain `@in` time. Not with `@grid`. |
| `{ "@day": -1, "@time": "09:30" }` | A wall time in the venue's time zone, a number of days from today (−366 to 366). |
| `{ "@day": 3 }` | A date: that many days from today, as the venue's calendar has it. For a `date` column. |
| `"@workdays": true` | Added to either `@day` form: the days count Monday to Friday only, and day 0 on a weekend is the Monday after. So the sample's busy day is never a Saturday. |
| `"@week": true` | Added to either `@day` form instead: the days count from the bundle's `weekAnchor` in the week nearest today (three days either way), so every date keeps the weekday it was written for: a weekend stay stays on a weekend, whatever day the sample is added on. Needs `weekAnchor`. |
| `{"@month": -2, "@dom": 14}` | A date in the venue's time zone: that day of the month, so many months back (`0` is this month). Add `"@time": "10:00"` for a time on that day. A day past the month's end is its last day, and a day that has not come yet is today (a time not yet come, now). Use it for history counted in calendar months: "this month" and "in May" read the same whether the sample is added on the 3rd or the 28th. |
| `{ "@t": { "en-US": "…" } }` | Text in the language of the person adding the sample. Keys are `xx` or `xx-XX`. |
| `{ "@asset": "<label>" }` | A file from `assets`, added to the Files library: a picture (`.png`, `.jpg`, `.webp`, `.gif`) for a picture column, or an SVG or a model (`.svg`, `.glb`, `.stl`, `.3mf`) for a column of one product asset whose `accept` names its kind. Each is held to what an upload of it is held to: the column's `maxBytes`; an SVG written again by the cleaner, so a script or an `onload` is dropped and a `<foreignObject>` or a link out of the drawing refuses the sample; a model read whole and refused when it is not the kind its name says; and the public cap of its kind (a model 30 MiB, an SVG 2 MiB). No font: a sample ships no `.woff2`. An app's rows for an add-on name their own `assets`, which leave with those rows. Needs Adminium 0.3.51 for an SVG or a model, and for files in an app's rows for an add-on: `adminium app check` asks for that floor when a sample ships one. |

Beside its `@label`, a row may carry the row directive `@byClock`, so that a sample day's
statuses match the time it is added at:

```json
{ "@label": "visit-2", "starts_at": { "@day": 0, "@time": "10:00", "@workdays": true },
  "status": "booked",
  "@byClock": { "at": "starts_at",
                "before": { "status": "seen" },
                "around": { "status": "checked_in" } } }
```

| Field | Rule |
|---|---|
| `at` | The row's time: the name of a column the row sets, or a `@day` with a `@time`. |
| `before` | Columns merged into the row when its time is more than half an hour before the moment the sample is added. |
| `around` | Columns merged when its time is within half an hour of it. |
| `after` | Columns merged when its time is later. |

Each set holds columns of the table, and may use directives. A set with `"@skip": true` leaves the
row out altogether: a payment for a visit that has not happened yet.

A row that lasts from one time to another (a stay) may carry `@byStay` instead, placing it by where
the adding moment falls against its two times:

```json
{ "@label": "stay-4", "arrive": { "@day": -1, "@week": true }, "depart": { "@day": 2, "@week": true },
  "status": "booked",
  "@byStay": { "from": "arrive", "to": "depart", "times": { "from": "15:00", "to": "11:00" },
               "during": { "status": "in_house" }, "after": { "status": "departed" } } }
```

| Field | Rule |
|---|---|
| `from`, `to` | The arrival and the departure: columns the row sets, or `@day`s. |
| `times` | `{ "from"?, "to"? }`: the wall times a date is read at (arriving from 15:00, leaving by 11:00); else its midnight. |
| `before`, `during`, `after` | Columns merged when the adding moment is before the stay, during it, or after it. |

A row takes one of `@byClock` and `@byStay`. A later `@ref` to a row a `@skip` left out fails.

Every table that keeps totals is settled once all the sample rows are in, so a sample
visit's balance is right from the start. The totals so far are also settled before each table's
rows go in, so a row that copies a total from an earlier table (a stage invoice copying its quote's
subtotal) reads it worked out.

A row may also carry `"@onlyIfEmpty": true`, for a table that holds one row, such as the app's own
settings. The row is added only when the table is empty. When the operator already has a row there,
the sample leaves theirs alone, and a `@ref` to the sample row's label points at theirs.

Add `"@fillEmpty": true` beside it when the row that is already there should still take the
sample's values: a settings row the install wrote with its defaults ([`seeds`](https://docs.adminium.dev/reference/manifest/#seeds-and-widgets))
gets the sample's depot name and address in the columns it holds nothing in. A column that holds a
value is never written over. "Remove sample data" empties those columns again where nobody
changed them since, and leaves the row.

A table of many rows the operator sets up themselves (a kitchen's opening hours, one row a
weekday) takes `"onlyIfEmpty": true` on the table instead: its rows go in only when the table holds
none, and otherwise all of them stay out. No row may `@ref` a row of such a table, since it may not
be written.

Adminium keeps track of the rows it added in a ledger table named `<key>_sample_data` (with `-` in
the key written as `_`), so avoid a table of that name.
