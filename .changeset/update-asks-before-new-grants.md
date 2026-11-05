---
'@adminium/server': patch
'@adminium/dashboard': patch
---

An app update that gives one of its roles the right to find and erase people's data (`privacy:@:people`), or an add-on's shared settings, which the running version's role did not have now asks first: the update's check marks each such grant, the update dialog shows it, and the update is refused (`ROLE_GRANTS_ADDED`) unless it is allowed.
