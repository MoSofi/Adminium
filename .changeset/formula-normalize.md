---
'@adminium/server': patch
---

A formula column with a `normalize` rule keeps the value it works out the way the rule says, as a typed value is: a join over a postcode and an address line kept as a code is `SL71BT12QUAYSTREET` however the address is typed. It is kept so on a create, an edit, a total that works it out again and an update that fills it for the rows already there, before the row meets its unique key. Before, only a join over a running number was kept so, and the same address typed in another case made a second key past a `unique` one.
