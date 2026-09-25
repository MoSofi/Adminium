---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

An app's staff screen can send values for the slots its app lets a request fill when it asks for a document, so a label sheet can print as many labels as the screen asks for: `POST /api/v1/apps/<key>/documents/render` takes `values`, by slot id, and a document entry in the manifest lists the slots a request may fill in `requestValues` (up to 8, each one it does not map). Only those are taken: a slot the entry does not list, one that reads a column, one the add-on fills itself (the date, the number, the currency), one that holds money, a percentage, an address or a date, one the document's own typed values fill, or a value the slot cannot hold is refused with 400 and names the slot, and nothing is drawn. An app that lists a slot its add-on keeps for itself is refused at install. A document drawn with values names the slots they filled, is never emailed on its own (someone settles it, as with a customer's own request), and a later print of the same row takes nothing from it. The same values give back the same document; different ones draw it again.
