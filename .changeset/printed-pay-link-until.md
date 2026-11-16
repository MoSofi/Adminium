---
'@adminium/add-on-contracts': patch
'@adminium/server': patch
---

A printed document can now say until when its pay link works. A `date` slot whose default is `pay-link` takes the day that same link stops opening, on the venue's clock (`YYYY-MM-DD`), beside the link and the code to scan; it is the link's own expiry, so a document drawn again a week later prints the same day. An earlier Adminium puts the link's text in such a slot, so a provider prints the day only when the value is a `YYYY-MM-DD` day.
