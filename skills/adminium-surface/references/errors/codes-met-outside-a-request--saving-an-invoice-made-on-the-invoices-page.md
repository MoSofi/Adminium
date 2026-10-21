<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — Saving an invoice made on the Invoices page; do not edit -->

# Error codes: Codes met outside a request — Saving an invoice made on the Invoices page

### Saving an invoice made on the Invoices page

An invoice made on the Invoices add-on's own page (`PUT /api/v1/invoices/:id`) can be paid only
in a currency the page offers, and keeps the currency its payments are in:

| Code | Status | When | details |
|---|---|---|---|
| `CURRENCY_HAS_PAYMENTS` | 422 | The save changes the currency of an invoice that has a live payment, or one on its way. Nothing was kept. | `field` (`currencyCode`), `currency` (the one it keeps) |
| `VALIDATION_FAILED` | 422 | `details.reason` `CURRENCY_NOT_OFFERED`: a currency the page does not offer, or one with three decimals (BHD, JOD, KWD, OMR, TND). Templates take any code. | `field`, `reason`, `currency` |

An invoice's status Paid is set and cleared by its balance. A save that asks for Paid keeps the
status already stored; it is not refused.
