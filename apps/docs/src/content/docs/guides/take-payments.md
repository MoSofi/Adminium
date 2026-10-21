---
title: Take payments
description: Let customers pay an invoice or any other record online with Stripe or PayPal, or by hand. Who the seller is, how to set it up, what the customer sees, and how refunds and disputes work.
---

From Adminium 0.3.32, add-ons 1.0.13.

A customer opens a pay link, pays on the Stripe or PayPal page, and the payment is written down
against the record it was for, once. The same record also takes payments that arrive another way,
such as a bank transfer or cash, which staff record by hand.

## Who the seller is

Adminium is software you run. **Your shop is the seller.** You open your own Stripe or PayPal
account, you make the key, and you are responsible for the payments you take and for your
customers' questions about them.

Adminium holds no payment account, no key of its own and no money, runs no central service, and
processes nothing for you. The add-ons are code you install. Your keys stay on your server.

Customers type their card details only on the Stripe or PayPal page. Adminium sends them there
with a full redirect and never sees a card number. Under PCI DSS your shop is still the merchant
and completes its own self-assessment (usually SAQ A for a full redirect). This page is not legal
advice: check what applies to your shop.

## What you need

- A server customers can reach: a public `https` address. A server on your own network, a server
  without https, and the desktop app can still record payments by hand, but cannot take payments
  online. See [Payments on your server](/self-hosting/payments/).
- One of the payment add-ons, installed from **Add-ons**:
  - **Card payments** connects to Stripe: cards, wallets and the other ways your Stripe account has
    switched on.
  - **Wallet payments** connects to PayPal.
- A person with the **Set up payments** permission.

## Who may do what

| Permission | What it allows |
|---|---|
| **Set up payments** | Everything on **Studio → Payments**: keys, webhooks, ways to pay, what can be paid, the pay page. Open test links. |
| **See payment activity and export it** | The **Activity** tab, read-only, and its CSV export. |
| **Give refunds** | Refund a payment from a record's Payment panel or from Activity. Only a signed-in person, never an API key. |

Making pay links and recording payments by hand follow the record: whoever may edit the record may
do it.

## Set it up

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

## On a record

A payable record has a **Payment panel**:

- **Balance due**, and every payment taken, with how and when, and who recorded it.
- **Copy pay link** makes the record's pay link. A record has one current link: making a new one
  ends the old one. A link works for 30 days, and stops when the record is paid, voided or deleted,
  or when you **Revoke** it.
- **Email pay link** sends the link to the email address the record holds, in a built-in email.
- **Record a payment** records one that arrived another way: the amount (the balance, to start
  with), the way it was paid, the date and a note. A card payment on a standalone terminal takes the
  approval code and the last four digits. A full card number is refused in every payment field.

A draft invoice cannot be paid: "Send the invoice first."

### In emails and printed invoices

An email template can use `{{pay_url}}`, and an invoice made with the Invoices add-on can print its
pay link and a QR code for it. Both are the record's current live link. They are left empty when
the record cannot be paid online.

## What the customer sees

The pay page shows the shop's name, logo and contact, the invoice or record number, the amount due
and the due date, and the lines when you switched them on. It never shows the customer's name,
address or email, or their past payments: links get forwarded. A partly paid record says only how
much is already paid.

The customer chooses a way to pay and goes to the Stripe or PayPal page. When they come back, the
page says whether the payment arrived. A payment the bank still has to confirm, such as a SEPA
Direct Debit, says so and asks them not to pay again.

The pay page speaks the customer's language. It is in the eight languages Adminium speaks. The
Stripe page does not offer Arabic.

## When a payment arrives

The service tells Adminium through the webhook, and Adminium also asks the service itself when a
customer comes back. If a webhook goes missing, a safety check finds the payment: every 15 minutes
while a payment is open, every hour while a bank is still confirming one.

The payment is written once, whichever of these finds it first. It is written with the person
**Online payment (Stripe)** or **Online payment (PayPal)** as the one who recorded it. When the
record is paid in full, its status is set as you mapped it. For a live payment, a receipt email
goes to the customer when the record has a customer email.

If the payment cannot be written (the amount differs from what is due, the invoice was voided, the
row is gone), nothing is refunded by itself. **Activity** shows it, the people who set up payments
are told, and a person decides. Usually that means a refund.

Every night Adminium checks the live payments of the last 30 days. If one's row is gone, voided, or
for another amount, it is flagged in Activity. This check never writes anything.

## Refunds

Someone with **Give refunds** opens **Refund…** from a payment on the Payment panel, or from
Activity:

1. The amount (at most what is still refundable), a reason and an optional note.
2. One sentence that says what will happen. It cannot be undone. **Refund**.

The panel then shows the refund as requested, and as done when the service confirms it. A refund
the service refuses says why. The amount refunded opens the balance again. The old pay link is not
revived; **Copy pay link** makes a new one. The record's status changes only through the
"refunded in full" value you mapped.

A refund made in the Stripe or PayPal dashboard is recorded too, as made at the service, and
flagged in Activity so you can check it.

## Disputes

When a customer disputes a payment with their bank, the payment is marked **Disputed** and the
people who set up payments are told. Answer the dispute in the Stripe or PayPal dashboard. While it
is open, the payment cannot be refunded. If the dispute is lost the money goes back to the
customer, but the invoice is not changed by itself.

## Activity

**Studio → Payments → Activity** lists every payment and refund, test and live, with filters and a
CSV export. Rows that need a look are flagged, for example a payment that could not be written, a
refund made at the service, or a dispute. A flag can be marked as checked with a note.

## Stopping

The service's card menu has two ways out:

- **Stop new payments.** No new payments start. Payments already on their way still finish, and
  refunds still work.
- **Disconnect.** Removes the keys from this server. Adminium can then no longer finish payments or
  give refunds.

## What it does not do

- It does not save cards, take subscriptions, or put the payment form on your own page.
- Cloud card terminals (Stripe Terminal, Square) are not supported yet. Record a terminal payment by
  hand.
- On Stripe, the three-decimal currencies (BHD, JOD, KWD, OMR, TND) cannot be paid online yet. Their
  ways to pay by hand still work.

## See also

- The step-by-step setup guides for each service, with what each key and webhook needs:
  [Card payments](https://github.com/Adminiumjs/add-ons/tree/main/packages/payments-stripe#readme) and
  [Wallet payments](https://github.com/Adminiumjs/add-ons/tree/main/packages/payments-paypal#readme).
- [Payments on your server](/self-hosting/payments/): the pay address, the webhook, proxies and
  restores.
- [Behind a reverse proxy](/self-hosting/reverse-proxy/).
