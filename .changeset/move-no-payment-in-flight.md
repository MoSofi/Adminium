---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A move may be refused while a payment for its row is on its way: `requires.noPaymentInFlight: true` (Adminium 0.3.62 and later), on a payable table. "On its way" is the test a timed move's `waitsForPayment` waits on (processing, succeeded or being written down, younger than seven hours), now shared. Every writer is held to it — the public API, staff, the app's code, rules — except the payment's own move to paid. Refused as `409 PAYMENT_IN_FLIGHT`; through the public API `400 PUBLIC_WRITE_REFUSED` with `reason: "payment-in-flight"`.
