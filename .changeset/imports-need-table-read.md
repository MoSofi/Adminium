---
'@adminium/server': patch
---

Holding `imports.manage` no longer opens another person's import of a table you cannot read. Its details, its place in the imports list, its refused-rows report and its run action now answer as if the import were not there.
