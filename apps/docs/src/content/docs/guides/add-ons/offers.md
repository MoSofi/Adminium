---
title: The Offers & gift cards add-on
description: Discounts, discount codes, vouchers, packs and gift cards — worked out and recorded in the same save as the order they belong to. What it does, who may do what, and how an app builds on it.
---

From Adminium 0.3.19, add-ons 1.0.9.

Offers takes money off an order by a rule you set, and keeps the money a customer has paid you in
advance: on a gift card, on a voucher, as credit. It works with no app installed: you can make a
discount, issue a card and look one up from its own screens. With an app, the order's own save asks
Offers what the reductions come to, and records what was used. If any part of that fails, the save
writes nothing.

Install it from **Add-ons**. It makes twenty tables under the name `offers_…` in the database you
choose, an **Offers** and an **Offers setup** section in the sidebar, and three roles. Whoever
installs it is given the manager role.

## Discounts

A discount gives one of five things:

- **Percent off** or **amount off** — off the whole order, or only off the items you choose.
- **Fixed price** — the chosen items sell for that price each. An item that already costs less
  keeps its price.
- **2 for 1 and similar** — buy so many of the chosen items, the cheapest one is on us.
- **Price by quantity** — the more of the chosen items in one order, the bigger the percent off.
  The highest step reached counts.

It starts **by itself** when an order fits, **with a code** the customer types, or **only when
staff give it**. You can hold it to dates, days of the week, hours, a minimum spend or quantity, a
customer group, a first order, a number of uses in all and per customer, and an amount given in
all.

A group, "first order only" and "uses per customer" need to know who is buying. They apply to a
signed-in customer, or to one your staff name on the order. A guest does not get them.

**Which discounts apply together.** A customer gets every discount marked "Can be combined", one
code, and otherwise the best single one. When two codes are typed, the better one is used and the
customer is told. A discount is worked out in this order: fixed prices, prices by quantity, 2 for
1, percents, amounts. A percent is taken off what is left after the reductions before it.

**Used up** is shown on a discount whose every use is taken. It is still active: raise the limit
and it applies again.

**Try it**, beside the editor, tries the discount you are editing on a saved order, with a code
and as a guest or a signed-in customer. Every figure in it is worked out by Adminium exactly as a
save would work it out. It also lists each other discount that did not apply, and why.

## Codes

A discount can have several codes, each with its own limit and last day. A code is a word of
letters and numbers. When you type one, Adminium tells you if it is taken, and warns when it reads
like another code (AUTUMNS and AUTUMN5). A code cannot begin with `GC`, `VC` or `PK`: those begin a
gift card, a voucher and a pack.

## Vouchers and packs

A **voucher** is worth an amount, a percent, or one named thing ("One massage, 60 minutes"). It is
for a named person or for whoever holds it. A voucher for a named person is checked against who is
buying.

A **pack** is so many uses of one thing: ten classes, five car washes. Each use is recorded, and a
use given back (a cancelled booking) can be used again.

A **batch** makes many vouchers at once, up to 5,000, for a leaflet or a mailing. A manager can
download the codes as a CSV file. The download is written to the audit log.

Adminium makes every voucher's code: twelve characters, shown **once** to the person who made it.
After that, staff see the last four. A manager can print it again.

## Gift cards and credit

A **gift card** holds money. It is sold on an order line or issued by hand, topped up, spent, and
— where a payment is refunded — given its money back. Every change is a row in its history, with
what was on the card afterwards. A card never goes below nothing: when twenty tills spend the same
card at the same moment, the card pays what it holds and the rest are refused.

- A card sold on an order is **inactive** until the order is paid.
- A card cannot pay for a gift card.
- A refund of a card payment goes back to the same card, never more than that payment took.
- **Expiry** is off unless you set a number of months in Settings. Each top-up starts the months
  again, and the holder is reminded before the last day.

**Credit** is money you owe a customer, kept under their email address. It has no code. A manager
gives credit from **Look up**; staff use it by naming the customer on the order.

A gift card's code begins `GC-` and has twelve characters in three groups of four. It is shown once
when the card is issued and is in the email the card is sent with. The sample data's addresses end
in `.example`; Adminium never sends to such an address.

## Look up

Type or scan a code, or type a customer's email for credit. Look up shows what it is, what is left,
when it must be used by, and what happened to it. From there a manager can top a card up, adjust
it, cancel it or give credit, and anybody at the desk can send it again or record a voucher's use.

What you typed stays on that screen. It is never put in an address or kept in the browser.

## Emails and printing

- A gift card is emailed to its recipient when it becomes active, or on the morning of the day you
  pick. The email has the code, a QR code of it, the balance, and — where an app has a balance page
  — a button to see the balance.
- A voucher made for a named person is emailed to them. Credit gets an email with no code in it.
- A card with no email address is not sent: the Messages list shows one skipped row for it.
- **Send again** sends another email each time it is pressed, to the address on the card.
- **Print** draws a card or a voucher on A6 paper, or on a strip of receipt paper. The first print
  shows the amount; a later print shows the balance and the day it was printed. A printed card is
  not stored anywhere.

You can change the emails' words under **Email templates**.

## Offer rules

**Offer rules** lists what your tables have to do with offers: which table takes discounts, which
takes a gift card as payment, which sells or tops up a gift card, which sells a voucher. An app
that builds on Offers brings its rules with it; they are shown locked and can be switched off.

For a table of your own, **Add a rule** asks which table, which columns hold the price, the
quantity and what is sold, and when a row is final. Where the table has no column for a part,
"Make it" lets Adminium add what is missing; it first lists what it will add.

Changing a rule changes what a table means, so it needs the right to change the schema
(`system:schema:remap`), and "Make it" also needs the right to add columns. The manager role alone
reads the rules and cannot change them.

## Staff discounts

A reduction staff give by hand is recorded with a **reason** from your list (Damaged, Goodwill…)
and the name of who gave it. **Staff limits** says the most each role may give, as a percent and
as an amount, and whether it may give an item away. With no limit set for a role, that role gives
nothing.

## Roles

| Role | May |
|---|---|
| Offers manager | everything: discounts, codes, issue and change cards, batches and their files, credit, settings |
| Offers desk | look up; issue a voucher; record a voucher's use; send a card or voucher again; reads no whole code and no balance history note |
| Offers viewer | read discounts, uses and the Overview; reads no code and no customer address |

A limit on a role holds only while it is a person's only way in. Somebody who also has a role that
reads the same table without that limit sees what the limit hides. Give the desk one role, not two.

## What a customer can ask without signing in

Two things, both read-only, both about one gift card:

- On an app's balance page, a customer types their card's code and is told its balance and its
  last day. A wrong code, a cancelled or expired card and a card that does not exist all get the
  same empty answer, so nobody learns whether a card exists. Five wrong codes a minute are all a
  visitor gets.
- The link in a gift card's email opens that one card's balance.

Nothing else of Offers is public. A code typed at checkout is part of the order's own save.

## Sample data

**Add sample data** on the Overview adds a month of history: six discounts with 126 uses, a leaflet
batch of 200 vouchers, two packs, ten gift cards and two credits. Nothing in it is sent to anybody.
You can remove it again; rows you changed can be kept.

## For app developers

An app says in its manifest which of its tables is an order whose price may be lowered
(`adjust`), which is a payment a card may make, and which is a line that sells a card or a voucher
(`postings` into the ledger `offers` / `value`). The four parts an app spells out, with the columns
each needs, are in [Offers shapes](/reference/offers-shapes/). An app names the add-on under
`addOns.suggests` or `addOns.requires`, and works without it where it only suggests it: the rule
is live only while Offers is installed and switched on for the app.
