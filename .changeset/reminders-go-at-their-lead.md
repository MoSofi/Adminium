---
'@adminium/server': patch
---

A reminder before a moment (an outbox `before` producer, such as a clinic's visit reminder) goes at its lead time again, not once the moment itself has passed. The minute scan queues it when its lead comes and keeps the moment in its due column, as before; since 0.3.20 the sender had waited for that due time, so every reminder went out at the visit. A reminder a desk queues by hand ("Send now", due at the visit) now goes at once, and the scan's own one still does not follow.
