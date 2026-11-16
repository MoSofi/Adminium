---
'@adminium/manifest': patch
'@adminium/server': patch
---

An outbox producer may be queued only while the app takes payments online for the row its message is about, or only while it does not: `producers[].payments: "on" | "off"` (Adminium 0.3.62 and later), judged when the message is queued, beside `gate`. Two producers of one event, one of each, send one mail whichever way the shop is set, each with its own template, subject and preheader; a mail that only makes sense with payments on is not sent while they are off. A row someone is rehearsing counts as on.
