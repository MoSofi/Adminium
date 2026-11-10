---
'@adminium/engine': patch
'@adminium/server': patch
---

An app update that adds a column named like one of its table's states (a proof's `change_asked`) no longer fails its schema change on Postgres and MySQL: the state column's list of allowed values stays on the state column.
