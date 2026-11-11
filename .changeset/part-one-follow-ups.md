---
'@adminium/server': patch
---

A meta-store connection string typed into the setup wizard or Studio now has its host name looked up before anything connects: a name that answers with a cloud metadata address is refused like the address itself, and a name that does not resolve answers `Could not look up <host>` (502). `adminium archive restore` and `adminium import-zip` now check each restored S3 or WebDAV address the way a new save is checked (looked up, every address checked, `ADMINIUM_NETWORK_POLICY` applied) and each `local` folder against Adminium's own folders and `ADMINIUM_STORAGE_DIRS`; one that fails is switched off and named.
