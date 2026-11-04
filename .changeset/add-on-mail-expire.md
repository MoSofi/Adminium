---
'@adminium/server': patch
---

A mail about a row never keeps it from expiring. When a row of an add-on's table with `expire` goes (a design never ordered, 90 days after its last change), every outbox message that names it lets go of it in the same transaction: a message already sent stays in the log as it was sent, naming no row, and one not yet sent is skipped, never sent. The same holds for every other removal of such a row made through Adminium. An expired row's own file columns now go to the bin with it.
