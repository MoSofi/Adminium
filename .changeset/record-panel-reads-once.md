---
'@adminium/widgets': patch
---

Opening a related tab in a record's panel no longer ends in "Rate limit reached". The tab read its rows again every time it drew, and its own answer made it draw: one open tab sent the same read over and over, as fast as the server answered, until the signed-in budget (300 requests a minute) was spent and the next page the person opened was a full-page 429. The tab now reads once per record. A read that is refused leaves the tab's count on screen instead of an unhandled error.
