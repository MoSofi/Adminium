<!-- produced from apps/docs/src/content/docs/guides/add-ons/offers.md § For app developers; do not edit -->

# The Offers & gift cards add-on: For app developers

An app says in its manifest which of its tables is an order whose price may be lowered
(`adjust`), which is a payment a card may make, and which is a line that sells a card or a voucher
(`postings` into the ledger `offers` / `value`). The four parts an app spells out, with the columns
each needs, are in [Offers shapes](https://docs.adminium.dev/reference/offers-shapes/). An app names the add-on under
`addOns.suggests` or `addOns.requires`, and works without it where it only suggests it: the rule
is live only while Offers is installed and switched on for the app.
