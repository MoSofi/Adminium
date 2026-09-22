---
'@adminium/manifest': patch
'@adminium/server': patch
---

**Uninstalling an app now removes its domains and placement. An install now
names a leftover table that belongs to a different app.**

Uninstall removed the app's row and its bytes, but left its entries in
`surfaces.domains` and `surfaces.apps` in place. The domains editor validates
the whole map on every save. So one host still mapped to the removed app
refused every later save with `unknown_surface`, including the save that
maps that host to the app installed in its place. The only fix was editing
the settings row by hand. Uninstall now drops every host mapped to the app,
plus its placement, name, connection and instances, and lists the removed
hosts in the `app.uninstalled` audit row.

Installing an app over a same-named table from another app was refused as
`COLUMNS_REQUIRED`, which suggested adding the missing columns. Adding them
could not help: a client-portal `payments` table requires `invoice_id`, which
the point-of-sale app never writes, so every payment it saved would still be
refused. The planner now raises a `FOREIGN_TABLE` problem for an app when a
reused table has a NOT NULL column with no default that the app does not
declare. The problem names the column and says the table may belong to
another app. Add-ons are exempt, because they reuse their host's tables.
