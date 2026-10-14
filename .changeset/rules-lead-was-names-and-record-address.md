---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

Five words for a rule, each needing Adminium 0.3.28. A relative condition of a scan or a condition step may read its amount from the app's settings row: `"right": { "amount": 7, "unit": "days", "setting": { "table": "settings", "column": "nudge_quiet_days" } }` reads the number at each tick, and keeps 7 while the setting holds none. A notice may go to the lead of the person a staff column names, never to that person: `"to": { "column": "asked_by_id", "lead": true, "else": { "roles": ["admin"] } }` tells whoever leads a team she is in and can open the record, and the `else` roles when there is nobody. A rule run by a change reads its record as it was before it, `{{was.<column>}}`, in a notice, in a value it writes and in its e-mail; the row as it was is never shown in Workflow Logs and is dropped when the run ends. `{{<staff column>.name}}` is the name of the person a staff column names. A rule's e-mail to a person may carry `{{recordUrl}}`, the record's address, given only to somebody who can open it.
