---
'@adminium/server': patch
---

What an owner took away from an app's role on an add-on's table stays taken away when the add-on is switched off and on again, or removed and installed again: the grant was given once, and is not given a second time. A ledger's rules list (`GET /ledgers/:addOn/:ledger/postings`) tells a person only of the rules, and their counts, on tables they read, and the list of every table a rule can be drawn from (`…/sources`) needs the grant that changes what a table means.
