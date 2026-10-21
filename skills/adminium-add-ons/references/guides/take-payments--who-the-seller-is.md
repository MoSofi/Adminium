<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § Who the seller is; do not edit -->

# Take payments: Who the seller is

Adminium is software you run. **Your shop is the seller.** You open your own Stripe or PayPal
account, you make the key, and you are responsible for the payments you take and for your
customers' questions about them.

Adminium holds no payment account, no key of its own and no money, runs no central service, and
processes nothing for you. The add-ons are code you install. Your keys stay on your server.

Customers type their card details only on the Stripe or PayPal page. Adminium sends them there
with a full redirect and never sees a card number. Under PCI DSS your shop is still the merchant
and completes its own self-assessment (usually SAQ A for a full redirect). This page is not legal
advice: check what applies to your shop.
