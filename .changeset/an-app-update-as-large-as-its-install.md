---
'@adminium/engine': patch
'@adminium/server': patch
---

Three things an app's update to a larger version ran into:

- An update may add up to 400 columns in one go (50 before). An app that gained 51 planned as installable and then stopped half-way at the tables step.
- An update takes a column whose name the database reserves (`left`), as the app's first install does: every statement quotes its names. Before, the plan said installable and the update stopped with `RESERVED_IDENTIFIER`. Studio still tells a person who picks such a name.
- A row that posts for itself (a posting with no `via`) is left out by its `unlessSet` or `only`, as a line under a parent is. Before, a refund line marked "not put back" still put one back on the shelf.
