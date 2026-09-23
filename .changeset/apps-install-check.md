---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/engine': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

**Installing an app checks every table first, and never writes anything you have not seen.**

Before **Install**, the new **Check the tables** step lists each table the app needs: **New**,
**Yours from an earlier install**, **Shared with another app** or **Name taken**. For a taken
name you choose: use the table as it is (offered only when it is safe — a table with a required
column the app never fills cannot be reused, and the page says why), rename the existing table
out of the way (Adminium repairs its own pages, grants, label overrides and public endpoints
that named it), or give the whole app a different prefix. Apps that ask for it get their tables
under their own prefix (`pos_menu_items`), so another app's plain `payments` is never in the way.

An install that stops part way answers `409 APP_INSTALL_INCOMPLETE` naming the stage and the
tables already made; nothing is removed, and **Try again** finishes from where it stopped.
Updating runs the same check for new tables and keeps the names an install already has; an
update that cannot run lists every reason. An install made before its app used a prefix is
offered **Rename to <prefix>…**, which previews every table and then renames them, with pages,
grants, overrides and endpoints following.

Uninstalling keeps your data unless a Super Admin ticks **Also delete its tables and data** and
types the app's key; only tables the app created and no other app uses are dropped. Pages you
edited stay as ordinary pages, the app's key is revoked at once, and a domain that pointed at the
app answers `503 SURFACE_UNAVAILABLE` until you map it again. A reinstall recognises the tables
it left.
