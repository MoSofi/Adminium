---
'@adminium/add-on-contracts': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

Adds the groundwork for taking payments. A new add-on contract, `payment-provider@1`, describes one payment service (start a checkout on its own hosted page, read how it ended, refund, check its webhooks), with a conformance suite and a built-in demo service that works in test mode with no account. A payment add-on loads only from a package Adminium can vouch for, and its manifest must show nothing to the public and reach only its own hosts. The meta store gains the payments tables, and a background job records a payment against its invoice or record exactly once, even after a crash, refusing rather than overpaying when the record changed meanwhile. Hooks and automations see these writes with the new origin `payment`. Nothing is offered on screen yet.
