<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — `payments`; do not edit -->

# Manifest spec: A self-made app — `payments`

### `payments`

Which tables take payments, and how. Never a key, a bank account or a contact: those are the
owner's to give after the install.

Any app may carry `payables` (Adminium 0.3.60 and later). A catalog app's payables arrive switched
off: installing or updating it asks for no payments right, and someone who manages payments switches
the app on in Payments. Each is checked at install as the payments screen checks a mapping (money
columns, the currency's decimals, the way-to-pay values, a unique reference), on tables the app made
itself, never one shared with another app or made by hand; one that fails is not made. An update that
changes how an app's money lands switches it off again and tells the payment managers. Its payments
table's reference is a text column marked `unique`, and no public entry writes it or the columns only a
payment fills (`provider`, `approvalCode`, `last4`). `ways` and `payPage` stay a self-made file's.

| Field | Rule |
|---|---|
| `payables` | Up to 16 payable tables, each once: `table`; `amount: { "column", "unit"? }` (`units` or `minor`); `currency` as `{ "column" }`, `{ "fixed": "EUR" }` or `{ "connection": true }`; `due: { "column" }`; `payments` as `{ "kind": "kept" }` (Adminium keeps them) or the table's own payments table, column by column (then `due` is required); and optionally `label`, `status: { "column", "paid", "refunded"?, "from"?, "refundedFrom"? }`, `customerEmail`, `customerCountry` and up to 50 `pageFields`. Every column is one of that table's. `currency` may also be `{ "setting": { "table", "column" } }`, a text column of the app's one-row settings table. The payments table may leave out `date` when it names `paidAt` (the moment), and names `provider`, `approvalCode`, `last4` and `currency` columns, which Adminium alone fills. `status.from` lists the states a payment moves a row to `paid` from (`["paying"]`); a row in any other state keeps its state. Also: `payableWhen` (1–8 conditions on the row, the `requires` grammar: outside them there is no link and no checkout), `returnTo` (a path on the app's customer side, no query and no fragment), `receipt` (`app` or `engine`: who mails the receipt, never both), `onlyOnline` (the pay page offers no way to pay by hand) and `instantOnly` (`true`, or `{ "where": [...] }`: only ways that settle at once). An invoice built on the Invoices shape at version 2 or later is `{ "table", "shape": true }` with only `returnTo`, `receipt` and `onlyOnline`. |
| `ways` | Up to 32 ways to pay, each `{ "source", "method" }` once: `manual` or a payment service's key, and the way to pay, with `enabled`, a `label` per language, `rules` (`countries`, `currencies`, `min`, `max`) and `position`. |
| `payPage` | The pay page's plain settings: `shopName`, `shopCountry` (two letters) and `showLines`. Never a logo or a contact. |
