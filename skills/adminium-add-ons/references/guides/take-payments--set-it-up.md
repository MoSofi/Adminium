<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § Set it up; do not edit -->

# Take payments: Set it up

Open **Studio → Payments**. The page has five tabs: **Setup**, **Ways to pay**, **What can be
paid**, **Pay page** and **Activity**.

### Setup

**Can customers reach this server?** comes first. When something is missing it names it and the
fix, for example "Pay pages need https."

Then each payment service has a card with a checklist: **Test key**, **Test webhook**, **Send a
test payment**, **Live key**, **Live webhook**, **First live payment arrived**. Your progress is
kept.

- **The Stripe key.** Choose one of two ways. **With your own Stripe App** (the way Stripe
  recommends): **Download the app template**, upload it once to your test account and once to your
  live account with the Stripe command-line tool, and copy the key it makes. Or **by hand in the
  Stripe dashboard**: create a restricted key with the access listed on the card, and leave
  everything else at None. Only restricted keys (`rk_…`) are accepted.
- **The PayPal app.** Make a sandbox app for testing and a live app for real payments in the PayPal
  developer site, and paste their client id and secret.
- **The webhook.** Copy the webhook address from the card, make the endpoint at Stripe or PayPal,
  tick the events the card lists, and paste the signing secret (Stripe) or the webhook id (PayPal).
  Each mode, test and live, has its own endpoint and its own secret.

A key is checked when you save it. If the service refuses it, the card says what it is missing.

### Test first

**Send a test payment** opens the pay page for a pretend invoice in a new tab. Pay it with the Stripe
test card or a PayPal sandbox buyer. The card then shows what the service took, whether the webhook
arrived, and what would have been recorded. **Nothing is written to your tables.**

Every test pay page also offers **the demo service**, which needs no account at all. Use it to try
the whole flow, refunds included, before you connect anything.

Test links open only for a signed-in person who may set up payments, on the address they are using.
A customer who gets one sees nothing.

### Go live

When the live key works, **Turn on live payments**. From then on customers pay real money. Every
test link stops working, and test pay pages still open are ended. The card shows when the first
live payment arrived. Until a live webhook event has arrived, Adminium checks with the service more
often.

### Ways to pay

The ways a customer sees on the pay page:

- **Online:** **Add the ways {service} has switched on** lists what your Stripe or PayPal account
  offers. The Stripe page itself decides which of its ways each customer sees.
- **By hand:** **Bank transfer** (one account per currency, shown on the pay page with copy
  buttons), **Cash on delivery**, or another way you name. The customer pays outside Adminium, and
  staff record the payment when it arrives.

Each way can be limited to countries, currencies or tables. **What a customer sees** shows the pay
page for a customer you pick, so you can check your rules.

### What can be paid

Choose the tables whose rows customers may pay, and for each one:

- the columns for the number, the amount and the currency, and whether the amount counts whole
  units or cents (12000 is twelve thousand, or one hundred and twenty);
- where payments are written. **Adminium keeps the payments**: each payment is recorded against
  its row and your tables stay as they are. Or **this table has its own payments table**: each
  payment is written as a row in a table you choose, with a reference column that is unique, so a
  payment is never written twice;
- optionally, a status column, and the values it takes **when it is paid in full** and **when it
  is refunded in full**.

A table built on the Invoices add-on's invoice shape is recognised and needs no setup. Its newer
version takes online payments; the first version takes payments recorded by hand only. Invoices
made on the Invoices add-on's own page can be paid too, once they name their currency's
three-letter code.

### Pay page

**What customers see** on every pay page: the shop's name, logo and contact, its country, and
whether to show the invoice's lines. **Where customers pay** chooses the address in every pay link:
your staff address or one of your customer addresses. Pay links always use the address you choose
here. The preview shows the page as a customer sees it.
