---
'@adminium/manifest': patch
'@adminium/server': patch
---

Somebody who holds two limited roles on one table, one of which says which rows it reaches (`writableFrom`), is now held to each role on the rows it reaches: a column one role may write is no longer writable on a row only the other role reaches. Before, the two limits were added together and the row limit was dropped.

When a discount code is checked before it is saved, the stored codes that read like it are named only to somebody who may read the codes; somebody who may only make codes is still told whether the word is taken.

A column may keep the last four characters of a code a person types (`codeLast4.of` naming the column a `lookup` reads), as it already could for a code Adminium makes: a payment row can show which gift card paid without showing its code.

An app update no longer adds a foreign key to a table the app took over from somebody else (an adopted table): such a table is left as its owner keeps it.
