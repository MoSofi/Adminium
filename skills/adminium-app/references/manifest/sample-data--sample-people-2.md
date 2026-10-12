<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Sample data — Sample people; do not edit -->

# Manifest spec: Sample data — Sample people

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
