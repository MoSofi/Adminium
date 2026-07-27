---
'@adminium/adapter-postgres': patch
'@adminium/meta': patch
---

Diagnose transaction-pooling (PgBouncer) Postgres endpoints. Adminium sets its
session timeouts in the startup packet, which Neon `-pooler` hosts and Supabase's
port-6543 pooler reject with a bare `08P01: unsupported startup parameter in
options: statement_timeout`. That failure now maps to `UNSUPPORTED` with a hint
naming the fix — use the direct/unpooled connection string — and the connect
wizard shows the adapter's hint instead of the generic "verify the DSN" copy.

Adapter remediation hints are now persisted alongside the driver message
(`adminium_connections.last_error_hint`, migration `0013`), so a failing
connection still explains itself on the Hub after a reload.
