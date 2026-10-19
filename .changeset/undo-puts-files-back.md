---
'@adminium/server': patch
---

Undoing a change now puts its files back. Before, undoing a replaced picture left the row naming the old picture while it stayed in the trash (shown broken, then gone for good when the trash was emptied), and the new picture stayed with a row that no longer named it. Undoing a new record now also sends its files to the trash, as deleting it does.
