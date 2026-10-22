---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/add-on-contracts': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

Payments, from the sandbox walks: a dispute that arrives before its payment is written down is kept and applied; a lost dispute is recorded as money returned (balance, Refund…, a notice) and a won one says so; a refund that settles a dispute is counted once, even when the dispute's close is the first event heard or both arrive at once (dispute events may say when the dispute opened, `PaymentDispute.openedAt`); a lost dispute later reported won is undone; moving the public address while no pay address is chosen raises the pay-address alarm; a refund refused for a missing permission fails at once; a checkout that cannot start fails at once instead of holding the record; the pay address defaults to the public address; the PayPal test payment uses its own way; payment notices go out in test mode, marked Test. Setup names the webhook cards' mode, shows PayPal events by name, lists the Stripe permissions as the Stripe form names them, says when no way to pay is switched on, and keeps a service's card while the address is unreachable. Every refund is its own line on a record's Payment panel. A status column's values are read the same way by the wizard and the server.
