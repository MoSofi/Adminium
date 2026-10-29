---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/i18n': patch
---

The password pages ask for the workspace's own minimum length (10 by default) rather than saying 8, so a 9-letter password is no longer accepted on the page and then refused when saved. This covers choosing a password from an invite or a reset, and changing it under Security. After choosing one, the sign-in screen says "Password saved" instead of greeting a new person with "Welcome back". A page you may not open says "This page is restricted", not "This dashboard is restricted". "Data exports" is no longer in the sidebar of someone who can export nothing; the session's bootstrap now carries `canExport`, worked out like `canImport`.
