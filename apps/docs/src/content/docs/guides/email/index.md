---
title: Email templates
description: Design the emails your workspace sends — the built-ins, your own templates, language variations, attachments, senders, and how a template is tested and exported.
---

Adminium sends email for two reasons: because something happened (a
notification, a password reset, an invitation) and because a person decided
to write to the team (a campaign). **Email templates** is where both kinds are
designed. A *template* is a reusable design; a *campaign* is a template that is
sent, once, to the people in your workspace. This guide covers templates; the
[campaigns guide](/guides/email/campaigns/) covers sending.

## Templates and campaigns

Open **Email templates** in the sidebar. The page has two tabs:

- **Templates** — the emails the product sends on its own (the built-ins) and
  the designs you keep for later.
- **Campaigns** — emails you send to your workspace's users, on demand or at a
  chosen time.

Both are edited in the same editor and share the same blocks. The difference
is the primary button: a template is **saved**, a campaign is **sent**.

## The built-ins

Three emails ship with the product and are seeded in every language the
product speaks: **Notification**, **Password reset** and **Team invitation**.
They are live from the first boot.

You can edit a built-in like any other template. Your edits are yours — a
product update never overwrites them. Two things keep the built-ins safe:

- **Delete** on a built-in does not remove it. It moves the built-in to
  *Archived*, and from there **Reset to built-in** restores the shipped copy
  for that language.
- A built-in switched to **Draft** is skipped by the sender, which falls back
  to the shipped copy so the product keeps working.

## Starting a new template

**New template** opens a gallery: *Blank email* and twelve starters — a welcome
email, an email-address confirmation, an order receipt, a delivery update, a
weekly digest, a feature announcement, a monthly report, an appointment
reminder, a feedback request, a re-engagement email, a payment-failed notice
and an account-paused notice. A starter is a full design in your language:
heading, copy, a button, and the sections that kind of email usually carries.

## The editor

The editor is a live preview. Click any part of the email — the subject, a
heading, a paragraph, the footer — and edit it in place; the panel on the
right shows every field of the part you clicked, its style options and the
variables you can insert.

Nothing is saved while you type. The chip beside the name reads *Unsaved
changes* until you press **Save template** (or `Ctrl`/`⌘`+`S`), and leaving a
page with unsaved edits asks first. Undo and redo cover the last sixty edits.

### Sections

An email is a list of sections. **Add section** (at the end of the email, or
between any two sections) opens the picker: headings, text, buttons, images,
lists, quotes, social links, custom HTML, and the commerce sections — stat
rows, product rows, totals in other currencies, tax and discount lines,
payment history, a delivery timeline, loyalty points — plus legal and support
blocks. Drag a section to reorder it; a section you like can be saved as a
reusable block and picked again in any template.

### Brand and sender

The **Brand & sender** panel sets the brand name, the mark (twelve shipped
marks, or your workspace logo), the accent colour and the **from** name and
address. The from address is chosen from the senders configured under
*Studio → Settings → Email*; an address that is not configured cannot be
picked, so a template can never send from an identity the relay would reject.

### Variables

Variables such as `{{name}}`, `{{first_name}}`, `{{email}}` and `{{appName}}`
are filled per recipient when the email goes out. Click a field, then a
variable chip, to insert it. Test sends fill them with sample values.

## Languages

A template can exist in several languages at once. **Add language** in the
editor's language menu creates a linked copy: a starter's copy arrives already
translated; a blank template's copy is a duplicate flagged *Needs translation*
until someone writes it. All variations of one template are grouped under its
topic in the manager, and the sender picks the variation that matches the
recipient's language when it exists.

### Mirroring a change

Adding, removing or moving a section on one language variation asks whether
the same change should apply to the others: *Apply to all* carries the
structural change across (copy comes across untranslated, and only when you
save); *Only this language* keeps it here. Text edits never mirror.

## Attachments

The **Attachments** panel adds files to every send of the template:

- **Fixed files** come from your workspace's file library (*Files* in the
  sidebar, or the *Workspace documents* list in the panel). The bytes are read
  at send time, so a file you replace in the library goes out in its new form.
  A file that has been trashed in the library makes the send **fail loudly**
  rather than go out incomplete.
- **Generated files** are resolved per recipient from a variable — an invoice
  PDF whose id lives in the recipient's data, for instance.

Images placed in the email itself come from the same library (or an `https`
URL) and are embedded in the message rather than linked.

Every send has a size cap, set under *Studio → Settings → Email*; a template
whose attachments exceed it cannot be saved.

## Senders

*Studio → Settings → Email* holds the SMTP relay and the list of **senders**
— the from addresses a template may use. The relay's own address is always
the first sender; add more for a support desk or a newsletter identity.

## Links in emails

Password-reset and invitation emails carry a link back to Adminium. The
address that link opens is **Address in email links** under
*Studio → Settings → Email*: a scheme, a host and, if you need one, a port,
such as `https://admin.example.com`. A path is refused.

You rarely have to type it. While the field is empty, Adminium fills it in
from the browser of an admin who can manage settings, the next time that admin
finishes first-run setup, signs in or saves a change. It never fills in
`localhost` or another address only your own machine can reach, so an instance
you are trying out locally keeps an empty field until you fill it. Clear the
field and Adminium learns the address again the same way. The audit log records
each time it does.

Until the address is known, links use the host the request was sent to. They
never use the `Origin` header, which any script can set when it asks for a
password reset. Behind a reverse proxy that answers only for your hostname, the
host is your hostname. If Adminium's port can be reached without the proxy,
fill the field in yourself, because a direct caller can put any host in its
request.

## Testing

**Test** sends the email *as it is on screen* — unsaved edits included — to the
addresses you enter, with sample data in the variables. Teammates are one
click away. Use it to check a design in a real mail client before saving.

## Duplicating, deleting, archiving

**Duplicate** makes *(copy)* beside the original. **Delete** moves a template to
*Archived*, with **Undo** in the toast; *Archived* is reachable from the
actions menu and offers **Restore**, **Duplicate** and **Delete for good** (a
built-in offers **Reset to built-in** instead).

## Export and import

**Export all** downloads a JSON bundle of every template (or every campaign,
depending on the tab) with fixed attachments inlined. **Import template** reads
such a bundle back, previews what it holds and what already exists, and lets
you **skip** or **replace** the existing ones. Nothing is imported until you
confirm.
