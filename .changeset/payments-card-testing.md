---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

Payments an app's own screens start are now guarded against card testing. A public start gets a pay link of its own, current beside the link the shop sent and never in its place, so a card tester's declines lock only theirs; once its five declines lock it, starting again gives no fresh link. Public checkouts have their own hourly budget (600), apart from the shop's links. Each payment started from an app's screens (`payments/start`, or a create that answers a pay link) is counted too: 30 an hour from one address and 600 for the install, after which `start` answers `429 PUBLIC_RATE_LIMITED` and a create answers no `payUrl`. A public checkout keeps a keyed hash of the address it started from (an IPv6 address by its /64), never the address, forgotten after three hours: an address with five declined cards over the last hour or two gets no new public checkout, and declines from ten different addresses pause every public start for an hour. While paused, the apps read as not taking payments online, links the shop sends keep working, the payment managers are told once (`payments.card-testing`), and Studio → Payments says so with **Resume now** (`GET /api/v1/payments/public-starts`, `POST /api/v1/payments/public-starts/resume`); a resume counts the addresses afresh. Meta migration 0090 adds `payment_links.audience` and `payment_attempts.start_address`. The payments guide gains a Card testing section, with a Stripe Radar velocity rule to turn on.
