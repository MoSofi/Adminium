---
'@adminium/server': patch
---

A change that sends a link as it already is no longer copies through it again. A person's own write through the public API carries the link that makes the row theirs (an invoice's client); the copy rule read that as the link changing and copied the client's value onto the row once more. Where the two differed — a new client with no tax rate, an invoice holding 0 — the write was refused as a change to a locked row ("That write was refused"), for a column it never named: a Client Portal client could not tell the studio they had paid. A copy now runs again on an update only when the link's value differs from the stored one.
