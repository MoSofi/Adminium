---
title: The Inventory add-on
description: Stock by place and by batch — received, counted, moved and ordered — and taken by the rows of your own tables in the same save. What it does, who may do what, and how an app builds on it.
---

From Adminium 0.3.18, add-ons 1.0.8.

Inventory keeps count of what you hold: how many of each item, in which place, in which batch, and
what it cost. It works with no app installed. With an app, a row of the app's own table (an order
line, a treatment, a room night) takes stock in the same save that makes the row.

Install it from **Add-ons**. It makes thirty tables under the name `inventory_…` in the database you
choose, a **Stock** and a **Stock setup** section in the sidebar, and three roles. Whoever installs
it is given the manager role.

## Places, stock and batches

- A **place** is where stock is kept: a shop floor, a back room, a van. A place that does not count
  as available ("At the laundry", "Damaged") holds stock that nobody can sell or use from.
- **Stock by place** has one row for an item in a place: on hand, held, on order, available, its
  reorder level and the quantity to reorder. The state beside it reads In stock, Low, On order or Out.
- An item **kept in batches** has a level for each batch in each place, with the batch's code and
  the day it expires. Stock is taken from the batch that expires first. A batch past its date is
  passed over: when nothing else is left, the save is told the stock has expired.
- Every change is a **movement**: received, sold, used, moved, written off, a count difference.
  Movements are never edited. A mistake is undone by a second movement that says so.

Costs are a moving average for each item: a receipt at a new cost moves the average, a use takes
stock out at the average of that moment.

## Receiving

**Receive** takes a delivery, with a purchase order or without one. Find an item by name or code, or
scan its barcode (a scanner that types like a keyboard; the camera is not used). Type the packs or
the units, the batch and its date where the item is kept in batches, and post. A delivery against an
order shows what is still to come; receiving part of it leaves the order "Part received".

A posted receipt can be undone line by line while its order is still open, or sent back to the
supplier. Both write movements; nothing is deleted.

**Opening stock** is for the day you start: type the quantities you hold, or load them from a CSV
file (one row for each item, or for each batch of an item). It posts one receipt for a place. A
file of more than 1,000 lines is posted as several receipts, one after another.

A receipt's place, a transfer's two places and a count's place are fixed once the document is
saved. To use another place, start another document.

## Counting

**Counts** starts a count of a place: everything in it, one category, what has not been counted for
a while, or what is marked to be counted. Each line shows what the books expect. When you type what
you found, the line remembers what the books said at that moment, so stock sold while you were
counting is not counted as lost. Posting writes one "count difference" movement for each line that
differs. A manager can undo a posted count.

## Transfers

**Transfer** moves stock from one place to another: two movements for each line, one out and one
in, under one number. Linen sent to a laundry and brought back is two transfers.

## Purchase orders

A purchase order is for one supplier and one place, with up to 50 lines in packs. From its page:

- **Send to supplier** emails the order to the address on it, in the language you set for
  suppliers, and puts its quantities on order. With the Invoices & Receipts add-on 1.0.8 or later
  installed, a PDF of the order is attached.
- **Mark as sent, no email** does the same and emails nobody.
- **Receive** opens the Receive screen for it.
- **Close: the rest will not come** takes what is still on order off. **Reopen** puts it back.
- **Cancel order** keeps the order on record as cancelled.

Whether the email and the PDF show costs is a setting, and can be changed on each order.

Supplier addresses in the sample data end in `.example`, a name no mail server answers for. Adminium
never sends to such an address.

## The four automations

Inventory ships four automations. You find them under **Automations** and can switch each on or
off, or change what it does.

| Automation | Starts as |
|---|---|
| Low stock: draft an order and tell the stock manager | on |
| Expiring within 30 days: tell the stock manager | on |
| Send draft orders at 17:00 | off |
| Send an order 15 minutes after its last line | off |

"Low stock" runs when an item falls to its reorder level; after a save in the dashboard it runs
about a minute later. It puts
the item on a draft order for its first-choice supplier. If another place holds enough, or no
supplier is set, it drafts nothing and tells the manager why. The two daily automations run on the
time zone the server had when Inventory was installed.

## Stock rules

**Stock rules** lists the rules that take stock when a row of a table changes: "when an order line
is created, take what it uses", "when a booking is cancelled, put it back". An app that builds on
Inventory brings its own rules; you can add rules for your own tables there too. Switching a rule
off stops it taking stock from that moment on. Rows saved while it was off are not caught up later.
Changing a rule changes what a table means, so it needs the right to change the schema
(`system:schema:remap`); the manager role alone reads the rules and cannot change them.

## The Stock tab

On a record of a table that a rule reads, a **Stock** tab lists what one of that record uses: an
item or a kit, how many, for each unit, night or guest, and from which place. A dish's tab holds its
ingredients, a treatment's its supplies. A **kit** is a list of items used together.

## Roles

| Role | May |
|---|---|
| Inventory manager | everything: settings, items, costs, orders, undo, rules |
| Inventory clerk | receive, transfer, type a count (a manager posts it), record a use; reads no cost and no supplier contact |
| Inventory viewer | read everything but the settings, costs included; changes nothing and opens no screen that receives, moves or sets up stock |

A limit on a role holds only while it is a person's only way in. Somebody who also has a role that
reads the same table without that limit sees the costs. Give a clerk one role, not two.

## When Inventory cannot answer

A save that takes stock asks Inventory's own code what to write. While it cannot be asked (the
add-on is being updated, or was switched off), an item set to "Stop when out" stops the save, for
staff too: nothing may be sold that cannot be counted. Every other save goes through and is marked
as waiting. **Record them now**, on the Stock rules page, posts the waiting rows once Inventory
answers again.

## Sample data

**Add sample data** on the add-on's page adds a month of stock for a small business: forty items in
six places, three suppliers, three purchase orders, a count, two transfers. It is history, with
nothing posted while it loads, and every document in it can be undone like one of your own. **Remove
sample data** takes out the rows you have not changed. The units, the reasons and your settings are
never part of the sample.

## For app builders

An app's table takes stock through a posting into Inventory's ledger `stock`
(see [Rows that post into a ledger](/guides/apps/postings/)). Five actions are for a host's rows:

| Action | For | What it writes |
|---|---|---|
| `use` | a row whose record has a Stock tab (a line of a dish, a treatment) | takes what the linked items and kits say, for the row's quantity |
| `hold` | the same, before the sale is final | holds the stock; a later `use` takes what was held |
| `use-item` | a row that names an item itself | takes that item |
| `return` | a row that gives stock back | puts it on the shelf again, or into another place |
| `adopt` | a row that should be a stock item itself (a product, a dish) | makes an item with the row's name and links the row to it; nothing when the row already has one |

Two ids answer "is there enough?" before a save, for a public page or a till
(see [Building on an add-on](/guides/building-on-an-add-on/)): `stock`, for a row with a Stock tab,
and `item`, for an item. Each answers yes or no and, when you set "Show customers what is left
below" in the settings, how many are left under that number.

An app's own sample data may add rows to Inventory's catalogue (items, kits, places) and name the
rows of Inventory's sample by their labels: `item:<SKU>`, `kit:<name>`, `place:<name>`,
`batch:<code>`, and the seeded `unit:<code>` and `reason:<name>`.
