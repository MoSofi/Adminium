<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

```json
{ "ref": "checked_in_at", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["checked_in"] } } } }
```

| Field | Rule |
|---|---|
| `set` | What is written; see the table below. |
| `on` | When: `"create"`; `{ "column", "values" }`, another column of the table and 1–16 values it must change to; `{ "column", "filled": true }`, the moment another column, a nullable one, is first filled; `{ "columns": [...] }`, whenever one of 1–8 other columns changes (a create sets them all); or a list of 2–3 of these, any of which writes the stamp. |
| `clearOnBack` | `true`: emptied again when a move marked [`undo`](https://docs.adminium.dev/reference/manifest/#undo-of-a-move) takes the row back out of a state the stamp watches (the time an order was marked ready, when the kitchen undoes the Ready). The column is nullable, the stamp watches the table's state column, and some `undo` move leaves one of the states it watches. |

What a stamp writes:

| `set` | Writes | Column |
|---|---|---|
| `"now"` | The moment. | `timestamptz` |
| `"today"` | Today's date on the venue's calendar. | `date` |
| `"user-name"`, `"user-id"` | Who made the write. | `text` |
| `{ "byOrigin": { "public", "staff"? } }` | One value for a write through the public API and another for everyone else. With no `staff`, a staff write keeps the value its writer chose (a desk records how a client approved; the portal always says "portal"). Each value must fit the column. | `text` or `enum` |
| `{ "copy": column }` | Another column of the same row, as it stands at that moment: a client's first answer, kept when they edit it later. Both columns have the same type. | any |
| `{ "claim": column, "staff"? }` | A column of the signed-in person's own row (their email, their name), on a public write. `column` is a column of a table the app's people sign in as (an entry with a [`claim`](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows)). `staff` is `"user-name"` or `"user-id"`: what a staff write stamps instead. | `text` |
| `{ "addDays": { "date", "days", "map"? } }` | A date so many days after `date`, a `date` or `timestamptz` column of the row: a due date from the issue date and the terms. `days` is a number (0–3650) or a column: an `int`, or an enum or text column with `map` giving each of its values its days. | `date` |
| `{ "hashOf": { "columns", "children"?, "linked"? } }` | A fingerprint: SHA-256 over the named columns, child rows and linked rows, in a canonical form anyone can recompute. | `text` of at least 64 characters |
| `{ "addMinutes": { "minutes" or "hours", "notAfter"? } }` | The moment so many minutes or hours from now: a hold for ten minutes, an offer open for a day. The amount is a number or a whole-number setting. `notAfter` is a [moment](https://docs.adminium.dev/reference/manifest/#moments) it never passes (an offer ends at the doors at the latest); a missing moment caps nothing. | `timestamptz` |
| `{ "deadline": { "days", "time", "notAfter"? } }` | `days` after today on the venue's calendar, at `time` (`"HH:MM"` or a text setting), but never later than `notAfter`: a transfer due in five days at 18:00, or three days before the show. | `timestamptz` |
| `{ "moment": <moment> }` | A [moment](https://docs.adminium.dev/reference/manifest/#moments) of the row or a linked row, worked out whenever the stamp fires: a stay's cancel-by, from its arrival. Read from other columns, never its own. A moment that cannot be found writes nothing. | `timestamptz` |

`hashOf` takes 1–24 of the row's own `columns`; up to 4 `children`, each
`{ "table", "via", "columns", "orderBy"? }`, a child table whose foreign key `via` points at this
table, read in `orderBy` order and then by key; and up to 4 `linked`, each
`{ "via", "table", "columns", "children"? }`, the row this table's foreign key `via` points at, with
its own children.

```json
{ "ref": "due_on", "type": "date", "nullable": true,
  "rules": { "stamp": {
    "set": { "addDays": { "date": "issued_on", "days": "terms",
                          "map": { "net7": 7, "net14": 14, "net30": 30, "on-receipt": 0 } } },
    "on": { "column": "status", "values": ["sent"] } } } }
```

A change is judged against the stored row, so sending a status the row already holds stamps
nothing again. A create that already holds one of the values (a walk-in written as checked in)
is stamped too. A stamp wins over a value the writer sent. Between its moments a stamped column
is Adminium's, and a value a writer sends there is dropped, with two exceptions for staff: an
`addDays` date (the desk may still move a due date) and a `byOrigin` column with no `staff`
value. A `byOrigin` value that is itself `now`, `today`, `user-name` or `user-id` writes what that
stamp would.

A public write stamps like any other write, except `user-name` and `user-id`: a browser key is
nobody, so they write nothing. What it knows of the person is their own signed-in row, which is
what `claim` reads. For an automation, `user-name` is the rule's name. Imports, sample data and
undo stamp nothing, since a stamp of today's time over history would be false; an import keeps
the stamped values it brings. A stamped column takes
no `copy`, `default`, `sequence`, `format`, `code`, `rollup`, `formula`, `lookup` or `perNight` as
well, and a stamp watches a column other than its own.

A stamp that works out a moment again whenever what it reads changes: a stay may be cancelled
free until 48 hours before 15:00 on its arrival day, and moving the arrival moves the deadline.

```json
{ "ref": "cancel_by", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": {
    "set": { "moment": { "column": "arrive", "time": { "table": "settings", "column": "arrive_from" },
                         "minus": { "hours": { "table": "settings", "column": "cancel_hours" } } } },
    "on": { "columns": ["arrive"] } } } }
```

An offer that lasts as many hours as the settings row says, but never past the show's doors:

```json
{ "ref": "offer_until", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": {
    "set": { "addMinutes": { "hours": { "table": "settings", "column": "offer_hours" },
                             "notAfter": { "column": "doors_at", "via": "event_id" } } },
    "on": { "column": "status", "values": ["offered"] } } } }
```
