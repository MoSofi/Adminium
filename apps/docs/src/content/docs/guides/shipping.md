---
title: Ship parcels
description: Buy real carrier labels through your own Shippo account, inside your own country. Setting it up, who may do what, refunds, tracking and what is shared.
---

From Adminium 0.3.72.

Maker Shop, Print Shop and Online Shop can buy a real carrier label for an order through the
**Shippo** add-on. You use your own Shippo account: Shippo bills you for each label, and any refund
is between you, Shippo and the carrier. Adminium is not a party to that payment.

This release ships **inside the shop's own country**. A label to any other country is refused with
a plain message. Online Shop ships inside the United States.

The **DHL** add-on is a demo carrier. It lets you practise the flow with a sample label and books no
real parcel.

## Set it up

1. Install the Shippo add-on and attach it to the app.
2. Open **Shipping** in the Studio (`/studio/shipping`). You need the right to manage shipping.
3. Pick the app, paste a Shippo key and press **Check**. Start with a test key.
4. Choose the label size, and set spending limits if packers will buy labels.
5. Copy the webhook address into your Shippo settings. It is shown in full once, then masked.
6. In the shop, fill in **Ship from**. The phone can wait, but no label can be bought without it.

With a **test key**, a label reads SAMPLE. It cannot be handed over, and nothing reaches the customer.

## Who may do what

Each app install has three shipping rights on the **Roles** page: **book**, **cancel** and
**customs**. When you first install an app, a card lets you untick them for each role. An install
that gives no answer grants none of them.

Someone who cannot see prices can still book inside their limits. The rates and the label then show
no money.

## Buying a label

Rates come from your Shippo account for one parcel at a time. Buying is safe to repeat: a second
press, a reload or a server restart produces one shipment. If the carrier does not answer, the
purchase reads **unknown** and blocks another one until someone has checked it.

The customer hears nothing when a label is bought. They are told when someone presses **Handed
over**, and the mail names the real carrier and tracking number.

## Refunds

You can request a refund for 30 days after buying the label.

- A refund can take up to 14 working days.
- The carrier can refuse it, for example if the label has already been scanned.
- A label with a refund requested must not be used. Destroy any printed copy.

## Moving back or cancelling an order

Moving an order back or cancelling it does not refund its label. If the order holds a live paid
label, Adminium stops the move and asks what you want to do:

- **Request the refund, then move the order.**
- **Keep the label and move the order.** The label stays paid for.
- **Go back.** Nothing changes.

Only someone with the cancel right can choose the first two. A customer's own page is told only to
contact the shop.

## Tracking

Tracking updates arrive through the webhook. **Refresh** asks about one parcel and **Refresh open
parcels** asks about all of them. Adminium does not check tracking in the background. Tracking never
moves an order by itself.

**Needs attention** lists the labels that need a person, with unknown purchases first.

## Return labels

In Online Shop, the owner can buy a return label on an approved return. It runs from the customer to
the shop.

## What is shared and kept

To buy a label, Adminium sends Shippo the sender and recipient names and addresses, and the parcel's
size and weight. A phone number is sent only when the carrier needs it. Shippo passes what the
carrier needs to the carrier you chose.

A booking stores a hash of the address, never the address itself. Label files are deleted 90 days
after delivery. A label that was never delivered goes 90 days after its last state: a settled refund,
the last tracking event, or the purchase if it was never handed over. Erasing a person also deletes
their label files. See [A person's data](/guides/email/privacy/).
