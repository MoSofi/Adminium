---
'@adminium/server': patch
---

A date stamped with "today" by one side only — a client approving a deliverable in the portal, which records the day it was approved — now takes the day where the venue is. It took the server's day in UTC, so in the hours between midnight in UTC and midnight at the venue (or the other way round) the approval was recorded on the day before or the day after. Client Portal's approval date is one such stamp. Days already recorded are not changed.
