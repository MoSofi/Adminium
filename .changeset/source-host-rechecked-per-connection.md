---
'@adminium/server': patch
'@adminium/engine': patch
'@adminium/adapter-postgres': patch
'@adminium/adapter-mysql': patch
---

A source database's connection pool now checks its host name again for each new connection, instead of keeping the addresses from when the pool opened. After a managed database fails over (Amazon RDS or Aurora moving its name to a new primary), new connections go to the new address within about five seconds, without restarting Adminium. A name that moves to an address the server refuses (a cloud metadata address, or the server itself where that is not allowed) is refused on the next connection. One lookup serves every connection opened within five seconds.
