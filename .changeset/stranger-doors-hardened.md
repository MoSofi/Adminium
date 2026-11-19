---
'@adminium/server': patch
'@adminium/dashboard': patch
---

The pages strangers see (forms, live chat and landing pages, under `/x/`) are locked down further. Their content policy now lets them call only `/x/` on the same host, never the staff API, and allows no `data:` pictures; they refuse any script that would write markup (Trusted Types), and they open with `Cross-Origin-Opener-Policy: same-origin`. A signed-in member of staff's session is no longer read at these doors, so a page there can never act with it. A form's own page now carries its title and language in the HTML. A preview of a form or a page is refused to a role that may read only some rows of its table.
