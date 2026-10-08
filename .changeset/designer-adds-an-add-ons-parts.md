---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Adminium Designer adds an add-on's parts to tables the app already has. For a shape whose parts carry a rule (an order that takes discounts and codes, a payment a gift card makes, a line that sells a card or a voucher), `build_on_shape` takes the app's own table for each part, adds the columns the shape needs and its rule under the app's names, at the app's own moments, with the requirement and the first Adminium the add-on runs on; nothing is written when the app's own check refuses the result. The app check holds a price rule to the add-on it asks, and no longer asks a rule to map an amount the ledger decides itself. A request for discounts, coupons, vouchers, gift cards, store credit or loyalty brings the add-ons skill and the Offers guide into the Designer's prompt, and the architecture diagram says which table an add-on prices.
