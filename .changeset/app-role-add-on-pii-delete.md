---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/dashboard': patch
---

An app's role may now read an add-on table's personal columns (`read_pii`) and remove its rows (`delete`) through `roles[].tables`, and hold up to twenty-four such grants (more than twelve needs Adminium 0.3.47 in the manifest's floor). An add-on may let apps' roles add rows and change its own columns on a table its ledger writes (`appGrants`), never a column the ledger writes and never a remove there. The install check says each.
