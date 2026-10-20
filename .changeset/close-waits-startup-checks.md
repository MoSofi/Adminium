---
'@adminium/server': patch
---

A server stopped soon after it started no longer hangs while closing a Postgres settings database. The check of installed add-ons and apps that runs at start, and the loading of add-on code, now finish before the server finishes closing. Before, either could still be reading the settings database when it was closed, and the close waited for it forever.
