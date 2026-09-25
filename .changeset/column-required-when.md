---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
---

A column can be required only for some values of another column of its row: `"requiredWhen": { "column": "kind", "in": ["away"] }` asks for `person_id` on an away event and not on one in the office. A create or an update that leaves the column empty while the other column holds one of the values is refused on every door (a form, a bulk edit, an import, an automation, an outbox's change) with 422 `VALIDATION_FAILED` and the code `required` on the column, and on the public API with its one refusal. Moving the other column to one of the values over an empty column is refused too. The record form marks the field required as soon as the other column holds one of the values.
