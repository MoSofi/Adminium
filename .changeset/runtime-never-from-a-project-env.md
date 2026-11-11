---
'@adminium/server': patch
---

A project's `.env` (or its config) can no longer set `ADMINIUM_RUNTIME`. A line `ADMINIUM_RUNTIME=desktop` there made `adminium start` behave as the desktop app, which turned the setup token off. `adminium start`, `dev` and `design` now ignore that name in a project folder and print that they did. Other variables in a project's `.env` are still read as before.
