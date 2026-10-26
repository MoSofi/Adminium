---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The first-run wizard knows when a database was connected before it opened (a project's `databases` in `adminium.config.ts`, or `ADMINIUM_SOURCE_URL`). `GET /setup/state` says so with `databaseConnected`, only while setup is open. The wizard then opens on "Create your account" as step 1 of 4, without asking what to build or for the database again, and its last screen says what is there: the database's tables and the pages generated from it, or that it could not be reached.
