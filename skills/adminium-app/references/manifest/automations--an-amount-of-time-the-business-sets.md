<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — An amount of time the business sets; do not edit -->

# Manifest spec: Automations — An amount of time the business sets

### An amount of time the business sets

A relative condition (`within_next`, `within_last`, `more_than_ago`, `more_than_ahead`) may read its
amount from a whole-number column of the app's settings row (the row of that table with the
lowest key):

```json
{ "left": { "field": "last_activity_at" }, "op": "more_than_ago",
  "right": { "amount": 7, "unit": "days", "setting": { "table": "settings", "column": "nudge_quiet_days" } } }
```

"Quiet for more than `settings.nudge_quiet_days` days": the number is read at each tick of a
rule by the clock (in `forEach.where`) and as a run reaches a condition step, so a change on the
app's Settings screen counts from the next tick. `amount` is the number used while the setting holds
none from 1 to 3650 (empty, 0, a text). A trigger's own `when`, a summary's sections and a count do
not read settings; the validator refuses one there, and a column that is not a whole number.
Which rows a rule visits tells what the number is, so it is read like any other table a rule
reads: a secret or personal column, and a [private](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) table, are refused (as is a
private table whose rows a condition counts), and somebody who saves such a rule in the dashboard
must read the table the number is kept in. A run reads it as a rule reads the connection: a table
made private since holds nothing, and `amount` is used. Needs Adminium 0.3.28.
