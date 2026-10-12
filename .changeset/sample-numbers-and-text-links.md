---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

An app's sample rows can take numbers in a series of the app's own. A gapless `sequence` marked `"sample": true` is given by each sample row, with the text written from it (`"code_seq": 7, "code": "J-07"`), and the next real row follows the largest; it is refused on a table built on an add-on's document, whose numbers stay off limits to a sample. Needs Adminium 0.3.27. A text column that links into an add-on whose keys are numbers now answers a value that could never be a key with "not found" on every engine, where Postgres answered with a database error.
