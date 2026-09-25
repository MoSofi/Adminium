---
'@adminium/server': patch
---

Public access holds tighter: a column a claim reaches through (`claim.via`) can no longer be made writable, and a signed-in create fills it from the session, so a caller cannot file a row under someone else. A table named with or without its schema is now one table to the rule that keeps a child's link unwritable.
