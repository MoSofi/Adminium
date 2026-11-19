---
'@adminium/server': patch
---

A table's CSV download no longer hands a spreadsheet a formula. A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return (`=HYPERLINK(...)` typed into a form, or given by a register or a website) is written with a quote in front, as the privacy download already does. Numbers written as text, such as `-12.50`, are left as they are, so a table's figures still import back. A file exported and imported again keeps what it held: the import takes that quote off again, so a phone number such as `+44 20 7946 0958`, or a text such as `-not set-`, comes back as it was.
