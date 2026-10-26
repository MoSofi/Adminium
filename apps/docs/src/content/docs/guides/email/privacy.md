---
title: A person's data
description: Find everything kept about one e-mail address, download it for an access request, see what an erasure would leave and why, and set the privacy notice and the sender's postal address.
---

When somebody asks what you keep about them, Adminium finds it by their
e-mail address, across every app, and hands you a file to send them. The same
search says what an erasure would have to leave behind, and why.

This is the **privacy** permission (`system:privacy:manage`). It reads every
people table whole, past the table and row limits a role normally has, so only
the **Super Admin** holds it. Give it to another role on purpose (Team →
Roles) — for example to the person who answers access requests. The built-in
Admin role does not get it, on a new install or an old one.

## Finding a person

`POST /api/v1/privacy/find` with `{ "address": "…" }`. The address is compared
trimmed and in lower case, nothing more: `Marta.Kovac@Example.com` finds
`marta.kovac@example.com`, and never `xmarta.kovac@example.com`.

It looks in:

- every table an installed app declares as **people** (the manifest's
  `people` list, with the owner's changes), by the address column;
- each **copy** of a person the app declares on another table (a quote's
  recipient): by the address, or by the link back to one of the person's rows;
- the app's **outbox**: mail to the address, or to one of their rows;
- the **consent history** and the **do-not-email list**;
- what Adminium keeps itself: campaign mail sent to them and its failures,
  rendered documents, invoices, payments, the payment services' messages, the
  rules' run history, staff notifications, and files attached to their rows.

The answer lists each source with how many rows it holds and their keys. A
private table is not read. Secret columns are never read out.

## Downloading everything

`POST /api/v1/privacy/exports` writes a **.zip** with one JSON file and one
CSV file per source, in the background. Only the person who asked can
download it (`GET /api/v1/privacy/exports/:id/download`), and only while they
still hold the permission. It is deleted after `retention.exportsDays` (30 days by default).

A copy of a person on another table is downloaded as the columns that hold
them (and the row's key), not the rest of the row.

## What stays

`POST /api/v1/privacy/what-stays` lists what an erasure leaves, each with a
reason the screen words in your language:

| What | Why | How long |
| --- | --- | --- |
| Rows of a table the app marks `keep: { law }` (theirs, a copy of them, or one that points at them) | tax, health, contract or safety | as long as the app keeps them |
| Rendered documents | an issued document is kept as it was sent | `retention.documentsDays`, or for good while it is empty |
| Invoices you wrote | tax | for good |
| Payments | payment records | for good |
| A payment service's messages | payment records | `retention.paymentEventsDays` |
| Rule runs, staff notifications | kept a while | their own retention settings |
| Data exports of a table | kept a while | until each expires |
| The do-not-email list | so they are never e-mailed again | for good, as a code, never the address |

## How long we keep things

`GET /api/v1/privacy/keeping` lists the keeping table. This release has two
fixed rows, both **kept for good**: the consent history (it proves what a
person agreed to or asked) and the do-not-email list.

## The privacy notice and the postal address

- **Business name** and **Privacy notice address** (`PUT /api/v1/privacy/notice`).
  The address must start with `https://`. New public forms and chat open only
  once both are set; the pages your apps already have (checkouts, booking) are
  not affected.
- **Postal address** (`PUT /api/v1/privacy/postal-address`, the marketing mail
  settings' permission). Every marketing mail prints it; a marketing send is
  refused until it is set.

Pages a stranger sees read the name and the notice address without signing in
at `GET /api/v1/privacy/notice/public`.

One name is used everywhere a stranger looks — the pay page and its mails,
the marketing mail's footer, the unsubscribe pages: the pay page's own shop
name first, then the Business name, then the workspace's name, then the host
of the public address. It is never "Adminium".

Nothing written about a search or a download names the address: the audit log
keeps the counts and a keyed code of the address.
