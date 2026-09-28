---
'@adminium/server': patch
---

An app update now checks again the copies, stamps and formulas it keeps unchanged. A formula that joins a guest's first and last names into a column the app marked personal stayed in place when an update dropped that mark, and went on writing the guest's name into a column every reader sees. The update now takes such a rule back and lists it with the rules it skipped, as installing that version fresh would, whether the mark was the app's or one an operator added in Studio.
