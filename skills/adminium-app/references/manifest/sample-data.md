<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Sample data; do not edit -->

# Manifest spec: Sample data

`sampleData` points at a file of demo rows inside the package:

```json
"sampleData": { "file": "seeds/visits.sample.json" }
```

The file must be in `seeds/` and end in `.json`. `skipWhenShared` (`{ "table", "skip": [1–50
table refs] }`) leaves the listed tables' sample rows out when `table` is a [shared
table](https://docs.adminium.dev/reference/manifest/#shared-tables) another installed app uses and it already holds real rows (rows no app's
sample added): a venue's real menu never gains sample dishes, nor sample orders of them. The list
must include every table that links to a skipped one. After installing, the operator can add the
sample data in one step and later remove it. Removal shows a preview first. It keeps every sample row the
operator's own records still point at and, if they choose, the rows they have changed since.

The file uses the `adminium.sample/1` format:

```json
{
  "format": "adminium.sample/1",
  "app": "visits",
  "tables": [
    { "ref": "clients", "rows": [{ "@label": "ada", "name": "Ada Byrne" }] },
    { "ref": "visits", "rows": [
      { "client_id": { "@ref": "ada" }, "starts_at": { "@day": 1, "@time": "09:30" },
        "note": { "@t": { "en-US": "First visit", "de-DE": "Erster Besuch" } } }
    ] }
  ]
}
```

| Field | Rule |
|---|---|
| `format` | Always `"adminium.sample/1"`. |
| `app` | The app's `key`. |
| `tables` | At least one `{ "ref", "rows" }`, each with 1–5000 rows, written in the order listed (parents first) and removed in reverse. Every `ref` and column must be declared in `requiredSchema`. |
| `assets` | Optional files for `@asset`: an object from a label to `{ "file": "seeds/…", "sha256": "<64 hex>" }`. |
| `weekAnchor` | Optional: the weekday (`mon` … `sun`) the sample was written for, which `@week` days count from. |

A row may carry an `@label` (letters, digits and `: . _ -`, unique in the file) so a later row can
point at it.

A column numbered [without gaps](https://docs.adminium.dev/reference/manifest/#numbers-without-gaps) is spelled `null` in every sample row
(`"number_seq": null`); its `format` text is whatever the row gives (its own spelling, such as
`INV-S2041`), or empty. A sample row then
stays off the real series: the first real invoice is still number one. Adding the sample is
refused when a row leaves a gapless column out or gives it a number.

A value is plain JSON, or one of these directives:

| Directive | Value |
|---|---|
| `{ "@ref": "<label>" }` | The key of an earlier row with that label. |
| `{ "@ago": "PT19M" }` | An ISO 8601 duration before now. |
| `{ "@in": "PT20M", "@grid": 15 }` | An ISO 8601 duration after now. With `@grid`, rounded up to the next step of that many minutes on the venue's own clock, counted from its midnight (never past the next midnight): the first pickup slot at least 20 minutes away. |
| `{ "@in": "PT20M", "@slot": "orders" }` | The first open time of that table's [slot limit](https://docs.adminium.dev/reference/manifest/#slot-limits) at least that far ahead: its hours, closures and pauses, on its grid, with room left after the sample's own rows placed so far; on the next open day when today has none, looking two weeks ahead, else the plain `@in` time. Not with `@grid`. |
| `{ "@day": -1, "@time": "09:30" }` | A wall time in the venue's time zone, a number of days from today (−366 to 366). |
| `{ "@day": 3 }` | A date: that many days from today, as the venue's calendar has it. For a `date` column. |
| `"@workdays": true` | Added to either `@day` form: the days count Monday to Friday only, and day 0 on a weekend is the Monday after. So the sample's busy day is never a Saturday. |
| `"@week": true` | Added to either `@day` form instead: the days count from the bundle's `weekAnchor` in the week nearest today (three days either way), so every date keeps the weekday it was written for: a weekend stay stays on a weekend, whatever day the sample is added on. Needs `weekAnchor`. |
| `{"@month": -2, "@dom": 14}` | A date in the venue's time zone: that day of the month, so many months back (`0` is this month). Add `"@time": "10:00"` for a time on that day. A day past the month's end is its last day, and a day that has not come yet is today (a time not yet come, now). Use it for history counted in calendar months: "this month" and "in May" read the same whether the sample is added on the 3rd or the 28th. |
| `{ "@t": { "en-US": "…" } }` | Text in the language of the person adding the sample. Keys are `xx` or `xx-XX`. |
| `{ "@asset": "<label>" }` | A file from `assets`, added to the Files library. |

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

A table of many rows the operator sets up themselves (a kitchen's opening hours, one row a
weekday) takes `"onlyIfEmpty": true` on the table instead: its rows go in only when the table holds
none, and otherwise all of them stay out. No row may `@ref` a row of such a table, since it may not
be written.

Adminium keeps track of the rows it added in a ledger table named `<key>_sample_data` (with `-` in
the key written as `_`), so avoid a table of that name.
