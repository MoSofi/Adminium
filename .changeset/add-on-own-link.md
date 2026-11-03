---
'@adminium/manifest': patch
'@adminium/server': patch
---

A shopper who saves a design and comes back changes the same design. An add-on's link key may open a row as the row's own link (`claim.own: true`): it reads the row and changes it in place (`PATCH`), through the columns its entry names and only while the row holds a value its `writableWhen` lists, so an ordered design is never changed by its shopper. A create through an app's key answers such a link once (`shareLink`), with a session already open on the add-on's key. An add-on's entry on each app's key may be read by whoever that app signed in (`level`), opening one row by its own code (`unlockBy` with `self`): a guest who found their order opens each line's design by the code the line holds. A person's copy may hold other details of theirs (`holds: "details"`), in a `text` or `json` column: a design's words are found, downloaded as they are held on every engine, and erased with them.
