<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § A cart becomes an order; do not edit -->

# A website template as a working app: A cart becomes an order

The cart page and the checkout page become one order: an `orders` table with the checkout's fields,
an `order_lines` table with the product and the quantity, and one public create with the lines as
its children, a quote first, a price check and a retry key, all as
[an order with its lines](https://docs.adminium.dev/guides/apps/orders-with-lines/) says.

- The cart lives in the browser (`localStorage`) as product and quantity only. Prices are never
  kept or sent by the page: each line copies its price from the product, and the order adds them
  up.
- The cart and checkout pages show the quote's figures in the template's markup: each line's
  amount, the subtotal, the total. A quote fills in the columns the guest has not typed yet;
  older versions fill only text, not a choice, so send a value for a required choice column (the
  country) with the quote.
- On some databases a money figure comes back as a number (`50`), on others as a string
  (`"50.00"`). Read either, and format it with `formatTenantMoney` and the venue's currency.
- "Place order" sends the order with `expect` set to the total the guest was shown and the cart's
  retry key, then empties the cart and opens the thank-you page with the order's number.
- The template's ways to pay are a choice column on the order. Only the ones the shop takes without
  a card (a bank transfer, a cheque, paying on delivery) are in the entry's `writableValues`.

A coupon field works through the [Offers & gift cards](https://docs.adminium.dev/guides/add-ons/offers/) add-on: the order
table carries the `discountable@1` shape of [Offers shapes](https://docs.adminium.dev/reference/offers-shapes/) (a `codes`
table, a `discount` column on the order and its lines, the `adjust` rule), the app names `offers`
under `addOns.suggests`, and the typed code goes with the order as one more child list. The quote
says whether it stands. Without the add-on installed, an order that carries a code is refused
whole (`PUBLIC_WRITE_REFUSED`, with no reason given): when a quote with a code fails, say the code
cannot be used, and let the guest take it off and order without it.
