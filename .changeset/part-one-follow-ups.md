---
'@adminium/server': patch
---

`adminium archive restore` and `adminium import-zip` now check each restored S3 or WebDAV address the way a new save is checked (looked up, every address checked, `ADMINIUM_NETWORK_POLICY` applied) and each `local` folder against Adminium's own folders and `ADMINIUM_STORAGE_DIRS`; one that fails is switched off and named.
