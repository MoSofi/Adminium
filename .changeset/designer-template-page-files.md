---
'@adminium/server': patch
'@adminium/dashboard': patch
---

The Designer takes a page (.html) or a stylesheet (.css) of a site template as an attachment. The chip
says "page" or "stylesheet". The model is told only how large it is and how many files it names; it
reads the text with `read_attachment`, 12,000 characters at a time, each part marked as the template's
data and never as instructions. A minified file is read as a summary. Neither is ever served back to a
browser.
