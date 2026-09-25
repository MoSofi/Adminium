---
'@adminium/server': patch
---

Printing a document that exists only as HTML — a receipt in Arabic, Chinese or another script the PDF cannot draw — now opens it in the tab, ready for the browser's print dialog, instead of downloading an `.html` file. The page is shown sandboxed: its own styles and inline images draw, and it can run no script and load nothing. Downloading a document is unchanged.

A document that exists as a PDF prints as its PDF, served the way the download serves it, without the sandbox a PDF viewer may not open in. The file name an add-on gives a document is cleaned before it reaches the download: line breaks, quotes and other control characters are dropped, and the full name is sent for browsers that read it.
