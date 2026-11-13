---
'@adminium/server': patch
---

The meta store's database is now reached at the address its host was checked at. Before, the boot checked the host in `ADMINIUM_META_URL` (or in `adminium.json`) and then let the Postgres or MySQL driver look the name up again, so a name that answered differently a moment later could reach an address the check refused. Each connection now dials checked addresses only, as a source database's does: the name is checked again for each new connection (one lookup serves five seconds of them), so a failover is followed and a name that moves to a cloud metadata address is refused. The address string still reaches the driver as written, so its parameters (`sslrootcert`, `sslmode`, a socket path) keep what they did, and TLS still checks the certificate against the host name. A store moved or adopted from the setup wizard or Studio is dialled the same way.
