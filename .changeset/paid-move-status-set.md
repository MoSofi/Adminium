---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A payable's paid move may write further columns of the record with fixed values, in the same write: `status.set: { "<column>": <value> }` (Adminium 0.3.62 and later), such as a ticket order's `paid_method: "online"`. Only a payment made on the pay page writes them — one recorded by hand, or taken on a card reader, writes none — and they are the move's own under the record's lock. At most four plain columns of the payable's own table: never the state column, the amount, the balance, the currency, a money column, a key or a link.
