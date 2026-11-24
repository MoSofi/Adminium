---
"@adminium/server": patch
---

A customs declaration now stops, with a plain reason, when its values cannot be trusted: an order with a refund, a shop whose currency is empty or has changed, or a line with no weight among lines that have one. A cancelled line is left off, a shop-wide tariff code no longer hides a missing code on an order of several products, and an IOSS number is sent only on a parcel into the EU in euros, worth 150 euros or less. "Delete my details" now also deletes that person's stored labels and customs invoices. Changing an order's postage no longer empties its country.
