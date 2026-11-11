---
'@adminium/server': patch
---

Moving the meta store from the setup wizard or Studio now checks the connection string you type, as a source database's is checked: a `?host=`, `?hostaddr=` or `?socketPath=` parameter and a cloud metadata address are refused before anything connects. A database on the same server is still fine. A SQLite file chosen there must be inside `ADMINIUM_DATA_DIR`; to keep it elsewhere, set `ADMINIUM_META_URL`.
