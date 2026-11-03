---
'@adminium/server': patch
'@adminium/manifest': patch
---

An app's service mail that names a consent purpose (a survey invitation, an asked-for brochure) now skips an address on the do-not-email list, as marketing mail does, when it is queued and again at the hand-over. A receipt or other service mail with no purpose still goes.
