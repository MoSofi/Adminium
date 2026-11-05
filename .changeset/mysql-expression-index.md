---
'@adminium/adapter-mysql': patch
'@adminium/server': patch
---

A MySQL database that already keeps an index over an expression (`CREATE UNIQUE INDEX … ON customers ((lower(email)))`) no longer stops an install at its writers stage with `APP_INSTALL_INCOMPLETE`. The index was read as a unique key over no column, which a stored schema refuses; it is now read with its expression, as Postgres reads one, and never as a set of columns kept unique. The index itself is left exactly as it is. Install again to finish an install that stopped this way.
