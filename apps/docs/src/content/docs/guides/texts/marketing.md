---
title: Marketing texts
description: Send offers by text to the people of an app who agreed to them. Who it can reach, double opt-in in Germany, countries and senders that cannot take marketing, sending hours and a run's results.
---

From Adminium 0.3.76.

A marketing text is an offer: "Autumn stays, 15% off when you book direct." It needs more than a
service text. The person must have agreed to **marketing texts** on that exact number, and the text
must be one they can stop by replying STOP.

This is not legal advice. Check the consent wording and the countries you text with someone who
knows the law where your customers live.

## What you need

- Texts set up, from a **number**, on a server with a public `https` address that receives STOP
  replies. See [Set up texts](/guides/texts/).
- The **Manage server settings** permission, as for e-mail campaigns. Every send needs a
  signed-in person. An API key cannot send marketing texts.
- An app that declares a table of people with a mobile number column, and a text template.

## Send a marketing text

Open **Studio → Texts → Marketing**.

1. Choose the **template**, the **people** (an app's table of people, or a saved view of it) and
   **when**: now, or at a time.
2. Read **who it reaches**. The dialog counts who can get the text, and each group who cannot,
   with the reason. **See who** lists the people of a group. Nothing there lets you override a
   refusal.
3. Send. The words of every language of the template are frozen as they are now. Editing the
   template later does not change this run.

The people are read as you read them: a row, a table or a mobile column your role does not show you
is not yours to text. This is asked again when the run starts and at every batch.

A template can read the table's columns you see in clear, and `{{name}}`, `{{first_name}}` and
`{{business}}`.

## Who never gets one

- **Anyone without a marketing yes to texts on that number.** An e-mail yes, a newsletter yes and
  the "existing customers" rule for e-mail do not count. A yes comes only from the person's own
  tick on a form, or from a named staff member who records it with the words the person was shown.
- **A person a lead finder found**, whatever the log says. A bought or imported list never counts
  either: an import records no yes.
- **Anyone on the do-not-text list**, a number that cannot take a text, sample rows, and the second
  row holding the same number.
- **People in the United Arab Emirates, Egypt, Saudi Arabia and Taiwan.** Nobody there can reply
  STOP. Service texts still go there. **Mainland China (+86)** gets no texts at all.
- **Germany, until the person confirms.** See below.

The whole run is refused when the sender is a **sender name** (it cannot receive STOP: add a number
for that country in your provider's account), or when this server **cannot receive STOP**.

## Double opt-in in Germany

In Germany a marketing yes counts only once the person has confirmed it. The person is never asked
to reply YES by text:

- **With an e-mail address:** Adminium mails them a link, "Confirm marketing texts". The page shows
  their number, masked, and one **Confirm** button. Nothing happens until they press it. At most one
  mail goes to a number in a day. A mail that cannot be sent cancels the request.
- **Without one:** a named staff member records that the person confirmed in person or on paper.

A confirmation counts only while the yes still stands: a later no, a STOP or a changed number ends
it. The consent log keeps the confirmation beside the original yes.

## When they go

Marketing texts go only from **09:00 to 20:00, Monday to Saturday**, on the person's clock. In a
country with several time zones, they go only when the window is open in all of them. A run queues
its texts at once, and each waits for the window. A run can read **done** while some of its texts
still wait. **Cancel** still stops those.

A run counts against the [daily limit](/guides/texts/#daily-limit-and-sending-hours). When the day is
full, it waits until the next day and goes on by itself.

## A run's results

A run shows how many people it reached, how many texts were delivered, failed or were skipped (by
reason), and how many people opted out after it.
