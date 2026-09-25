---
'@adminium/server': patch
---

An app's staff screen can send values for the slots its document does not map when it asks for one, so a label sheet can print as many labels as the screen asks for: `POST /api/v1/apps/<key>/documents/render` takes `values`, by slot id. Each value is typed like a value typed into the document's settings. A slot that reads a column, a list, a slot the document does not have, or a value the slot cannot hold is refused with 400 and names the slot. The same values give back the same document; different ones draw it again.
