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
**Cancel sending** beside it. Cancelling a run that is under way keeps the
count of what was already delivered.

A campaign with a scheduled or running send cannot be sent again until that
run has finished or been cancelled.

## The run

A send is one background job. It resolves the audience when it starts (not
when you clicked), so a user added in between is included and a suspended one
is not; it picks, for each recipient, the language variation that matches
their language when one exists and is translated; it renders the email per
recipient, sends through the configured relay, retries once on a transient
error and otherwise counts the address as failed, keeping the first hundred
failures with their reason.

When the run finishes the campaign's card reads *N sent · M failed*, and the
person who sent it receives an in-app notification.

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
