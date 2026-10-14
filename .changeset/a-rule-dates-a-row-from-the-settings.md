---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A rule's new row can take a value from the app's settings row and a day so many days on, a link can be held to the row written, and a rule's notices and mails carry only what each reader reads.

- A `record.create` or `record.update` value may be `{ "setting": { "table", "column" } }`, read from the settings row as the rule reads the connection (a private table, a secret or personal column are refused; a staff column is filled only with somebody who signs in, else left empty and said in the run's log), or `{ "daysAfter": { "column" or "now", "days", "setting"?, "at"? } }`, a day so many days on, on the business's calendar. Words `automations.settingValue` and `automations.daysAfter`, Adminium 0.3.28.
- `linkable.same` compares a column of the row a link names with a column of the row being written, or of the row a link of it names: a site visit's contact must work for the visit's deal's company. Judged also when a change moves the deal; refused `422` `not-allowed`, naming nothing of either row.
- A row an earlier step of a run made (`{{steps.<name>.<column>}}`) reaches each person told or mailed as that person reads it: nothing of it for somebody who does not read its table or reach the row, nothing of a column they are not shown.
- A mail to an address a column holds no longer fills the record's secret columns (by name, under `record.`, or written as a date or an amount). No mail carries a secret column.
