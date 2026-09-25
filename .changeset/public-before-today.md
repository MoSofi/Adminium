---
'@adminium/server': patch
---

An app's public door may ask that a date be before today (`writableWhen: 'before-today'`), an out-of-date offer that may be asked about again. It applies to a date column only, a day stored as a number never counts as past, and the door may not write that date itself. A door that only reads no longer counts as writing the link a child row is read by.
