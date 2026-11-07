<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — `payments`; do not edit -->

# Manifest spec: A self-made app — `payments`

### `payments`

Which tables take payments, and how. Never a key, a bank account or a contact: those are the
owner's to give after the install.

| Field | Rule |
|---|---|
| `payables` | Up to 16 payable tables, each once: `table`; `amount: { "column", "unit"? }` (`units` or `minor`); `currency` as `{ "column" }`, `{ "fixed": "EUR" }` or `{ "connection": true }`; `due: { "column" }`; `payments` as `{ "kind": "kept" }` (Adminium keeps them) or the table's own payments table, column by column (then `due` is required); and optionally `label`, `status: { "column", "paid", "refunded"? }`, `customerEmail`, `customerCountry` and up to 50 `pageFields`. Every column is one of that table's. |
| `ways` | Up to 32 ways to pay, each `{ "source", "method" }` once: `manual` or a payment service's key, and the way to pay, with `enabled`, a `label` per language, `rules` (`countries`, `currencies`, `min`, `max`) and `position`. |
| `payPage` | The pay page's plain settings: `shopName`, `shopCountry` (two letters) and `showLines`. Never a logo or a contact. |
