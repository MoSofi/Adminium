<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — A value from the settings row, and a day so many days on; do not edit -->

# Manifest spec: Automations — A value from the settings row, and a day so many days on

### A value from the settings row, and a day so many days on

A value a `record.create` or `record.update` step writes may be read from the app's settings row,
or be a day so many days after a date of the record. An aftercare call 28 days after a job is
signed off, owned by the person the business names on its Settings screen:

```json
{ "kind": "record.create", "table": "follow_ups", "values": {
    "job_id": "{{record.job_id}}",
    "owner_id": { "setting": { "table": "settings", "column": "aftercare_owner_id" } },
    "due_at": { "daysAfter": { "column": "signed_at", "days": 28,
                               "setting": { "table": "settings", "column": "aftercare_days" }, "at": "09:00" } },
    "kind": "aftercare", "text": "Aftercare call" } }
```

| Value | What it writes |
|---|---|
| `{ "setting": { "table", "column" } }` | What that column of the settings row (the row of that table with the lowest key) holds when the step runs. Into a staff column, from a staff column only, and only somebody who signs in: a setting that names nobody, somebody since removed or suspended, leaves the value empty, and the run's log says so. Any other column takes it from a column of its own type. |
| `{ "daysAfter": { "column" or "now", "days", "setting"?, "at"? } }` | A day `days` (0–3650) after a `date` or `timestamptz` column of the rule's record, or after the run (`"now": true`), counted on the business's calendar (the connection's time zone). `setting`: a whole-number column of the settings row whose number is used while it holds one from 1 to 3650 (else `days`: an empty setting or a 0 is none). Written into a `date` column as the day; into a `timestamptz` column at `at` (`"HH:MM"`) on the business's clock, else at the wall time it counts from (midnight for a date), so a call booked at 09:30 is due at 09:30 after the clocks change. A record whose date is empty leaves the value empty, and the log says so. |

A value is no way to read a table. The settings are read as a rule reads the connection, when the
step runs: a [private](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) table, a `secret` or a personal column are refused by the
validator and when a rule is saved, and a rule stored before holds nothing from one; so is a day
counted from a secret or personal date of the record, which it would tell. Somebody who
saves such a rule in the dashboard must read the table the setting is kept in. A clock with no rows
to visit has no record to count from: `"now": true` only. Both need Adminium 0.3.28
(`automations.settingValue`, `automations.daysAfter`).
