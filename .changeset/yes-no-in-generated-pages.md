---
'@adminium/server': patch
'@adminium/widgets': patch
---

A yes/no column on SQLite is a switch in a generated page's form, not a number box. SQLite keeps a yes/no as a whole number, and the mark that says what it is (`column.yesNo`, written by the table designer and by an app's install or update) reached every reader except page generation, which stored the column as `integer`; the form lets a page's stored column win, so "Active" asked for `1`. Generation now reads the mark, and a page stored before the mark was written follows it when it is read: the column draws as a switch in the form and as a yes/no in the list, with everything else the page set on it (its label, its width, whether it is hidden) kept. A form somebody designed while the column still read as a number gives up its number box for the switch too.
