<!-- produced from apps/docs/src/content/docs/guides/apps/working-days.md § When it is counted again; do not edit -->

# Ready-by dates in working days: When it is counted again

The stamp fires like any stamp: on a create, and whenever a column in its `on` list changes. In the
example, changing an order from standard to express moves its date.

A column has one stamp. To count again from the moment something happens (the proof approved),
count from `"now"` and give `on` a list of the moments that count, up to three:

```json
{ "ref": "ready_by", "type": "date", "nullable": true,
  "rules": { "stamp": {
    "set": { "addWorkingDays": { "from": "now", "days": "turnaround_days",
                                 "weekdays": "working_days", "cutoff": "cutoff",
                                 "closures": { "table": "closures", "from": "starts_on",
                                               "to": "ends_on", "active": "active" } } },
    "on": ["create",
           { "column": "proof_state", "values": ["approved"] },
           { "columns": ["turnaround_days"] }],
    "notEarlier": true } } }
```

A guest's value for the date is dropped: a customer cannot pick their own ready-by. Staff may move it
by hand, as with any stamp, until the stamp fires again.

### A date the customer was told never comes forward

Counting again can give an earlier date than the one the customer was told. A job promised for
Friday, approved on Monday with three working days to go, would move to Thursday. With
`"notEarlier": true` the column keeps the later of the date it holds and the new one: a later date
moves it on, an earlier one leaves it where it is. An empty column takes the new date. It works for
a `date` or a `timestamptz` column. Needs Adminium 0.3.53.

### Days a formula works out

`days` may name a formula column of the row, and `on` may watch one
(`{ "columns": ["turnaround_days"] }`): standard or express days, plus a day for each change the
customer asked for. The stamp is then worked out after the formulas, on a create and on a change.
When the formula reads a total of child rows (a count of the proofs sent back), adding, changing or
removing one of those rows counts the date again, as a change of the row itself would. An import of
history and an undo never do. Needs Adminium 0.3.44.
