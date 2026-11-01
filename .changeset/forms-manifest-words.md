---
'@adminium/manifest': patch
'@adminium/server': patch
---

An add-on can declare `addOn.forms`: which of its tables hold the forms, the answers, and (optionally) the survey invitations and the strangers' files. Each must have the columns Adminium reads and writes, by name and kind; the answers and files are written by Adminium alone (no role, app grant or step of the add-on writes them), no public entry of the add-on opens any of the four, and the add-on is filed under `marketing`. Both words need Adminium 0.3.40.
An app opens a table to forms with a `publicAccess` entry under the reserved key `forms` (`publicAccess.forms`): POST only, with anonymous limits and the columns a form may fill, one per table, and no entry on any key may let anyone read that table's rows. No browser key may be named `forms`, the install makes no endpoint and no key for such an entry, and the public API answers a request for that table as for a table nobody opened. `formsEntriesOf` hands the forms door each such table with its writable columns, defaults, decided columns, plain-text columns and limits.
The human check has a new purpose, `form`, bound to a form's id: a form's proof never passes as a write's, nor a write's as a form's.
