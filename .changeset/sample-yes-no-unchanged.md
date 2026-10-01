---
'@adminium/server': patch
---

On SQLite, sample data added before 0.3.9 no longer reads as edited once its app is updated. 0.3.9 marks an app's yes/no columns when the app is installed or updated, so they answer `true` or `false`; the sample ledger then measured each row by what it read as, and every sample row with a yes/no looked changed — "Remove sample data" kept them, and the rows they point at. A SQLite yes/no is now measured as the number its row keeps, the way it was recorded. A sample added on 0.3.9 itself, on SQLite, is the one case measured the old way: its rows with a yes/no are kept by a removal that keeps changed rows.
