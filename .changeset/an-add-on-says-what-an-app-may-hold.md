---
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/dashboard': patch
---

An add-on now says how far an app's role may go on each of its tables (`requiredSchema.tables[].appGrants`): which actions, and which columns it may read, change or fill in, or which never. What an app's `roles[].tables` asks past it is left out and named (`narrowed`, `skipped: "ceiling"` or `"not-offered"`), and a grant on such a table always carries its column lists. An add-on that says nothing is held by its own shape, as before. The install check lists each role's hold on an add-on's tables with its columns, under the add-on's row. An app update whose roles would hold more of an add-on's tables than the running version is refused with `ROLE_TABLES_WIDER` until it is sent with `"roleTables": true`; Studio's update check shows what is new, and Update sends it.
