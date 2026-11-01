---
'@adminium/add-on-contracts': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

"Your websites" on Privacy & public pages: the websites that may show a form in a frame, added several at once (every line checked as it is typed and again on save, all or none: one website per line, https, no path, not this server, not listed twice; at most 50) and removed one by one, each change in the audit log. A listed website only frames a form and talks to it: it feeds the form's `frame-ancestors` and the loader's origin check, never the public API's origins or the CORS list, and a save takes effect with no restart. The line check is published at `@adminium/add-on-contracts/forms/websites`. The page opens on "Can visitors reach your public pages?", the forms door's own answer, drawn in the same card shell as Payments' reach card. A host can now be mapped to the add-on pages with a home page: `/` goes to that page, the pages and the doors they lead to are served, and every dashboard path, `/apps`, `/ws` and the rest of `/api` are refused. An app whose only public entries open tables to forms no longer says on its settings page that it needs the public API.
