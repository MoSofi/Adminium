---
'@adminium/server': patch
---

Adding an app's sample data again no longer copies the rows the last removal
kept. Removing sample data keeps the sample rows your own records use (a
clinician or visit type a real booking points at), but it forgot them
entirely, so the next add wrote them a second time: Clinic Desk's "Find a
time" listed every visit type twice.

A removal now remembers each row it keeps, and the next add takes that row
back, with the other sample rows pointing at it, instead of writing a copy.
It does so only while the row reads exactly as the sample wrote it. A kept row
you have changed since stays yours, and the sample writes its own row beside
it. A row you made yourself is never taken back, however much it looks like a
sample row. A kept row whose key the sample names itself (a fixed uuid) used
to stop the whole add with a clash; it is now taken back too.

Rows kept by a removal made before this release were not remembered, so any
copies already made stay until you delete them.
