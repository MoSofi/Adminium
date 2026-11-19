---
'@adminium/dashboard': patch
---

Two fixes to the kit add-ons and project pages draw with. An `Input` or a `Select` given both a `label` and its own `id` is now named by that label for screen readers; before, the label pointed at a different id and the field had no name. A `DataTable` column whose label is empty no longer stops the whole page from drawing: the column is headed by its key instead.
