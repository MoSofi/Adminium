---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/dashboard': patch
---

A role can be held to some rows of a table: a person's own, their team's, the ones nobody owns yet, and only while a column holds a value. A table says whose its rows are by a staff column, a listing in another table (which may have dates), or its parent (`belongs`); a role's `limits` say which rows its read, update and delete reach (`rows`); a table marked `private` is read by its own people and by nothing else. Roles & permissions has a **Rows** dialog per role that says each limit in words and counts what a chosen person would see; Settings → Team has **Teams**, whose leads reach their members' rows; deleting an account for good first hands the rows that name the person to somebody else.
