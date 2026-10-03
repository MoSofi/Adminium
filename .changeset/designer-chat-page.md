---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Adminium Designer's chat: the reply is drawn as Markdown (headings, lists, bold, code, tables; no HTML, no image and no link from a model is ever run, fetched or made clickable). The column no longer moves up and down while the Designer writes, and it keeps following its end. A card that waits for an answer is scrolled into view and takes the focus. A file or reference the Designer looked for and did not find is drawn plainly ("Looked for … — not there"), not as a red failure; a real failure says "Could not write …" with its reason on the line.
