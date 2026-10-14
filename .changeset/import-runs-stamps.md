---
'@adminium/server': patch
---

A file brought in runs the table's stamps. Each line is a create or a change by the person who brought the file: a stamp (`now`, `user-id`, `user-name`, a `byOrigin` value) is written into a column the line leaves out or leaves empty, and a value the line carries is kept. A role that may not write a stamped column that must hold a value (`received_at`) could bring no row in at all: the preview said "new" and the run refused every line. A line that updates a stored row fires the stamps a change by hand would. An empty cell under a column a stamp or a default fills is a cell left out, not a line refused. `user-name` is the person's name, not their id. Sample data, seed rows and undo still stamp nothing.
