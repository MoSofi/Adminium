---
'@adminium/server': patch
---

A picture uploaded on a record's form now shows on the app's own pages. A form upload field the page's grid does not list (a generated app's picture column) was not treated as a file column, so the save never attached the file to its row and the public picture route refused it. Sample data that names one picture on several rows now gives each row a copy of its own; before, only the last of those rows showed its picture.
