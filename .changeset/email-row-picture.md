---
'@adminium/manifest': patch
'@adminium/server': patch
---

An app's email may show the picture a row keeps in a file column: `email.image` with `fileId: "{{job.photo}}"`, the whole value, for a row one of the outbox's links reads. The manifest refuses anything else: a placeholder beside other text, a row the message does not read, a column that is no file column of pictures, and a secret, personal or withheld one. Each message checks the file against that row before it is queued (an upload the row has claimed, not in the bin, a png, jpeg, gif or webp of at most 2 MB); only a file that passes travels with it, as an inline image weighed again at delivery. One that does not is left out, or, with `"required": true`, the message is not sent and says why. Needs Adminium 0.3.45.
