<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — The people listed on the row; do not edit -->

# Manifest spec: Automations — The people listed on the row

### The people listed on the row

```json
{ "kind": "notification", "to": { "listed": "crew_members" }, "urgent": true,
  "title": { "en-US": "Your day sheet changed: {{record.what}} at {{record.start_time}}" } }
```

`listed` names a table that lists people against the rule's record: one of the record's table's
[`belongs` ways](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) reads `through` it (a deal's `deal_members`, a visit's crew
through `crew_members`, a deal's owner's `covers`). The step tells the people that listing names
for the record **when it runs**, each once; a dated listing (`from`, `to`) counts on the business's
day, so a cover that ended or has not begun names nobody. On an e-mail step, `"to": { "kind":
"listed", "table": "deal_members" }` sends one mail to each of them, in their own language, and may
carry [`{{recordUrl}}`](https://docs.adminium.dev/reference/manifest/#a-persons-name-and-the-records-address).

**Being listed is no right to be told.** Of the people listed, only those who sign in (not
suspended, not only invited, not a sample person) and whose own roles **open the record** at that
moment are told: they read its table, and the row is among the rows they reach. A fitter on a crew
whose role reads no visit, a marketer listed on a deal, a rep who has since lost her role, an
account manager whose role reads won deals only, listed on an open one: none of them hears. A
record that lists nobody, or nobody who may be told, is a line in the run's log, not a failure.
The validator refuses a table the record's ways do not read through, and a rule that runs for no
record. At most 100 people are told through one listing of one record; a listing that names more
fails the step by name. Needs Adminium 0.3.28.
