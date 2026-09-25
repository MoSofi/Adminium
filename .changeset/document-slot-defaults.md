---
'@adminium/server': patch
---

A document slot left empty takes the default its add-on declares: the day the document is made on the venue's clock, the connection's currency, or the number it prints. A draft invoice with no issue date yet now draws instead of failing as unmapped, a document drawn again keeps the day it was first made, and a statement is issued on the day it is drawn. An empty number column prints as empty, not 0.
