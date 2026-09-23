---
'@adminium/server': patch
---

**A choice column an app update adds keeps its list of allowed values.**

When a new version of an app added a choice column (a pickup stage, say) to a table the app already
had, the column arrived as plain text and accepted any value. Adminium now keeps the app's list for
it, so a value that is not on the list is refused on every write, as it is for a column the install
created.
