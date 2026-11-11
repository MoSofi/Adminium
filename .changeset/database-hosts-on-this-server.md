---
'@adminium/server': patch
---

A production server can now connect to a database that runs on the same machine. Name it in the new `ADMINIUM_DATABASE_HOSTS` variable by host and port (`localhost:5432`; the port defaults to 5432 for PostgreSQL and 3306 for MySQL), and that one host and port are allowed while every other port on the machine stays refused. It applies to source databases only: connections made in Studio, `ADMINIUM_SOURCE_URL` and a project's databases. A cloud metadata address in the list stops the boot, and is never allowed. An `ADMINIUM_SOURCE_URL` on loopback without a matching entry now stops the boot with the entry to add, instead of starting with a connection that can never connect. The refusal for a loopback database now says which entry to add.
