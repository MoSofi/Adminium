---
'@adminium/server': patch
'@adminium/manifest': patch
---

An app's document can be for some rows only: `where: { "column": "kind", "in": ["taken"] }` on a `receipt` means money given back never prints as "Amount received". Another row has none: the render answers `409` `DOCUMENT_NOT_FOR_ROW`, and an email that would carry it goes without it rather than failing.
