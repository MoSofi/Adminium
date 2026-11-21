<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Booking; do not edit -->

# Manifest spec: requiredSchema — Booking

### Booking

`booking` books a person's time rather than seats: each row takes a resource (a clinician) for its
own length, and two counted rows of one resource may never overlap. The time must also fall
inside that resource's hours, off their break, on the booking grid and outside any closure.
Capacity adds up a party per start time; booking forbids overlap per resource. They answer
different questions, so a table has one or the other, never both.

Every table the rule names is one of the app's own, by its short ref. A number can be literal or
read from the settings table as `{ "table", "column" }`, as in [Capacity](https://docs.adminium.dev/reference/manifest/#capacity). For how the
pieces fit together, see [Booking rules](https://docs.adminium.dev/guides/apps/booking-rules/).

```json
"booking": {
  "start": "starts_at", "minutes": "minutes", "resource": "clinician_id", "kind": "visit_type_id",
  "countWhere": { "column": "status", "values": ["booked", "checked_in", "seen"] },
  "eligible": { "table": "clinician_visit_types", "resource": "clinician_id", "kind": "visit_type_id",
                "order": { "table": "clinicians", "column": "position", "active": "active", "public": "online" } },
  "hours": {
    "practice": { "table": "opening_hours", "weekday": "weekday", "opens": "opens", "closes": "closes",
                  "breakStart": "break_start", "breakEnd": "break_end", "open": "open" },
    "own": { "table": "clinician_hours", "resource": "clinician_id", "weekday": "weekday",
             "opens": "opens", "closes": "closes" }
  },
  "closures": { "table": "closures", "from": "from_date", "to": "to_date", "resource": "clinician_id" },
  "grid": { "table": "settings", "column": "grid_minutes" },
  "windowDays": 60,
  "noticeMinutes": 120,
  "cancel": { "hours": 24, "mode": "flag", "flag": "late_cancel",
              "when": { "column": "status", "to": "cancelled" } }
}
```

| Field | Required | Rule |
|---|---|---|
| `start` | yes | A `timestamptz` column: when the row starts, read in the venue's time zone. |
| `minutes` | yes | An `int` column: how long the row lasts. Usually a `copy` from the kind. |
| `buffer` | no | An `int` column: minutes kept clear after the row, such as clean-up. It must be a `copy` from the kind with `"mode": "always"`. Two rows' times and buffers never overlap. Hours ask only of `minutes`, so a buffer may run past closing or into a break. Needs Adminium 0.3.71. |
| `resource` | yes | A foreign key: whose time the row takes. Left empty on a create, it means anyone: Adminium picks a free person, by `anyone` or else the first in `eligible.order`. |
| `kind` | yes | A foreign key: what the row is, which decides who may be booked for it. |
| `countWhere` | yes | `{ "column", "values" }`: only rows whose column holds one of these values take time (a cancelled visit takes none). Each value must fit the column. |
| `eligible` | yes | Who does what: `{ "table", "resource", "kind", "order"? }`, a link table whose two foreign keys point where the row's `resource` and `kind` point. A person with no link row for a kind is never booked for it. |
| `eligible.order` | no | `{ "table", "column", "active"?, "public"? }`, kept on the table `resource` points at. `column` is a number: the order in which "anyone" picks. A person whose `active` bool is false is never booked; one whose `public` bool is false is never booked through the public API. |
| `hours.practice` | yes | Weekly hours: `{ "table", "weekday", "opens", "closes", "breakStart"?, "breakEnd"?, "open"? }`, one row per weekday. `weekday` is an enum of exactly `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`, in that order. The times are `text` columns holding `HH:MM`. A break names both its start and its end. `open` is a bool. |
| `hours.own` | no | A person's own weekly hours, the same shape plus `resource`, a foreign key to the person. A person with rows here follows them every day, and a weekday with no row is a day off. A person with none follows the practice's hours. |
| `hours.own.within` | no | `"practice"`: the practice's hours cap the person's own. The later opening and the earlier closing apply, both breaks hold, and a day the practice is shut is shut. Without it, a person's own hours replace the practice's. Needs Adminium 0.3.71. |
| `closures` | no | Dated closures: `{ "table", "from", "to", "resource"?, "active"? }`. `from` and `to` are `date` columns. `resource` must be nullable: an empty one closes for everyone. `active` is a bool. |
| `busy` | no | Up to four tables of times a person is away: `{ "table", "resource", "start", "end", "countWhere"?, "engine"? }`. See below. Needs Adminium 0.3.71. |
| `anyone` | no | How "anyone" is given a person: `{ "pick", "made"?, "flag"? }`. See below. Without it, the first free person in the order. Needs Adminium 0.3.71. |
| `sync` | no | Bookings out to, and busy times in from, each person's connected calendar: `{ "when", "calendarName", "title", "detail"? }`. See below. Needs Adminium 0.3.71. |
| `grid` | yes | The minutes between bookable starts, counted from the opening time. At least 1. |
| `windowDays` | no | How many working days ahead a booking may be made. |
| `windowFor` | no | Who the window holds: `"everyone"` (the default) or `"guests"`, which leaves staff free to book further ahead. Needs Adminium 0.3.71. |
| `noticeMinutes` | no | How far ahead a public booking must be. Staff are never held to it. |
| `cancel` | no | Late cancellation: `{ "hours", "mode", "flag"?, "when" }`. See below. |

`cancel.when` is `{ "column", "to" }`: a cancellation is a change of the `countWhere` column to a
value that does not count. Inside `hours` of the start, `mode: "refuse"` turns a guest's
cancellation away, and `mode: "flag"` lets it through and sets `flag`, a bool column of the table,
whoever cancels. `flag` is required with `"flag"` and not allowed with `"refuse"`. A guest can never
move a booking, or change its person, inside the window, in either mode. Staff are never refused.

A `busy` source is a table of times a person is away, such as part-day time off. `resource` is a
foreign key to the person, and `start` and `end` are `timestamptz` columns, so one row may run for
days. A new time may not touch one, for staff or guests. A busy time never moves or refuses a
booking already there: a counted row that keeps its start and person is held only to any time it
newly takes. With `engine: { "account": <text column> }` the rows are Adminium's own, a connected
calendar's: the table must be `"private": true`, needs no `belongs`, and no person can write it.
One source at most may say `engine`.

`sync` needs a `busy` source with `engine`, and a resource table with
[`connectedAccounts`](https://docs.adminium.dev/reference/manifest/#tables). An event carries a title, a start, an end and the venue's zone, and
nothing else: no attendee, place, description or reminder, and the buffer stays out.
