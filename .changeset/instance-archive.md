---
'@adminium/server': patch
'@adminium/meta': patch
---

New `adminium archive create <file>` and `adminium archive restore <file>`: a whole instance in one signed file (the meta store from any engine, restorable into any; uploads on this server's disk; local SQLite databases; the project folder; the list of installed apps and add-ons), restored into a fresh instance on another server. Sessions, reset and invitation links, add-on trust and the Designer's live switch never travel; API keys come back only with `--keep-api-keys`; connection strings, storage addresses and app domains are checked again on restore. `--hold` restores with mail, the public API and every app's customer side off. `archive create --export` writes the same contents without password hashes, secrets and keys, and `adminium import-zip` reads it. New optional `ADMINIUM_ARCHIVE_KEY` signs archives with an operator key instead of one made from `ADMINIUM_SECRET`.
