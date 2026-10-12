---
'@adminium/server': patch
'@adminium/dashboard': patch
---

Handing a person's rows to somebody else is narrowed. It happens only as the person is suspended or removed (`DELETE /users/:id?handTo=<id>`, or the hand-over route for a suspended person), so the server moves no row for a removal it then refuses. Only the columns that decide whose a row is move; a column that records who approved or made a row keeps its name. The taker must be active and hold a role that reads every table concerned. A Super Admin's rows are a Super Admin's to hand on. Each table gets its own audit entry. A database's rows move in one transaction and the reply says what really moved, and which database could be counted and not written. Rows of private tables are said to exist and are never counted or named.
