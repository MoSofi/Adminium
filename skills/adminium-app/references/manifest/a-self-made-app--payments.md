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
table's reference is a text column marked `unique`, and no public entry writes it or the columns a
payment fills (`provider`, `approvalCode`, `last4`). `ways` and `payPage` stay a self-made file's.

What Adminium guards in the payments table, whoever writes (staff, an API key, the app's own code):

- **A row taken online** (its reference holds the payment's attempt id) is the payment's whole: only the
  payment makes it and only a refund changes it. Nobody edits any of its columns — its amount, service,
  approval code, last four — nor voids or deletes it (`403 TABLE_FORBIDDEN`, `reason: online-payment`).
- **The reference** and **`refundedElsewhere`** are filled by Adminium alone, on any row
  (`reason: payment-column`); so are a refund table's `providerRef` and `state` stamps.
- **A row recorded by hand** (no reference, or the `hand_…` one Payments gives a hand payment) stays its
  person's: made, corrected and removed as before — its approval code and last four included, which a
  card paid on the counter's own terminal is written with. The same goes for `provider` and `paidAt`.

| Field | Rule |
|---|---|
| `payables` | Up to 16 payable tables, each once: `table`; `amount: { "column", "unit"? }` (`units` or `minor`); `currency` as `{ "column" }`, `{ "fixed": "EUR" }` or `{ "connection": true }`; `due: { "column" }`; `payments` as `{ "kind": "kept" }` (Adminium keeps them) or the table's own payments table, column by column (then `due` is required); and optionally `label`, `status: { "column", "paid", "refunded"?, "from"?, "refundedFrom"?, "set"? }`, `customerEmail`, `customerCountry` and up to 50 `pageFields`. Every column is one of that table's. `currency` may also be `{ "setting": { "table", "column" } }`, a text column of the app's one-row settings table. The payments table may leave out `date` when it names `paidAt` (the moment), and names `provider`, `approvalCode`, `last4` and `currency` columns, which Adminium fills on a payment taken online (a payment recorded by hand fills them as its person writes them: what is guarded is listed above). `status.from` lists the states a payment moves a row to `paid` from (`["paying"]`); a row in any other state keeps its state. `status.set` (Adminium 0.3.62 and later) names up to 4 more columns of the record, with fixed values, that a payment made on the pay page writes in the same write as its move to `paid` — a ticket order's `{ "paid_method": "online" }`; a payment recorded by hand, or taken on a card reader, writes none of them. Only plain columns of the payable's own table: never the state column, the amount, the balance, the currency, a money column, a key or a link. Also: `payableWhen` (1–8 conditions on the row, the `requires` grammar: outside them there is no link and no checkout), `returnTo` (a path on the app's customer side, no query and no fragment), `receipt` (`app` or `engine`: who mails the receipt, never both), `onlyOnline` (the pay page offers no way to pay by hand) and `instantOnly` (`true`, or `{ "where": [...] }`: only ways that settle at once). An invoice built on the Invoices shape at version 2 or later is `{ "table", "shape": true }` with only `returnTo`, `receipt` and `onlyOnline`. |
| `ways` | Up to 32 ways to pay, each `{ "source", "method" }` once: `manual` or a payment service's key, and the way to pay, with `enabled`, a `label` per language, `rules` (`countries`, `currencies`, `min`, `max`) and `position`. |
| `payPage` | The pay page's plain settings: `shopName`, `shopCountry` (two letters) and `showLines`. Never a logo or a contact. |

#### Paying from the app's own customer screens

A customer side asks the public API three things about payments, under the app's own key (the
public client's `payments`). Only the app's own payables are answered, never a table another app or
a person made payable:

| Call | What it answers |
|---|---|
| `GET /api/v1/public/payments/available` (`client.payments.available()`) | `{ "online" }`: true only while someone who manages payments has switched the app on, a payment service is live and customers can reach the pay address. Show **Pay now** only then; otherwise the screens read as they always did. `test: true` while someone who manages payments rehearses the checkout on this address (show the TEST band). |
| `POST /api/v1/public/payments/start` with `{ "ref", "id" }` (`client.payments.start(ref, id)`) | `{ "payUrl" }`: the pay link of a record the visitor can read through the entry `ref`. A proof is owed (`pay-start`; the client solves it). A record the visitor cannot read is `404 PUBLIC_REF_NOT_FOUND`, as for a read; one that cannot be paid now is `409 PUBLIC_PAY_REFUSED` with `params.reason` `off`, `not-payable`, `nothing-due` or `not-now`. The amount is always the record's own. |
| `GET /api/v1/public/payments/state?ref=…&id=…` (`client.payments.state(ref, id)`) | `{ "state", "test"? }`: how the record's newest online payment stands, for the customer who comes back from the pay page. Read through the entry `ref` as a start is, with the same `404`. `none` (no payment was started online), `open` (a checkout is open at the service, which has not said yet: show "Checking your payment…" and ask again), `confirming` (the bank is confirming it, which some ways take days for: say so, and not to pay again), `paid` (the money arrived; read the record again for what it now says), `failed` (it did not finish; nothing was taken) or `expired` (the time to pay on the service's page ran out; nothing was taken). `test: true` for a rehearsal's test payment. One word and nothing else: no amount, no service, no id, nothing of the customer. Never kept by a browser or a cache. Adminium 0.3.61 and later. |

All three are limited as every public call is (`429 PUBLIC_RATE_LIMITED`). A payable's `returnTo`
is where the pay page's **Back to …** sends the customer; it carries no token, so the screen there
finds the record by the customer's own session or claim, then asks `state`.
