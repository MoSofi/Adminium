---
'@adminium/i18n': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/server': patch
---

Three message groups leave the eagerly bundled `common` catalogue: `dataio`
(the import wizard, exports manager and export builder), `files` (the Files
library and its upload dialog), and `email`. All three are deferred namespaces
now, fetched by the surface that owns them.

`common` ships in every user's first load, so a key living there is paid for on
every route by every user no matter how lazy its surface is. 422 keys had
collected there that no first paint can render — and 143 of them are `email`
keys whose every call site is in the server's email-template machinery, i.e.
text a browser can never display.

**Operators with customised translations:** meta migration `0029` re-files
overrides written against the old `common:dataio.*` / `files.*` / `email.*`
addresses. Three keys did not move — two page titles that a statically imported
route factory reads, and the page-files template's upload hint — so overrides on
those are COPIED to the twin they now resolve through (`common:nav.imports`,
`common:nav.exports`, `ui:templates.files.uploadsUnavailable`) rather than only
moved.

Server-rendered email also needed `createServerI18n` to load the deferred set
explicitly. Without it every non-English recipient would have silently received
English — silently, because each call site supplies its own English default, so
there is no missing-key error to notice.
