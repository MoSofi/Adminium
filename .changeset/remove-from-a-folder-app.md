---
'@adminium/server': patch
'@adminium/engine': patch
'@adminium/dashboard': patch
---

An app that runs from its project folder now loses what you take out of its manifest. A page you delete is removed (one somebody edited is kept as an ordinary page), a role is removed with its grants, and the terminal says who held it. A table or a column that holds data is never dropped on the way: everything else is applied, and the question waits in Studio → Apps, where "Keep the data" leaves it in the database and out of the app, and "Remove them" (Super Admin, two clicks) drops it. The same question can be read and answered with `GET` and `POST /api/v1/project/apps/:key/removals`. A table or column that holds nothing is dropped without a question. A column that holds less than it did (a shorter text, a removed option, a value now required) is never changed in the database: the rows that no longer fit are counted and stay. A server (`adminium start`) never drops and never asks: it keeps the data, releases the table from the app and says so.

The schema editor's edit document gains `dropColumns`, a narrow way to drop a column from a table that stays. Two fixes came with it: dropping a foreign key from an existing table now compiles on Postgres and MySQL, and on SQLite a column under a unique rule or a link is dropped in the table's rebuild instead of failing halfway.
