---
'@adminium/server': patch
---

The automation editor and the export builder work again once a table is hidden. Both list the tables of a connection, and both resolved every table by name before deciding to skip it; a hidden table is not resolvable, so one hidden table answered the whole list with "Unknown table" — and every app installed with its sample data leaves one behind. In the automation editor that showed as an email step with no template and no column to choose, and a trigger with no table to pick; in the export builder as no sources at all. Both lists now leave a hidden table out, as the data screens always have.
