---
'@adminium/server': patch
'@adminium/docs': patch
---

A test server can widen every request limit with `ADMINIUM_RATE_LIMIT_SCALE` (a whole number from 1 to 1000): the API's per-person and per-address budgets and the public API's are multiplied by it, so a browser suite that drives one server as a few people no longer spends most of its time waiting for a person's minute to end. Unset, nothing changes. It is ignored when `NODE_ENV` is `production`, and the boot log says whether it applied.
