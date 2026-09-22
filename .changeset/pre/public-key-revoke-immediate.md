---
'@adminium/server': patch
'@adminium/meta': patch
---

**Revoking a publishable key now stops it on the next request.**

The public API keeps each key's compiled scope in memory for up to 30
seconds. Revoking or rotating a key, or editing a scope, was meant to clear
that memory, but the key pages were connected to a copy the public API never
read. So a revoked key, or the old token of a rotated one, kept working for up
to 30 seconds, and a scope edit took as long to apply. They now share one, and
the change applies to the next request.

A revoke that lands while a request for the same key is still being looked up
now holds as well. Before, that lookup could put the key back in memory as live
for another 30 seconds. The same fix applies to switching the public API off
in Studio.

With more than one server process, the process that handled the change applies
it at once. The others still take up to 30 seconds.

Also:

- A key with an expiry date stops at that time. It used to keep working for up
  to 30 seconds past it.
- Each key's "last used" time is written at most once a minute, not on every
  request. A customer's public session is updated the same way.
- Expired public sessions are deleted by the nightly clean-up. Nothing deleted
  them before.
- Each public request reads a small record to check whether the schema
  changed, rather than the whole stored schema.
