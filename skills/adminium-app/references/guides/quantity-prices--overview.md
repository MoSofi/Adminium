<!-- produced from apps/docs/src/content/docs/guides/apps/quantity-prices.md; do not edit -->

# Prices by quantity, sheets and weight

A print shop's flyers cost less each at 1000 than at 500. A sheet holds 24 business cards, so 250
cards need 11 sheets. Delivery is priced by weight band. When the browser works these out, the
price a customer sees can differ from the one the shop stores, and a customer can send any price
they like. An app can instead let Adminium work every figure out on the server, in the write, from
three rules: a **band** picks the row a number falls in, a **copy** takes a value through it, and a
**formula** does the arithmetic, rounding up or down where the job calls for it.

The full rules are in the manifest reference: [Bands](https://docs.adminium.dev/reference/manifest/#bands),
[Formulas](https://docs.adminium.dev/reference/manifest/#formulas) and [Values from elsewhere](https://docs.adminium.dev/reference/manifest/#values-from-elsewhere).
