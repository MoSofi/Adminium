---
'@adminium/server': patch
---

**Two people saving the same thing at once no longer see "Something went wrong".**

When the database gives up one of two writes that wanted the same rows (a Postgres deadlock or
serialization failure, a MySQL deadlock or lock wait timeout, a busy SQLite file), the write is
answered with **409 `WRITE_CONFLICT`** and `details.retry: true` instead of a 500: "Someone else
changed this at the same moment. Try again." This includes a conflict raised while holding a
parent's balance, a booking lock, or at commit. Public API callers still get the usual opaque
refusal.
