<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — A price an add-on lowers; do not edit -->

# Manifest spec: requiredSchema — A price an add-on lowers

### A price an add-on lowers

A table's `adjust` has an add-on that keeps offers lower the price of its rows, inside the save. How
it behaves is in [Discounts, codes and refunds](https://docs.adminium.dev/guides/apps/discounts-and-codes/). From Adminium
0.3.19.

| Field | Rule |
|---|---|
| `by` | `{ "addOn" }`: the add-on that answers. It must declare [`addOn.adjuster`](https://docs.adminium.dev/reference/manifest/#the-price-question). |
| `needs` | Optional. A feature of the app (`addOns.features[].id`): the rule runs only while it is on. |
| `lines` | 1–3 parts. A child table: `table`, `via` (its link to this table), `price`, `quantity?` (absent: one), `discount` (written by Adminium), `what` (1–4 of `{ "column", "as": "item" \| "category" \| "type" \| "tag" }`: what the line sells), `excludes?` (`{ "column", "set": true }`: nothing reduces a row whose column is filled), `paidBy?`, `only?` (`{ "column", "eq" }` or `{ "column", "in" }`), `unlessSet?` (a row whose column is filled is no line). Or the row itself: `{ "self": true, "price", "quantity?", "discount", … }`, once at most, with `nights?` for a price by the night. A child table's part must add up into this table through the same `via`. |
| `order.discount` | The order's reduction: a decimal column, written by Adminium. |
| `order.customer` | `link` (the foreign key to the customer), `address` (that table's address column), `proved` (a yes/no Adminium writes: whether the customer's identity was proved), `counts?` (`{ "column", "in" }`: which of the customer's other rows count as earlier orders). |
| `order.staff` | A reduction by hand: `kind` (an enum with `percent` and `amount`, and `comp` where offered), `value`, `reason`, `by` (written by Adminium: who gave it). |
| `order.currency` | A column, `{ "value" }` or `{ "setting" }`. |
| `codes` | Where codes are typed: `table`, `via`, `typed` (text, up to 64), `code` and `voucher` (columns carrying `addOnLink` into the add-on's codes and vouchers tables, filled by Adminium), `removed?` (a row with it set is no code any more). |
| `uses` | The id of a [posting](https://docs.adminium.dev/reference/manifest/#postings) on this table into the same add-on: where what the order used is recorded, once. |
| `frozen` | From when the price stands: `{ "to": [states] }`, `{ "column", "in" }` or `{ "column", "set": true }`. |
| `expect` | The money column a price check compares. |
| `refunds` | Money given back: `table`, `via`, `amount` and `tax?` (decided by Adminium), `of` and `taxOf?` (this table's columns the order's cost is read from), `against?` (the refund's link to the payment it gives back), `lines?` (`{ "table", "via", "line", "quantity" }`: the lines a refund returns). |

Every column Adminium writes here — a reduction, `proved`, `staff.by`, a code's links, a refund's
amount and tax — is read-only to every writer and in no public entry's `writable`.
