---
'@adminium/server': patch
---

An add-on's page may fetch a font, a picture or a licence shipped beside its code, from `/api/v1/add-ons/<key>/pages/<ref>/files/<path>`: only from the code's own folder or below it, only those kinds of file (never a script), behind the page's own permission, and only bytes verified when the package was unpacked. An SVG is served sandboxed, so opened on its own it runs nothing.
