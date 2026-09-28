---
'@adminium/meta': patch
---

On MySQL, Adminium's own database now saves text longer than 64 KB. Its text columns held at most 65,535 bytes there, so four things failed with "Data too long for column" (or, on a MySQL server not in strict mode, were silently cut short): starting "Enrich with AI" for a database of more than about 25 tables, whose prompt is kept whole; saving the model's reply to it, pasted or received, when the reply is that long; saving a public endpoint whose definition is that long, for example with long default values; and installing or updating an app whose outbox is. These columns, and every other text column of the store, now hold any length, as on PostgreSQL and SQLite. An existing MySQL store is converted when the server starts, keeping every row. Each table is copied once, so that first start can take longer on a store with a long job or notification history.
