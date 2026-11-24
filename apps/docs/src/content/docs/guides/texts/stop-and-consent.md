---
title: Consent, STOP and the do-not-text list
description: Who may be texted, how a person agrees and stops, the one confirmation of a STOP, the do-not-text list, and erasing a person by phone number.
---

From Adminium 0.3.76.

A text goes only to a person who agreed to it and has not asked to stop. Adminium checks both for
every text, at the moment it is sent.

## Agreeing to texts

Agreeing to texts is its own answer. **Agreeing to e-mail never counts as agreeing to texts**, and
the "existing customers" rule for e-mail does not apply to texts.

There are two kinds of yes, kept apart:

- **Service texts:** about something the person booked or bought, such as a reminder or "your order
  is ready".
- **Marketing texts:** offers. See [Marketing texts](/guides/texts/marketing/).

A person agrees with a **box on an app's form**, beside the e-mail box and never the same one. It
starts unticked, and nobody is refused a booking or a sale for leaving it so. The consent log keeps
the sentence they saw, its version and language, and when they ticked it.

A yes is for one exact number. If the number on a person's row changes, the new number needs a new
yes, because numbers get passed on to new owners. A no covers every number the row ever had.

A person who texted the business in the last seven days has asked for an answer, so a service text
that answers them needs no yes of its own. A STOP still refuses it.

## STOP

A person can reply **STOP** to any text from a number. Adminium reads every reply itself, so these
all work:

- the US opt-out words: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPT OUT and OPTOUT, in
  any case;
- longer forms such as "STOP PLEASE" or "Stop texting me";
- local words in each language Adminium speaks, such as "ABMELDEN", "ARRÊT", "AFMELD", "ODHLÁSIT",
  "إيقاف" and "退订".

A word counts only when it is the whole message. "I will stop by at 3" is an ordinary reply.

A STOP puts the number on the do-not-text list at once. From then on **no text of any kind** goes to
it from this business, service texts included, from any of its senders.

### The one confirmation

After a STOP, the person gets **one** plain text, in the language of the word they used (or the
business's language for a word every language shares): "You are unsubscribed and will get no more
texts from this business." It asks no question and offers nothing. It is sent only within five
minutes of the STOP. Twilio and Telnyx answer their own standard words themselves, so Adminium
answers only the words they do not catch.

### START and YES

**START** lifts the provider's block and takes the number off the list, but it is **not a yes**.
The person still has to agree again before any text goes. START lifts only a stop the person made
themselves, by STOP or with the provider: a stop staff recorded for them stays. A YES reply never
lifts a stop in Adminium, so no template may ask anyone to reply YES.

### A sender name

A text from a sender name cannot take a reply. It ends with your phone or e-mail instead, and the
person asks you. Record their request on the do-not-text list.

## The do-not-text list

**Studio → Texts → Do-not-text list** shows every stopped number, why and since when:

- **Replied STOP**;
- **Reported by the provider**, when Twilio or Telnyx says the person opted out with them;
- **Asked the business**, recorded by a named staff member;
- **Erased person**, kept as a hash only, with no number, so they are never texted again.

**Record a stop request** is for someone who asked you by phone, by e-mail or in person. It takes
effect at once, for every text from this business, and is recorded under your name. No confirmation
text goes, because the person asked the business directly.

Only the Super Admin can take a number off the list, and only when the person has agreed again.
Taking them off does not record a yes. An erased person cannot be taken off.

People with **Set up text messages** or **Find, download and erase a person's data** can read the
list and record a request.

## Erasing a person

Erasing a person from **A person's data** also erases what Adminium holds about their phone
numbers: the text consent log, the delivery records, the conversations and their messages, any
marketing run's record of them, and any stored reply. Their numbers stay on the do-not-text list
as a hash only, so they are never texted again. See [A person's data](/guides/email/privacy/).

A person known **only by phone** is erased by their number, with the
[REST API](/reference/rest-api/)'s `POST /privacy/phone/erase`. A preview comes first
(`/privacy/phone/erase/preview`), and the number must be typed twice. Your provider keeps its own
records of the texts; ask it to delete them where you need to.

## What is kept

The words of a text sent from a template are not kept: only its delivery record, with the number
masked, the template, the segments and the price. Every change to consent is in the consent log,
with its source. Replies are kept only where an app's replies are on, for 365 days. See
[Conversations and replies](/guides/texts/conversations/).
