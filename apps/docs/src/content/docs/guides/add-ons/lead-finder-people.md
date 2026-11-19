---
title: "Lead finder: people and the law"
description: The People switch and what it needs, why you keep found people and for how long, the mail that tells them at once, the tell-by day, Object, erasure, and recorded consent before anyone is e-mailed.
---

Lead finder keeps **companies only** until you switch People on. With People on, it can also keep
the people Hunter finds at a company, and sole traders (who are people, not companies). A person's
details are personal data the moment you keep them, so Lead finder does what the law asks of
someone who collects them from elsewhere: it tells each person at once, keeps them only as long as
you said, lets them object with one press, and erases them when it must.

:::note[Built for the GDPR]
The tell mail, the tell-by day and Object follow the GDPR, as it applies in the EU, in the UK and
in Norway. Outside those, check your own law before you switch People on. This page describes what
Adminium does; it is not legal advice.
:::

## The People switch

The switch is on the **People** card: open **Lead finder**, press **Sources**, and scroll to
**People**. It reads **Store people, not just companies**.

It refuses to turn on until everything the tell mail needs is in place, and the card lists what is
missing, each with a link to where it is put right:

- **Why you keep them**, written in each language a found person may be told in: your install's
  language, English, and the language of each register that is on (French while the Register of
  France is on);
- **how long** found people are kept;
- **e-mail** set up, so the mail can go;
- the **Address in email links**, in the Senders card (see
  [Links in emails](/guides/email/#links-in-emails)), and the page a person objects on reachable
  from outside at that address;
- the **Business name** and the **Privacy notice address** (see
  [The privacy notice](/guides/email/privacy/#the-privacy-notice-and-the-postal-address));
- the add-on's tell mail.

The card also says, with People on, that found people start at "may not be e-mailed", and that you
write to them one to one, never in a campaign, and only after they agree.

Turning People off stops Lead finder keeping anyone new. The people already kept stay, with their
tell-by days and keeping times, until they are erased or become ordinary contacts.

## Why you keep them

One plain sentence, the purpose you keep found people for, such as "To offer our acoustic panels
to architects' studios in the North of England." It goes into the tell mail as it is, so it holds
no links. Write it once per language (the card's chips show which are written).

## How long you keep them

**Keep found people for** 1, 2 or 3 years (3 unless you choose). It counts from the day they were
found, or from the last time they were in touch themselves (they replied, or answered a form), if
that is later. Then Adminium erases them. Finding them again never starts the time again: they are
"already a contact", and nothing is stored twice.

Two kinds of found people are never erased for this: someone who agreed to be e-mailed (a recorded
consent, for any purpose), and someone your app marks as a customer. From then on they are your
ordinary contacts.

The time shows, read-only, in **Server settings → Privacy & public pages → How long we keep
things**, as "People found — Lead finder".

## The tell mail

Every person kept gets a mail **at once**: "Why we have your details". It is service mail (it sells
nothing), sent by your usual sender, and it cannot be switched off while People is on. **See the
mail it sends** on the People card previews it.

It opens with the add-on's few lines (yours to change in **Email templates**), and Adminium then
adds sentences you cannot remove or change:

- where their details came from, and when ("Hunter found your work address on 3 Feb 2027.");
- why they are kept: your sentence;
- the basis: "We rely on our legitimate interest in this (GDPR Article 6(1)(f)).";
- how long their details are kept, counted from the day they were found;
- their rights: to see, correct or delete their details, to limit what is done with them, to
  object, and to a copy, and to complain to the authority for data privacy where they live;
- a link to your privacy notice;
- set apart from the rest, **Object**: one button to the page where they object;
- who keeps their details, and whom to write to: the **Data privacy contact** on the privacy
  notice tab, if you set one.

**Which language.** The language of the company's country, when the mail is written in it and your
sentence is too: a French company's people are told in French. Otherwise your install's language
and English, one after the other (English once, if that is your install's).

**Until it has gone, nothing else reaches them.** No campaign, no rule's e-mail step, no app mail,
no chat reply: Adminium refuses every other mail to a found person's address until they are told.

## Tell by

A found person must be told within a month. Each has a **tell-by** day: the day they were found,
plus a month, less a day. **People found** shows it ("Tell by 2 Mar 2027", then "overdue").

If the mail fails (a mail server down, an address that bounces), the row says **Couldn't tell**,
with the reason, and **Send again** tries again. Someone still not told on their tell-by day is
**erased** that day: a person who could not be told may not be kept. The audit log says so.

## Object

The **Object** button in the tell mail opens a page with the person's address and one button,
"Object". Opening the link changes nothing; only the button does. Pressing it:

- erases the person: their found record, their tell mails and their fields' sources go, and their
  contact is emptied in place, or deleted when nothing else of yours points to it;
- puts their address on your do-not-email list, for good, with the reason "objected through Lead
  finder";
- tells them: "Done. We have deleted your details and won't write to you again." Where your own
  records named them (a deal, a sent quote), the page lists what you keep, with their details taken
  out.

A link used twice says they already objected. A broken link tells them whom to write to instead.
**People found** counts those who objected.

## A person's data and erasure

Found people are part of [A person's data](/guides/email/privacy/), like anyone else:

- **Find** lists the records of where they were found, with the mails that told them.
- **Download** adds, for each field a source filled, the source and the date, the record of when
  they were told, and the pages Hunter saw their address on.
- **Erase** removes their found records, their tell mails and their fields' sources, with
  everything else of theirs. The erasure's audit entry keeps only the day they were told, beside
  the keyed code of their address.

Your **privacy notice** must also say where found people's details come from, and who receives what
is searched. The privacy notice tab lists both for you: the sources that are on, and their hosts.

## Writing to them: recorded consent

A found person starts at **may not be e-mailed**, and the box cannot be ticked for them by hand, in
a bulk edit, an import or a rule. When they agree to hear from you (they replied, or said yes on
the phone), record it on their contact: **E-mail consent → Record consent…**, with the purpose, how
they agreed (in person, by phone, by e-mail, on paper) and a **note** of what they said and when.
The note is required for a found person (up to 200 characters). Your name and the date are kept
with it.

From then on they are an ordinary consenting contact for that purpose: a campaign for that
purpose included (a newsletter, say). Until then, no campaign reaches them.

## Sole traders

A sole trader found in a register (France's legal category 1000, Norway's `ENK`) is a person. With
People off, they are never added. With People on, one is added only with their own e-mail address,
and gets the tell mail like anyone found. Their company row is erased with them.
