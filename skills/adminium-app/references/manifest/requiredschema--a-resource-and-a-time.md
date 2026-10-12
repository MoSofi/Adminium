<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — A resource and a time; do not edit -->

# Manifest spec: requiredSchema — A resource and a time

### A resource and a time

`occupies` is the plain rule beside [Booking](https://docs.adminium.dev/reference/manifest/#booking): a row takes a resource for a time, and no
two counted rows of one resource overlap. A showroom bay booked from two to three is not booked
again at half past two; a demo van is out once a day. It has no kinds of visit, nobody to pick, no
grid and no window. Use `booking` when people are booked for visits, and `occupies` for everything
else that can be taken twice by mistake. Needs Adminium 0.3.27.

```json
"occupies": {
  "resource": "space_id", "start": "starts_at", "minutes": "minutes",
  "countWhere": { "column": "state", "values": ["tentative", "confirmed"] },
  "hours": { "table": "space_days", "resource": "space_id", "weekday": "weekday",
             "opens": "opens", "closes": "closes" }
}
```

| Field | Required | Rule |
|---|---|---|
| `resource` | yes | What is taken: a column of the table, usually a foreign key. |
| `start` | one of `start`, `day` | A `timestamptz` column: when the row starts, read in the venue's time zone. Comes with `minutes` or `end`, one of the two. |
| `minutes` | with `start` | An `int` column: how long the row lasts. |
| `end` | with `start` | A `timestamptz` column: when the row ends. It must be after the start. |
| `day` | one of `start`, `day` | A `date` column: the row takes the whole day. Takes no `minutes` and no `end`. |
| `countWhere` | no | `{ "column", "values" }`: only rows whose column holds one of these values take the resource (a cancelled booking takes nothing). Without it every row counts. |
| `hours` | no | The resource's week: `{ "table", "resource", "weekday", "opens"?, "closes"? }`, a table of the app with one row per weekday the resource works. `resource` names what the row's `resource` names; `weekday` is an enum of exactly `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`, in that order. `opens` and `closes` are `text` columns holding `HH:MM`, both or neither. |
| `shared` | no | `true`: rows may share the resource's time, and only its `hours` are judged (a crew does several jobs on a day it works, and none on its day off). Needs `hours`. |

A row with no resource, or no time yet, takes nothing and is not judged: a visit can wait for its
day. A row that ends as another starts does not overlap it. A timed row may run past midnight and
lasts 30 days at most.

With `hours`, a weekday the resource has no row for is a day it does not work. A timed row must
also lie inside the weekday's `opens` and `closes`, when the rule names them. A resource with no
rows in the table at all keeps no week and is held to none, so a crew made a minute ago can be
booked before its days are written down.

A write that overlaps is refused with `BOOKING_TAKEN` (409), one on a day the resource does not
work with `BOOKING_CLOSED` (409), one outside the opening times with `BOOKING_OUT_OF_HOURS` and one
whose time cannot be read or is too long with `BOOKING_OUT_OF_RANGE` (both 422). The public API
answers as it does for a booking. Two writers of one resource take turns, so two requests for the
same hour cannot both win. As on a booking table, rows are written one at a time: a batch of
new rows, or a batch change that could move a row's time or resource, is refused.
