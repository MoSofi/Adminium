---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

A message about a row can now be answered to the person who owns the row. An outbox producer, and a rule's email step, may say `"replyTo": { "staff": "owner_id" }`: the message then carries, as its Reply-To, the sign-in address of the staff member that column names, looked up when the message goes. Both may name a staff column one link away (`deal_id.owner_id`, the owner of a quote's deal). With nobody there (an empty column, or a person who is removed, suspended, only invited or a sample person) an outbox message falls back to the house's own Reply-To if it has one, and the message is sent either way. Only a staff column can be named, never an address. Needs Adminium 0.3.28.
