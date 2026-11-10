---
'@adminium/server': patch
---

A MySQL connection string may carry Prisma's `sslaccept`, `connection_limit` and `pool_timeout` again, so PlanetScale's Prisma string (`?sslaccept=strict`) is accepted and a saved connection that uses one connects as before. None of the three changes where the connection goes.
