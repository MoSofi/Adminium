<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

A file somebody brings in is different: each line is their own create or their own change. A
stamp is written into a column the line leaves out or leaves empty, as it would be for a save
(`now` is the moment of the import, `user-id` and `user-name` are the person who brought the
file, a `byOrigin` column gets its `staff` value). So a role that may not write `received_at`
still brings a list of enquiries in, and each row says when it arrived. A value the line does
carry is kept, where a save would lose it to the stamp: the day an old enquiry really came is
the file's to say. Whether the person may say it is their role's create limit, which refuses a
file that carries a column they may not give a new row. A line that changes a stored row (an
import that updates the rows it matches) fires the stamps a change by hand would, against the
row as stored: moving a status stamps its moment once, and the same file brought in again
stamps nothing. A stamped column takes
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
