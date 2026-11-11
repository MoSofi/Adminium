---
'@adminium/server': patch
---

Switching "Allow databases on this server" off now closes the database connections already open, so a database on the server itself stops answering right away instead of until the next restart. Other databases reconnect on their next request.
