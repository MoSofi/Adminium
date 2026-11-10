<!-- produced from apps/docs/src/content/docs/guides/apps/working-days.md § Declaring it; do not edit -->

# Ready-by dates in working days: Declaring it

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
  be a [formula](https://docs.adminium.dev/reference/manifest/#formulas) (see [Days a formula works out](https://docs.adminium.dev/guides/apps/working-days/#days-a-formula-works-out)).
- **`weekdays`** and **`cutoff`** name two of the app's own [settings](https://docs.adminium.dev/guides/apps/settings/), so the
  shop changes them on its settings page and no one edits the manifest. Either may instead be written
  in: `["mon", "tue", "wed", "thu", "fri"]`, `"14:00"`.
- **`closures`** is a table of the app: one row per closure, from one date to another, both
  included. An `active` column lets the shop switch a row off without deleting it.

The full rules for each field are in the [manifest reference](https://docs.adminium.dev/reference/manifest/#working-days).

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
closures table a link into that table, with [`addOnLink`](https://docs.adminium.dev/reference/manifest/#column-rules):

```json
{ "ref": "holiday_id", "type": "int", "nullable": true,
  "rules": { "addOnLink": { "addOn": "holiday-calendars", "table": "holidays" } } }
```

The app's own screen then offers "Add as a closure" beside a holiday: it writes a closures row with
the holiday's date as both ends and the link filled in. The add-on never writes the app's table.
The count reads only the closure's dates and `active`, so a closure made from a holiday counts like
one typed by hand. Maker Shop and Print Shop do this. See
[Add-ons with tables](https://docs.adminium.dev/guides/add-ons-with-tables/).
