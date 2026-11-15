---
'@adminium/server': patch
---

A payment taken online is now written by the payment alone, at every door. In a payable's payments table, a row that carries the payment's reference can no longer be created, changed or deleted by a person, an API key, a rule, an import or a project's code, whatever rights they hold: only the payment itself writes it, and a refund changes it. Nobody else fills the reference column, or an invoice's `provider` column, on any row. Such a write is refused with `403 TABLE_FORBIDDEN` and a `reason` of `online-payment` or `payment-column`. A payment a person recorded by hand (cash, a card on the counter's own terminal) stays theirs to correct and remove, and an app's sample and seed rows are written as before.
