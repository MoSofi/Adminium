---
'@adminium/server': patch
---

Printing a document that exists only as HTML — a receipt in Arabic, Chinese or another script the PDF cannot draw — now opens it in the tab, ready for the browser's print dialog, instead of downloading an `.html` file. The page is shown sandboxed: its own styles and inline images draw, and it can run no script and load nothing. Downloading a document is unchanged.
