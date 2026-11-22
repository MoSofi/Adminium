---
'@adminium/server': patch
'@adminium/meta': patch
---

Row limits an owner sets stay in place through app updates, restarts, table renames, config imports and later edits. Taking an owner's limit off returns the role to the limit its app declares, straight away. Limits stored before this release are sorted at start, one install at a time, and an install that cannot be read yet keeps its limits and is tried again at the next start.
