---
'@adminium/server': patch
'@adminium/docs': patch
---

Two new environment variables size Adminium's database pools. `ADMINIUM_META_POOL_MAX` sets how many connections a Postgres or MySQL meta store's pool may open (10 until now, and still by default). `ADMINIUM_SOURCE_POOL_MAX` sets the size of every pool Adminium opens against a source database — the long-lived one pages and the API use, and the short-lived ones that read the schema and collect statistics — which together could reach 25 connections to one database. A source behind a pooler or an SSH tunnel, a managed database with a small connection limit, or a role with a `CONNECTION LIMIT` could not be kept inside its limit before: a pool larger than the limit has its extra connections refused, not queued, and the page that needed one failed. Both take a whole number from 1 to 100; unset, nothing changes. The environment variables page explains how to choose them.
