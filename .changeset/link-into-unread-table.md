---
'@adminium/server': patch
---

A link into a table the writer does not read at all is now judged, where that table says whose its rows are: the writer may name a row that is theirs by the table's own ways, and no other. Until now only a writer who read the table in part was held to the rows they reach, so somebody with no read of it could hang a row on any record by its key and read whatever the new row copied from it. The refusal is that of a link to a row that is not there. A file brought in is judged the same way. Tables that say nothing of their rows are unchanged.
