---
'@adminium/server': patch
---

When an automation's Update field step clears a file column, the file it held now goes to the trash, as it does when a person clears it. Before, the file stayed attached to the record for ever, never shown and never cleaned up. A file a rule's write names is still taken by no record.
