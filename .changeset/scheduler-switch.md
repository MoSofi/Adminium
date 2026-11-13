---
'@adminium/server': patch
---

A new switch, `ADMINIUM_SCHEDULER=off`, starts the server without its job scheduler and job queue, so nothing that is due runs: no scheduled automation, report or watch, and no queued job such as a mail or an instance event. Jobs asked for meanwhile wait in the queue. It is for an operator's one-off check that a copied instance starts, so nothing due runs on the copy and again on the original. Unset, nothing changes.
