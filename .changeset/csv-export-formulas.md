---
'@adminium/server': patch
---

A table's CSV download no longer hands a spreadsheet a formula. A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return (`=HYPERLINK(...)` typed into a form, or given by a register or a website) is written with a quote in front, as the privacy download already does. Numbers written as text, such as `-12.50`, are left as they are, so a table's figures still import back.
