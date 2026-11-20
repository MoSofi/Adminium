---
title: Take payments
description: Let customers pay an invoice or any other record online with Stripe or PayPal, or by hand. Who the seller is, how to set it up, what the customer sees, and how refunds and disputes work.
---

From Adminium 0.3.33, add-ons 1.0.13.

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

The Payment panel follows what a person may read of the record. Someone whose role reads the record
but not its total, or not what is due (a packer who sees an order's items and address, and nothing of
what it cost), gets no Payment panel on it and no paid or unpaid badge beside it in a list, and may
not record a payment by hand on it.

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
  recommends): **Download the app template**, then with the Stripe command-line tool run
  `stripe apps create key-app`, copy the template's `stripe-app.json` into the `key-app` folder,
  and run `stripe apps upload` there, once in your test account and once in your live account.
  Install the app and copy the key it shows under **View API keys**. Or **by hand in the Stripe
  dashboard**: create a restricted key with the access listed on the card (the card says where each
  one is on the Stripe form), and leave everything else at None. Only restricted keys (`rk_…`) are
  accepted.
- **The PayPal app.** Make a sandbox app for testing and a live app for real payments in the PayPal
  developer site, and paste their client id and secret.
- **The webhook.** Copy the address from the **Test webhook** card (or the **Live webhook** card
  when you go live), make the endpoint at Stripe or PayPal, tick the events the card lists (the PayPal
  form shows them by name, such as "Payment capture completed"; the card shows both), and paste the
  signing secret (Stripe) or the webhook id (PayPal). Each mode, test and live, has its own endpoint
  and its own secret.

A key is checked when you save it. If the service refuses it, the card says what it is missing.

### Test first

**Send a test payment** opens the pay page for a pretend invoice in a new tab. Pay it with the Stripe
test card or a PayPal sandbox buyer. The card then shows what the service took, whether the webhook
arrived, and what would have been recorded. **Nothing is written to your tables.**

Every test pay page also offers **the demo service**, which needs no account at all. Use it to try
the whole flow, refunds included, before you connect anything.

Test links open only for a signed-in person who may set up payments, on the address they are using.
A customer who gets one sees nothing.

A service is offered on a record's pay page only once at least one of its ways is switched on in
**Ways to pay**. The Setup card says so when none is.

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
here; until you choose one, they use this server's public address (**Address in email links** in
Senders). The preview shows the page as a customer sees it.

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
the record cannot be paid online. A [rehearsal's](#try-an-app-as-a-customer) email carries a test
link instead.

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

### From an app's own screens

An app whose payables you switched on may show **Pay now** on its own customer screens (an order,
a quote, a booking). Its **Pay now** opens the same pay page, and the pay page's **Back to …**
returns the customer to the app's screen. There the app asks Adminium how the payment stands and
says it in its own words: still being checked, paid, the bank confirming it, didn't finish, or the
time to pay ran out. The app is told that one word and nothing else of the payment: no amount, no
service and no card. While the app is switched off in Payments, its screens read as they always
did.

Switching an app on or off changes more than its screens, when the app says so in its manifest
(Adminium 0.3.62 and later):

- **What a customer can make.** An app that asks for payment up front (a hotel set to "ask guests to
  pay now") takes a booking that waits for its payment while it can take payments online, and books
  as it always did while it cannot — whatever the customer's browser sends. Nobody gets the rooms
  unpaid by calling the app's public address directly.
- **Which emails go.** An app may send one email while it takes payments online ("Pay for your
  order") and another while it does not ("We'll send an invoice"), each with its own subject and
  preview line. A mail that only makes sense with payments on is not sent while they are off.
- **What waits for money on its way.** An order whose customer is paying is not moved to "pay when
  you pick up instead" while the bank is still confirming the payment; the customer is told to
  wait.

### Try an app as a customer

Before you go live, walk an app's own checkout yourself. In **Studio → Payments → Apps that can take
payments**, **Try {app} as a customer** switches rehearsal on for you and opens the app's customer
screens on this server's address. You need the right to set up payments. Rehearsal works whether
or not the app is switched on, and ends by itself after four hours, or when you click **Stop
rehearsing** on the TEST band.

While it is on, for you alone:

- The app shows **Pay now**, and its pay page takes test payments only.
- Every row you make, on the app's customer screens or its staff screens, is sample data.
  **Remove sample data** takes it all away. A test payment is written into the app's tables like
  a real one, but only on such a row; a test payment never reaches a real order.
- The app's emails about those rows come to you, marked `[TEST]` in the subject, never to the
  address on the order. They carry what a customer's would (Adminium 0.3.63): the order's own link,
  and a test pay link that opens for you on this server's address. The test link is the one your
  checkout already opened while it works, else a new one for an hour.
- An email about a real row stays an ordinary email while you rehearse (Adminium 0.3.63). A note
  you add to a real order, or a message you queue about one, goes to the real customer as it always
  would, unmarked, with payments as they really are. Only a row you made in your rehearsal, and
  still sample data, sends its email to you.
- An email to you never carries the link of a row you did not make in your rehearsal, and a real
  customer's email never carries a test link.

## When a payment arrives

The service tells Adminium through the webhook, and Adminium also asks the service itself when a
customer comes back. If a webhook goes missing, a safety check finds the payment: every 15 minutes
while a payment is open, every hour while a bank is still confirming one.

The payment is written once, whichever of these finds it first. It is written with the person
**Online payment (Stripe)** or **Online payment (PayPal)** as the one who recorded it — each
service named as it spells itself. When the record is paid in full, its status is set as you
mapped it; an app may also have its record say how it was paid (a ticket order marked "paid
online"), written with the status by a payment made on the pay page, never by one recorded by hand.
For a live payment, a receipt email goes to the customer when the record has a customer email.

If the payment cannot be written (the amount differs from what is due, the invoice was voided, the
row is gone), nothing is refunded by itself. **Activity** shows it, the people who set up payments
are told, and a person decides. Usually that means a refund.

Every night Adminium checks the live payments of the last 30 days. If one's row is gone, voided, or
for another amount, it is flagged in Activity. This check never writes anything.

An app whose rows are keyed by a uuid gets a new key on every payment Adminium writes into it, on
every database: SQLite and MySQL keep such a key as text, and Adminium fills it as Postgres does
(Adminium 0.3.62; an app installed before that gains it with its next update).

## Refunds

Someone with **Give refunds** opens **Refund…** from a payment on the Payment panel, or from
Activity:

1. The amount (at most what is still refundable), a reason and an optional note.
2. One sentence that says what will happen. It cannot be undone. **Refund**.

The panel then shows the refund as requested, and as done when the service confirms it, with who
asked for it and why ("By Ana Ruiz · Duplicate") to people who may see payments or give refunds;
others who can read the record see the refund without them. A refund the service refuses says why. The amount refunded opens the balance again. The old pay link is not
revived; **Copy pay link** makes a new one. The record's status changes only through the
"refunded in full" value you mapped.

A refund made in the Stripe or PayPal dashboard is recorded too, as made at the service, and
flagged in Activity so you can check it.

In an app that keeps refunds as rows of its own (a ticket shop's refund list), the app writes the
row and Adminium sends the money and marks the row as asked, on its way, done or not sent. Each mark
counts as a change of the row: the app's own rules and emails follow it, so a "Refund sent" email
goes out once when the refund is done.

## Disputes

When a customer disputes a payment with their bank, the payment is marked **Disputed** and the
people who set up payments are told. Answer the dispute in the Stripe or PayPal dashboard. While it
is open, the payment cannot be refunded.

When the dispute ends, Adminium records how:

- **Won:** the payment says the dispute was won, and nothing else changes.
- **Lost:** the money went back to the customer. It is recorded on the payment as a line of its own,
  "Dispute lost — €120.00 returned to the customer", like a refund: the balance opens again by that
  amount (for a live payment), **Refund…** can give only what is left, the people who set up payments
  are told, and Activity flags it for a look. The invoice's status changes only through the
  "refunded in full" value you mapped.

A dispute you settle by refunding the customer (in the PayPal dashboard, for example) is the same
money as the lost dispute that follows it: it is counted once, whichever Adminium hears of first.
If a dispute recorded as lost is later reported won, the line comes back off: the money is counted
as yours again and the balance follows.

These notices go out in test mode too, marked "Test", so you can see them while you set up.

## Activity

**Studio → Payments → Activity** lists every payment and refund, test and live, with filters and a
CSV export. Rows that need a look are flagged, for example a payment that could not be written, a
refund made at the service, or a dispute. A flag can be marked as checked with a note.

## Card testing

Card testers try stolen card numbers on small payments to find the ones that still work. Adminium
guards every pay link: the customer passes a short check before each payment, a link takes at most
20 payments an hour and a network address 60, and five declined cards lock a link.

When an app's own screens start payments (an order a customer pays for at checkout), Adminium adds:

- **Its own link.** A payment started from an app's screens gets a link of its own, apart from the
  link you sent. Declines there never lock your link.
- **Declines per address.** An address with five declined cards within the hour gets no new
  checkout from an app's screens.
- **A pause.** When cards are declined from ten different addresses within the hour, payments
  started from apps' screens pause for an hour. The apps then offer their other ways to pay, links
  you send keep working, and the people who set up payments are told. **Resume** in Studio →
  Payments ends the pause sooner.

Adminium keeps a scrambled form of the address, never the address itself, and forgets it after
three hours.

Turn on your service's own checks too. On Stripe, Radar is on by default. With Radar for Fraud
Teams, a velocity rule such as `Block if :declined_charges_per_ip_address_hourly: > 3` stops a run
of declines from one address. Check the attribute in the Stripe rule tester before you save it.

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
