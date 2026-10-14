---
'@adminium/server': patch
---

A create with a retry key (`clientKey`) works on a table whose rows take a resource for a time (`booking`, `occupies`). It was refused `409` "written one at a time", so the one table where a second row hurts most could not be retried safely. One row is now placed under the rule's lock and judged as a create with no key is; the same key again answers the row the first made (`replayed`); another key for a time that is taken is refused `BOOKING_TAKEN`. A create with rows below it is still refused.
