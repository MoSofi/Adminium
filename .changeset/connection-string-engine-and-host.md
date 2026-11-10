---
'@adminium/server': patch
---

A connection string must now be for the engine the connection is for: a SQLite string offered for a PostgreSQL or MySQL connection (or the other way round) is refused with a message naming both, when the connection is tested or created and whenever a saved one connects. A host written as a number in another form (`2852039166`, `0xa9fea9fe`, `127.1`, `[::ffff:169.254.169.254]`, `[::1]`) is now read as the address it stands for, so the cloud metadata address is refused in every spelling, and in production so is this machine's own address. The same reading applies to model, webhook and email addresses.
