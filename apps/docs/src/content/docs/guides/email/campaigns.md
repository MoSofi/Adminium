---
title: Campaigns
description: Send an email to the people in your workspace — now or at a chosen time — what the run counts, who can opt out, and what is deliberately not tracked.
---

A **campaign** is an email you send to your workspace's users: a weekly digest,
a monthly report, an announcement. It is designed in the same editor as a
[template](/guides/email/) and differs in one thing — its primary button is
**Send campaign**.

## Creating a campaign

Under the **Campaigns** tab, **New campaign** offers *Blank email*, the twelve
starters and **Your templates**. Picking one of your templates copies its
design into a new campaign; the template itself is untouched.

Because nothing is saved while you type, a campaign has a **Save** button
beside *Send campaign*. Sending saves first, so the run always goes out from
the design you are looking at.

## Sending

**Send campaign** opens a short form:

- **Send to** — *Workspace users*: every active user, or only the holders of
  the roles you pick. The count of recipients — and how many have opted out —
  updates as you choose.
- **When** — *Now*, or *Schedule* with a date and time in your own time zone.

Variables are filled per recipient: `{{name}}` becomes each person's name. On
confirmation the campaign shows *Campaign sent!* (or *Campaign scheduled!*), and
the header wears a chip while the run is scheduled or in progress —
*Scheduled · Tuesday 10:00* or *Sending · 42 %* — with **Cancel schedule** or
**Cancel sending** beside it. Cancelling a run that is under way stops it for
good: whoever already got the email keeps it, and nobody else is sent it.

A campaign with a scheduled or running send cannot be sent again until that
run has finished or been cancelled.

A campaign fills four variables for each recipient: `{{name}}`,
`{{first_name}}`, `{{email}}` and `{{appName}}`. If the campaign reads any
other variable and gives it no [backup](/guides/email/#when-a-value-is-missing),
every recipient would get it as written. The form names it (*Nothing fills
`{{order_number}}`*) and the campaign cannot be sent until the variable has a
backup or is taken out.

## The run

When a send starts, Adminium resolves the audience (at that moment, not when
you clicked, so a user added in between is included and a suspended one is
not), writes every recipient down in the campaign's **send log**, and copies
the campaign in every language it goes out in. An edit you make afterwards
applies to your next send, not to this one.

The recipients are then handed to the mail queue a few at a time, each in the
language variation that matches their language when one exists and is
translated. A send can be capped at a number of emails an hour; the cap counts
every campaign the workspace is sending in that hour, not only this one. The
mail queue tries a refused email again several times over a few minutes before
it counts the address as failed, keeping the first hundred failures with their
reason.

A send can be paused and resumed, and stopped for good. Because every
recipient is written down before the first email goes, a server that restarts
or crashes in the middle of a send carries on where it was: nobody is sent the
email twice, and nobody is left out.

When the last recipient has been handed over the campaign's card reads
*N sent · M failed*, and the person who sent it receives an in-app
notification. Deleting a campaign keeps its sends and their logs.

## Opting out

Every workspace user can turn campaign email off for themselves under their
notification preferences (the *Campaigns* kind). Opted-out users are counted
as *skipped* — shown in the send form as *opted out* — and never contacted.
System email such as password resets and invitations is not affected by this
switch.

## What is not tracked

Adminium does not track opens or clicks. Doing so needs a tracking pixel — a
public, unauthenticated endpoint and a per-recipient beacon that most mail
clients now block or proxy — so the number would be both invasive and wrong.
A campaign reports what the relay accepted and what it refused; nothing more.

## Audiences beyond the workspace

Sending to a customer table — an audience drawn from your own data rather than
from workspace users — is not part of this release. A marketing send to
outside addresses needs a working unsubscribe link and the mail headers that
go with it, and those ship together, in a later wave.
