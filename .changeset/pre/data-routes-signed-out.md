---
'@adminium/server': patch
---

**The data routes now answer a signed-out caller 401 before looking anything
up.**

`/api/v1/data/<connection>/<table>/…` checked the table grant only after it had
found the connection, its schema snapshot and the table, and a caller who was
not signed in simply held no grant. So anyone who knew a connection id could
learn, without signing in, whether the connection existed, whether it had been
introspected, and which tables it had: an unknown table answered 422, a real
one 403 naming the table. Rows and column names were never exposed. Each of
those 403s also wrote a `permission.denied` entry to the audit log attributed to
Adminium itself.

Every table route now answers 401 `UNAUTHENTICATED` to a caller with no session
and no API key, with the same body whatever exists, and writes nothing to the
audit log. A dashboard whose session has expired now gets that 401 from these
routes, not a 403 saying the user has no access to the table.

Signed-in callers are unaffected.
