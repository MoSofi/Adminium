---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

An app's role can now limit what a new row it creates may be given, as it already could for a change: `limits.<table>.creatable` lists the columns, and `creatableValues` the values some of them may take. A kitchen tablet that may take phone orders could pick an order's channel, its customer, its link code and how it was paid; a door phone could give an order a code worth its whole price. Now a create outside the limit is refused `403` `COLUMN_FORBIDDEN` with `reason: "create-limit"` — on the create itself, each value of a repeat, a row added from a parent's form, the dry run, and an import (which may not bring in a column outside the limit). A value left empty, and the state column at its first state, always pass. The limit is kept through a save of the role in the permissions matrix.
