---
'@adminium/manifest': patch
'@adminium/server': patch
---

An app's document can leave rows out of a list it prints. A `collection` in a document mapping takes `where` (keep only the rows whose column holds one of the values) and `unless` (leave out a row whose column is true or set), the same words a statement's sources use, so a till receipt can skip voided lines with `"unless": "voided"`. Both must name a column of the listed table, or the manifest is refused.
