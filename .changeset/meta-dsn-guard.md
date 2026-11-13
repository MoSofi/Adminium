---
'@adminium/server': patch
---

Moving the meta store from the setup wizard or Studio now checks the connection string you type, as a source database's is checked: a `?host=`, `?hostaddr=` or `?socketPath=` parameter and a cloud metadata address are refused before anything connects, and its host name is looked up first: a name that answers with a cloud metadata address is refused like the address itself, and a name that does not resolve answers `Could not look up <host>` (502). A database on the same server is still fine. A SQLite file chosen there must be inside `ADMINIUM_DATA_DIR`; to keep it elsewhere, set `ADMINIUM_META_URL`.
