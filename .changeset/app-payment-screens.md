---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app's staff screens can now show its payments. The staff side's config says `payments: { on, online, test, refund }` for the app and the person. `POST /api/v1/payments/panel/rows` answers many records' payment state at once (unpaid, part, paid, waiting, what may be refunded, a refund owed, a dispute), each read through the person's own grants. The kit gains two parts: `refund` (the two-step refund with the engine's own words and toast) and `pay-link` (Copy pay link, which reuses the record's current link). A person rehearsing an app's checkout gets its e-mails themselves, marked `[TEST]`, never at the address the order carries; Studio → Payments → Apps has "Try {app} as a customer" and a band while the rehearsal runs, with "Stop rehearsing".
