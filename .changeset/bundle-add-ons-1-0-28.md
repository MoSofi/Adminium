---
'@adminium/server': patch
---

The add-ons that come with Adminium are now 1.0.28, with a new one, Card readers: it connects to Square, so a till puts the amount on a Square Terminal at the counter. Card payments now also runs Stripe smart readers at the counter with the same key; its key needs three more permissions only once a reader is paired (Payment Intents: write, Terminal Readers: write, Terminal Locations: read).
