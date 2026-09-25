---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
---

A column can be required only for some values of another column of its row: `"requiredWhen": { "column": "kind", "in": ["away"] }` asks for `person_id` on an away event and not on one in the office. A create or an update that leaves the column empty while the other column holds one of the values is refused on every door (a form, a bulk edit, an import, an automation, an outbox's change) with 422 `VALIDATION_FAILED` and the code `required` on the column, and on the public API with its one refusal. Moving the other column to one of the values over an empty column is refused too. A create that leaves the other column out is judged by that column's database default. A yes is a yes in any spelling (`on`, `y`, ` true`, `1`), and on MySQL a text value is compared as MySQL compares it (`AWAY ` is `away`). An edit that changes neither column is not judged, so a row kept from before the rule can still be edited, in the record form too. Two people changing the same row at once cannot together leave it breaking the rule: the second write is refused. Studio refuses the rule beside `required`, on a column Adminium fills, or with a value the other column's own list does not have, as the manifest does. The record form marks the field required as soon as the other column holds one of the values, including a yes read back as `1`.
