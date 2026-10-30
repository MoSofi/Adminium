---
title: A person's data
description: Find everything kept about one e-mail address, download it for an access request, erase it in place, and set the privacy notice and the sender's postal address.
---

When somebody asks what you keep about them, Adminium finds it by their
e-mail address, across every app, and hands you a file to send them. The same
search says what an erasure would have to leave behind, and why.

This is the **privacy** permission (`system:privacy:manage`). It reads every
people table whole, past the table and row limits a role normally has, so only
the **Super Admin** holds it. Give it to another role on purpose (Team →
Roles) — for example to the person who answers access requests. The built-in
Admin role does not get it, on a new install or an old one.

On screen it is **Workspace settings → Privacy & public pages**, shown only to
whoever holds the permission. Its three tabs are the privacy notice, **A
person's data** (find, download, erase) and **How long we keep things**. The
address you search for stays on the page: it is sent to the server in the
request, never put in the page's address.

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

## Erasing a person

`POST /api/v1/privacy/erase/preview` with `{ "address": "…" }` counts what
an erasure would take (their rows, copies of them, their mail, consent
entries, campaign sends, files on their rows) and lists what stays (above).
`POST /api/v1/privacy/erase` with `{ "address": "…", "confirm": "…" }` does
it; `confirm` is the address typed again (any case), or the answer is 409.

The person is erased **in place**: their rows are kept and emptied, so every
link to them stays whole (a deal still opens, a sent quote still reads as
sent). It writes as Adminium itself, not as you: no role's table or row
limits stop it half-way, no rule fires, nothing is mailed, and a copy that
follows another row is never moved.

- **Their rows** on each people table: the address, the name, the first
  name, the language, the consent column and the stamps it sets (who ticked
  it, and when), the opt-out mark, every column marked personal, and what the
  app's own "delete my details" empties. Never a key or a link. A field that
  may be empty becomes empty; a yes/no that may not reads "no"; a name that
  may not be empty reads "Erased person" in the install's language; a unique
  column that may not be empty gets a value of its own
  (`erased-…@erased.invalid` for an address, a domain no mail goes to). A
  column that can be none of these (a date that may not be empty) is left,
  and the answer lists it under `left`.
- **Copies of them** the app declares on other tables. A row is theirs when
  one of their copies on it links to one of their rows, holds their address,
  or holds one of their phone numbers (a booking taken on the phone, with no
  address and no link back; a number written another way, with a leading 0
  or a country code, is the same number). On a row theirs by a link or the
  address, their copies go, each other copy of theirs with no link on it (an
  unlinked enquiry's name) too, and, when nobody else is on the row, every
  column marked personal (their own words on it: a stay's note, an enquiry's
  message). A row found by the number alone loses the number and nothing
  else, because a number may be shared (a household's, a switchboard's).
  Where a copy links to another person (a quote sent to one contact and
  accepted by another), only what is theirs by a link, the address or the
  number goes.
  Nothing else on the row changes. A table the app marks `keep: { law }` is
  left whole, and "What stays" counts their rows on it.
- **Their mail** in each app's outbox loses its address; a message still
  waiting is skipped.
- **Their consent history** is deleted. **The do-not-email list** keeps their
  address as a code alone (added if they were not on it), so they are never
  e-mailed again; a link in mail sent before only ever says they are
  unsubscribed.
- **Campaign sends** keep their state with the address and name emptied.
  Their downloads and the files on their rows are deleted.
- **The audit log and removed rows** keep every entry (who changed what, and
  when), but the images of their rows lose the fields above, their own
  writes through a public page lose where they came from, and any text that
  still holds the address is emptied.
- Their customer sessions end and open sign-in links are taken back.

The erasure's own audit entry keeps the counts and a keyed code of the
address, never the address. An erasure cut short can be run again: it finds
what is left and finishes.

## How long we keep things

`GET /api/v1/privacy/keeping` lists the keeping table. This release has two
fixed rows, neither of which can be shortened: the **consent history** is kept
until the person is erased (it proves what they agreed to or asked), and the
**do-not-email list** is kept for good (once the person is erased, as a code).

## The privacy notice and the postal address

- **Business name** and **Privacy notice address** (`PUT /api/v1/privacy/notice`).
  The address must start with `https://`. New public forms and chat open only
  once both are set; the pages your apps already have (checkouts, booking) are
  not affected.
- **Postal address** (`PUT /api/v1/privacy/postal-address`, the marketing mail
  settings' permission). Every marketing mail prints it; a marketing send is
  refused until it is set.

Pages a stranger sees read the name and the notice address without signing in
at `GET /api/v1/privacy/notice/public`. The unsubscribe pages link the notice
in their footer ("Privacy notice", in the page's language) once its address is
set, and show no link before.

One name is used everywhere a stranger looks — the pay page and its mails,
the marketing mail's footer, the unsubscribe pages: the pay page's own shop
name first, then the Business name, then the workspace's name, then the host
of the public address. It is never "Adminium".

Nothing written about a search or a download names the address: the audit log
keeps the counts and a keyed code of the address.
