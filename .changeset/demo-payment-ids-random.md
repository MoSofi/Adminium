---
'@adminium/add-on-contracts': patch
---

The demo payment service's checkout, payment, refund and event ids are random (`cs_` and 16 characters), so a server restarted after a test payment no longer hands out an id it gave before and refuses the checkout. It also forgets what is long over: a checkout never paid an hour after it expired, a paid one with its refunds after seven days, an event after an hour.
