---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/add-on-contracts': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
---

A table can ask for a removal's reason on every person's door (the delete route, a bulk delete, the add-on kit's `remove`), written into the audit entry with "no reason" on every other door, and can keep its removed rows readable through a row they linked to that the reader reads now (`removal: { reason, history }`).
A column can keep its earlier values for the audit log alone (`history: "audit"`): record history, a removed row's history, a rule's `{{was.<column>}}` and a removal's live frame leave them out.
