---
'@adminium/server': patch
---

A sample row or an imported row that leaves a `code` column empty now gets a code, made the same way as when a person creates the row. Sample data brought in `share_token: null`, so a sample project's handover link opened nothing. A code the sample or the import brings is still kept, and an undo still puts back an empty one as it was, except the code a shared link opens a row with: a sample always gets a new one, since the code printed in the app's package would open the same sample page on every install.
