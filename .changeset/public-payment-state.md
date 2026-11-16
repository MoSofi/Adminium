---
'@adminium/server': patch
'@adminium/public-client': patch
---

An app's customer screen can now ask how a record's online payment stands when the customer comes back from the pay page: `GET /api/v1/public/payments/state?ref=…&id=…` (`client.payments.state(ref, id)`) answers `none`, `open`, `confirming`, `paid`, `failed` or `expired` (and `test` for a rehearsal's test payment). It answers only for a record the visitor can already read through that entry, as a start does, and says nothing else of the payment: no amount, no service, no id. It is never kept by a browser or a cache.
