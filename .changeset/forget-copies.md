---
'@adminium/server': patch
'@adminium/manifest': patch
---

"Delete my details" can now also empty the person's own copies on the rows linked to them, such as the name and address on a past booking. An app turns it on with `forget.copies`. Rows are found only by their link to the person, tables the law keeps stay whole, and nothing else about the row changes.
