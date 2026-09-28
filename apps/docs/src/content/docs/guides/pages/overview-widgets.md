---
title: Cards for an overview page
description: What an overview page's cards can ask for beyond a plain count — filters joined by or and and, a day on the venue's calendar, rankings and paired bars, the hours of the day, figures over a table's limit, lists with what each row has sold — and how they are drawn, translated, kept and checked.
---

An overview page is a `page-dashboard`: a grid of cards. Each card is a widget with a `binding`,
a query the server answers as the person looking, with their roles, their masks and the venue's
clock. A hotel's front page has "Occupancy tonight", "Arriving today" and "Out of service"; a box
office has its coming shows, each with a bar of what it has sold.

This page covers what a binding can ask beyond "count the rows", and what the cards do with the
answer. Where a layout is written:

- **In an app**, under the page's `config.layout` in the manifest (see
  [Pages](/reference/manifest/#pages)). A binding names the app's tables by their short refs and
  names no connection: the install binds `source.name`, and a list's `counts.table`, to the real
  tables.
- **In a project**, under `config.layout` in a [page file](/projects/page-files/). A binding names
  its database by key (`"database": "main"`) and its table by its real name.

A layout item is `{ "i", "widget", "x", "y", "w", "h", "config" }` on a 12-column grid, with the
query in `config.binding`. The cards on this page are `kpi-stat-card`, `chart-bar` and
`mini-table`; the [examples](#three-overviews) at the end are whole items.

## Filters joined by or and and

A binding's `filters` is a list, and every entry must hold. An entry may also be a group:
`{ "or": [ … ] }` or `{ "and": [ … ] }`. Rooms out of service are *active*, and *end today or
later, or have no end*:

```json
"filters": [
  { "column": "active", "op": "eq", "value": true },
  { "or": [
    { "column": "to_date", "op": "gte", "day": "today" },
    { "column": "to_date", "op": "is_null" }
  ] }
]
```

| Rule | |
|---|---|
| Depth | A group may hold conditions and groups; a group inside a group holds conditions only. Two levels, no more. |
| Size | At most 16 conditions in all, however they are grouped, and at most 16 entries in each list. A group is never empty. |
| An unset `param` | A condition whose `param` the page has not set filters nothing. Inside an `and` it drops out; inside an `or` it keeps every row, because "any reason, or no end" is every row. |
| A column one link away | `order_id.status`: the status of the order each line belongs to, inside a group or outside one. |

A column one link away is `<foreign key>.<column>`, one link only. It is read as a lookup is: the
reader must be able to read the table it reaches, and see the column. Where a lookup the reader may
not read shows an empty cell, a filter cannot quietly drop out, since the card would count rows the
page means to leave out. So the card is refused, with `403` `TABLE_FORBIDDEN` or `403`
`COLUMN_FORBIDDEN`. A row whose key is empty matches no such filter. A `window` may name a column
one link away too.

## A day instead of a value

A condition may carry `day` in place of `value`: a day on the venue's calendar, worked out by the
server when the card is read.

| `day` | Means |
|---|---|
| `today` | Today where the venue is, not where the server is. |
| `today+7`, `today-30` | Whole days from today, at most 3,660 either way. |
| `2026-07-28` | That day. It must be a real one. |

The operators are `eq`, `neq`, `gt`, `gte`, `lt` and `lte`, on a date or time column. On a
**date** column the day is compared as it is. On a **time** column a day is a span, the venue's
whole day: `eq today` keeps rows from the venue's midnight to the next one, `lte today` runs to
tomorrow's midnight, and `gt today` starts there. For that reason `neq` takes a date column only.

A condition has a `day` or a `value` (or a `param`), never two of them, and a day is never used
with `in`, `like` or `between`. Each of these is refused with `422` `VALIDATION_FAILED`, `details`
naming the `column`, and the `op` and `day` where they are the problem.

A link into a records page takes the same days: see "Links that open a list filtered" under
[Pages](/reference/manifest/#pages).

## Rankings and paired bars

A `categorical` binding groups rows and gives each group a figure. With two or more aggregations,
each item also carries all of them under `values`, and the answer lists their aliases in
`aggregates`. A `chart-bar` draws them as paired bars: received and still owed, by show.

```json
"binding": {
  "source": { "name": "bookings" },
  "shape": "categorical",
  "groupBy": ["event_id"],
  "groupLabel": "event_id.name",
  "aggregations": [
    { "fn": "sum", "column": "received", "alias": "received" },
    { "fn": "sum", "column": "owed", "alias": "owed" }
  ],
  "orderBy": [{ "column": "event_id.doors_at", "dir": "asc" }]
}
```

Each item of the answer carries both figures:

```json
{ "items": [{ "key": "3", "label": "Paper Moons", "value": 1920, "values": { "received": 1920, "owed": 0 } }],
  "aggregates": ["received", "owed"] }
```

`value` is the first aggregation's figure. The card names the bars in its `series`, one per
aggregation in order, each with a `label` and, if you like, `labels` in other languages. Unnamed,
a bar is called by its alias.

**The order.** Without `orderBy`, the biggest first figure comes first. A ranking's `orderBy` may
name:

- an aggregation's alias (`owed`), so the second figure of a pair can lead;
- the column it groups by (`event_id`);
- a column of the row the group points at, `event_id.doors_at`: the shows in date order. It is
  read-checked as a filter one link away is. A path through any other foreign key is refused with
  `422`: it has no one value per group.

Ties fall to the group's label, then its key, so the rows a `limit` keeps are the same on every
engine and every read. A group with no label comes after the labelled ones. A figure over nothing
but empty values, and a group with no date to order by, come **last** on every database, whichever
way the order runs.

:::note[Upgrading]
On Postgres an empty figure used to rank first in a biggest-first chart. It now ranks last, as it
always did on MySQL and SQLite.
:::

## The hours of the day

A bucket of `"unit": "hour-of-day"` folds every day into its hours on the venue's clock: a week of
pickups between 11:00 and 20:00 is ten bars, one per hour, not seventy.

```json
"bucket": { "column": "pickup_at", "unit": "hour-of-day" },
"window": { "column": "pickup_at", "last": 1, "unit": "week", "calendar": true }
```

The `window` picks which days are folded. An hour with no rows has no bar. The hours are the
venue's, UTC where the connection names no time zone. It is a bucket only: a `window` in
`hour-of-day`, a date column, and an `ohlc` chart are refused with `422`.

## KPIs over a limit

A table with a [limit](/reference/manifest/#capacity) knows what is taken of each pool. A binding
of `"kind": "capacity-counts"` reads those counts, the ones the desk's
[counts route](/reference/rest-api/#a-limits-counts) answers, and a KPI card shows one figure over
them:

```json
"binding": {
  "kind": "capacity-counts",
  "source": { "name": "stays" },
  "shape": "metric+delta",
  "capacity": { "metric": "occupancy" }
}
```

`source` is the limited table. `capacity` says which limit and what to show:

| Field | Rule |
|---|---|
| `rule` | Which of the table's limits, `0` to `2`. Default `0`. |
| `metric` | The figure, for `single-metric` and `metric+delta` only. See below. Default `taken`. |
| `param` | The page param that names the day. Default `day`, the page's day control. |
| `date` | A fixed day, `YYYY-MM-DD`, when the page sets no param. |
| `under`, `value` | A [parent limit](/reference/manifest/#parent-limits)'s pools whose column `under` holds `value`: the ticket types of one show. |
| `ids` | Up to 200 pools by key. |
| `label` | A column of the pools' rows a pool is called by; their display column otherwise. |

| `metric` | The figure |
|---|---|
| `taken` | What is taken, holds included, over every pool and day counted. |
| `held` | What checkouts still running hold. |
| `size` | What there is to take. |
| `left` | Size less taken. It can be less than nothing when a pool was made smaller after it sold. |
| `occupancy` | Taken over size: `0.66` is 66 %, and more than `1` when over-sold. No figure when the size is 0 or unknown, such as every room out of service. |
| `earnings` | What the rows sold earn on the nights counted, each night at its own rate. See below. |

**The day.** A [slot limit](/reference/manifest/#slot-limits) and a
[night limit](/reference/manifest/#night-limits) count the day the page's day control names,
else `date`, else today on the venue's clock. The control's *This week* is seven days from Monday,
added up. A parent limit that counts by day takes one day only and refuses a week; one that does
not count by day ignores the day.

**The delta.** `metric+delta` compares the span just before, of the same length: yesterday, last
night, the week before. A parent limit with no days has no span before, so its card shows the
figure alone.

**Earnings** are counted for a night limit on a table [priced by the night](/reference/manifest/#prices-by-the-night),
from the rows' own price at each night's rate, the lines the desk shows. A checkout still running
earns nothing yet. A table that keeps each row's own currency is refused with `422`
(`details.metric` and `details.column`): prices in several currencies do not add up to one amount.

**Who may read it.** The card reads as the counts route does. The reader must read the limited
table and every table its pools are kept in, and for earnings the rates' and adjustments' tables
(`403` `TABLE_FORBIDDEN`). A column asked `under`, and the price behind earnings, must be one the
reader sees, unmasked and among their role's columns (`403` `COLUMN_FORBIDDEN`). A table with no
limit answers `404` `NOT_FOUND`.

The same binding can be answered as `categorical` (a bar per slot, day or pool, valued by what is
taken) or `record-list` (a row per slot, day or pool). It is a count, not a query: `select`,
`filters`, `window`, `orderBy`, `groupBy`, `bucket` and the other query parts are refused by name,
and so is a `metric` on a list or a chart.

## Lists with what a limit has taken

A `record-list` binding may carry `counts`: each row it lists gets what a table's limit has taken
from it, `{ "taken", "held", "size", "left" }`. The rows are filtered, ordered and limited like any
other list.

```json
"counts": { "table": "tickets", "as": "sold" }
```

| Field | Rule |
|---|---|
| `table` | The limited table. In a manifest, its short ref. |
| `rule` | Which of its limits, `0` to `2`. Default `0`. |
| `as` | The key the counts go under, a plain name. Default `counts`. The list may not already have it. |
| `param`, `date` | The day, as for a KPI: the day control, else `date`, else today. |

The rows must be what the limit counts:

- the limit's pools, such as the ticket types of a parent limit on `tickets`;
- a pool the limit also takes from, such as the shows of its `also`;
- a night limit's pools, the room types, tonight.

The list must select the key the counts are matched by, usually `id`. A slot limit counts slots,
not rows, and is refused. Where the limit counts by day or night, the counts are for one day:
*This week* is refused. They are counted from the staff's side, so a place kept back for a waitlist
is not taken. A row whose key the reader cannot see gets no counts. The reader must read the
limited table and the pools' tables, as for a KPI.

**The bar.** The answer marks the counts column `capacity-bar`. In a `mini-table`, a column with
`"semantic": "capacity-bar"` draws the places sold, then the places held (striped), out of the
size, with "391 / 414" beside it. More taken than the size fills the bar in the danger tone, and a
screen reader hears "420 of 414 taken, 6 over". A row with no size shows only what is taken. The
bar also reads a limit's own counts listed (`capacity-counts` as `record-list`), from each row's
`taken`, `held` and `size`.

A card that lists its own `columns` must give the counts column that semantic itself. A card with
no `columns` takes the answer's, bar included.

## Two-line rows

A `mini-table`'s `secondary` names one to three columns drawn as a second, quieter line under the
first column, joined by " · ": "Loft suite · Tue 28 Jul" under the guest's name. Those columns
leave the first line. An empty value is left out of the second line.

```json
"secondary": ["room_type", "depart"]
```

## A chart's figures as a table

Every chart and map card also carries its figures as a table: hidden from sight, read by a screen
reader, captioned with the card's title and subtitle. Its **Show data** button swaps the chart for
that table in place, and back. The figures are formatted as the card formats its own, a money
card's in its currency, and periods as the axis reads them. A pair has a column per figure, named
by the card's `series`. There is no table, and no button, while the card loads or when it has
nothing to draw.

## Words in the reader's language

A card's words may come in other languages, keyed by language tag like `titles`:

| Field | Translates |
|---|---|
| `titles` | `title` |
| `subtitles` | `subtitle` |
| `metricLabels` | `metricLabel`, the caption on a KPI card |
| `emptyState.titles`, `emptyState.bodies` | What an empty card says |
| `series[].labels` | A chart's bar names |

The reader's language picks one: the same tag, else any tag of the same language (a `fr-FR` word
serves a reader in `fr-CA`), else the word it translates stands. Each is 1–240 characters (a title
1–120, a bar name 1–80).

A KPI with no figure (occupancy when there is nothing to sell) shows the card's empty state, never
a zero. A figure of zero is shown as 0.

## KPI icons

A `kpi-stat-card`'s `iconName` is one of a fixed set. Besides the general ones, a hotel and a box
office have: `bed-double`, `log-in`, `log-out`, `wallet`, `calendar-x`, `ticket`, `door-open`,
`landmark` and `undo-2`.

## How long an answer is kept

An answer is kept for 30 seconds. It is kept apart for each reader's roles, whether they see
personal data, the columns their roles read, their language, and the venue's day, so "today" moves
at the venue's midnight, never 30 seconds after it.

A write through Adminium drops it sooner: a write to the card's own table, and, for a KPI over a
limit or a list with counts, a write to any table the limit reads (the pools, the rooms and their
closures, the orders a hold is read through, the settings a size comes from). A card filtered or
ordered through another table's column, and any change made to the database outside Adminium,
shows within the 30 seconds.

## What the install checks

When an app is installed or updated, its layout is checked before anything is written. A card whose
filters break the rules above (a group too deep, more than 16 conditions, a day that is not one, a
day with a value or with `in`, a day on a column the manifest declares as neither `date` nor
`timestamptz`, `neq` on a `timestamptz`), `counts` that are not well formed or sit beside anything
but a list, or a `metric` that is not one, refuses the install with `PAGE_FORM_INVALID`: "The page
"hotel-overview": the card over "room_blocks" has filters no card can read: …". The filter rules
are the ones every read applies, so an install never passes a card that every read refuses.

The rest is judged when the card is read: whether a list's rows are the limit's pools, whether a
table is priced by the night, a column one link away. A card that fails shows its error and a
Retry; the other cards keep working. A project's page files are judged when they are read.

## Three overviews

**Online ordering.** Pickups booked into today's slots, from the slot limit on `orders`, and the
week's pickups by hour.

```json
[
  { "i": "pickups-today", "widget": "kpi-stat-card", "x": 0, "y": 0, "w": 4, "h": 3,
    "config": {
      "title": "Pickups today",
      "titles": { "de-DE": "Abholungen heute" },
      "iconName": "package",
      "binding": { "kind": "capacity-counts", "source": { "name": "orders" }, "shape": "single-metric",
                   "capacity": { "metric": "taken" } } } },
  { "i": "pickup-hours", "widget": "chart-bar", "x": 4, "y": 0, "w": 8, "h": 6,
    "config": {
      "title": "Pickups by hour",
      "subtitle": "This week",
      "subtitles": { "de-DE": "Diese Woche" },
      "binding": { "source": { "name": "orders" }, "shape": "timeseries",
                   "aggregations": [{ "fn": "count", "alias": "pickups" }],
                   "bucket": { "column": "pickup_at", "unit": "hour-of-day" },
                   "filters": [{ "column": "status", "op": "neq", "value": "cancelled" }],
                   "window": { "column": "pickup_at", "last": 1, "unit": "week", "calendar": true } } } }
]
```

**A hotel.** How full the house is tonight against last night, and the rooms out of service today
or later.

```json
[
  { "i": "occupancy-tonight", "widget": "kpi-stat-card", "x": 0, "y": 0, "w": 4, "h": 3,
    "config": {
      "title": "Occupancy tonight",
      "titles": { "de-DE": "Belegung heute Nacht" },
      "metricFormat": "percent",
      "iconName": "bed-double",
      "emptyState": { "titleKey": "No rooms to sell tonight",
                      "titles": { "de-DE": "Heute Nacht keine Zimmer im Verkauf" } },
      "binding": { "kind": "capacity-counts", "source": { "name": "stays" }, "shape": "metric+delta",
                   "capacity": { "metric": "occupancy" } } } },
  { "i": "out-of-service", "widget": "mini-table", "x": 4, "y": 0, "w": 8, "h": 6,
    "config": {
      "title": "Out of service today or later",
      "columns": [{ "name": "room", "label": "Room" }, { "name": "to_date", "label": "Until", "logicalType": "date" }],
      "secondary": ["reason"],
      "emptyState": { "titleKey": "Every room is in service" },
      "binding": { "source": { "name": "room_blocks" }, "shape": "record-list",
                   "select": ["id", "reason", "to_date"],
                   "lookups": ["room:room_id.number"],
                   "filters": [
                     { "column": "active", "op": "eq", "value": true },
                     { "or": [{ "column": "to_date", "op": "gte", "day": "today" },
                              { "column": "to_date", "op": "is_null" }] }
                   ],
                   "orderBy": [{ "column": "from_date", "dir": "asc" }],
                   "limit": 5 } } }
]
```

**Event ticketing.** The coming shows in date order, each with a bar of its tickets sold and held
of what it can sell. `tickets` has a parent limit on its ticket type that also takes from the show.

```json
{ "i": "coming-shows", "widget": "mini-table", "x": 0, "y": 0, "w": 6, "h": 6,
  "config": {
    "title": "Coming shows",
    "titles": { "fr-FR": "Prochains concerts" },
    "columns": [{ "name": "name", "label": "Show" }, { "name": "sold", "label": "Sold", "semantic": "capacity-bar" }],
    "secondary": ["doors_at"],
    "binding": { "source": { "name": "events" }, "shape": "record-list",
                 "select": ["id", "name", "doors_at"],
                 "filters": [{ "column": "doors_at", "op": "gte", "day": "today" }],
                 "orderBy": [{ "column": "doors_at", "dir": "asc" }],
                 "limit": 5,
                 "counts": { "table": "tickets", "as": "sold" } } } }
```

## Refusals

A card's refusal is its own: in a batch, the other cards are answered. Codes are listed in the
[error reference](/reference/errors/).

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Filters: a group too deep or empty, more than 16 conditions, a day that breaks its rules. A ranking ordered through another link. `hour-of-day` as a window or on a date column. `counts` beside anything but a list, over rows that are not the limit's pools, on a slot limit, on a table with no limit, without the key selected, or under a name the list has. A `capacity-counts` binding with query parts or a `metric` on a list or a chart, `earnings` off a night limit priced by the night or over rows with their own currency, a limit number the table does not have, a week where the counts take one day. |
| `TABLE_FORBIDDEN` | 403 | The reader may not read the card's table, a table a filter or an order reaches, the limited table, a pools' table, or the rates behind earnings. |
| `COLUMN_FORBIDDEN` | 403 | A column one link away, a column asked `under`, or the price behind earnings is masked for the reader or outside their role's columns. |
| `NOT_FOUND` | 404 | A `capacity-counts` binding over a table with no limit. |

For the rules a limit counts by, see [Capacity](/reference/manifest/#capacity); for a booking that
takes a person's time rather than a seat, see [Booking rules](/guides/apps/booking-rules/).
