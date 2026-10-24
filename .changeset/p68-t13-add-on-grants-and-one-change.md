---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An add-on update whose new `appGrants` would let an app's role hold more of its tables lists each widened grant on its check and in Studio's update screen, and is refused with `ROLE_TABLES_WIDER` until it is allowed (`"roleTables": true`, on `/update` and `/upgrade` alike, and on an app's install or update that brings that release along). One save whose postings write or move the same row more than once now tells that row once, as it was before the save and as the save left it, so a rule on its change runs once.
