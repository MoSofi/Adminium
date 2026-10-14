---
'@adminium/server': patch
'@adminium/manifest': patch
---

An app can write to people about a row that is removed: an outbox producer with `onDelete` queues one message for each removal (from the dashboard, a bulk removal, the app's own screen or a public entry), with the removed row's values kept in `was` for its template. For a table named so, a message no longer stops the row it is about from being removed: as the row goes, each message that named it lets go of its link and stays in the log, and one still waiting is skipped as no longer needed. An app's own people (`app:<key>:staff`) can read which of the app's shipped rules are switched on: `GET /api/v1/apps/{key}/rules` answers each rule's key, its name in the reader's language and its switch, and nothing else of a rule; a staff side asks it with `staff.rules()`.
