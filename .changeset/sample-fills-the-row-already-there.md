---
'@adminium/server': patch
'@adminium/manifest': patch
---

A sample row marked `"@onlyIfEmpty": true` may add `"@fillEmpty": true`: when the table already holds its one row (a settings row the install wrote), that row takes the sample's values in the columns it holds nothing in, never over a value. Removing the sample empties those columns again where nobody changed them since, and leaves the row.
