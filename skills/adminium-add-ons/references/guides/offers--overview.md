<!-- produced from apps/docs/src/content/docs/guides/add-ons/offers.md; do not edit -->

# The Offers & gift cards add-on

From Adminium 0.3.19, add-ons 1.0.9.

Offers takes money off an order by a rule you set, and keeps the money a customer has paid you in
advance: on a gift card, on a voucher, as credit. It works with no app installed: you can make a
discount, issue a card and look one up from its own screens. With an app, the order's own save asks
Offers what the reductions come to, and records what was used. If any part of that fails, the save
writes nothing.

Install it from **Add-ons**. It makes twenty tables under the name `offers_…` in the database you
choose, an **Offers** and an **Offers setup** section in the sidebar, and three roles. Whoever
installs it is given the manager role.
