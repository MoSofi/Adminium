---
'@adminium/server': patch
---

An import that updates the rows its lines match is held to the role's column limit, as a change by hand is. A matched line that changes a column the role may not change, or a row in a state it may not change, is refused with `COLUMN_FORBIDDEN`; the rest of the file goes on. Before, a limited role could rewrite any column of a row it may update by bringing in a file.
