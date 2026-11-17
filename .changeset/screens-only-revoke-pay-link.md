---
'@adminium/server': patch
---

A screens-only role (a till's cashier) may close a record's pay link (`POST /api/v1/payments/links/:id/revoke`), such as a QR code shown at the counter that should not be paid any more. The route asks what making one asks: the person's own right to change that record, within their row limits.
