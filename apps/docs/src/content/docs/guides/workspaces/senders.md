---
title: A mail sender per workspace
description: Give each workspace its own sender name, From address, reply-to and postal address, so Kiln's mail goes as Kiln. Which sender a mail uses, "Send as" on a template, which addresses are accepted, and why the do-not-email list stays server-wide.
---

Two businesses on one server should not mail their customers under one name. A
[workspace](/guides/workspaces/) can have a **sender** of its own: mail about Kiln Street Pottery's
records then goes from Kiln's address, with Kiln's name, and Fernhill's from Fernhill's.

A workspace with no sender uses the server's sender, as before: the one set under
**Studio → Settings → Email** (see [Senders](/guides/email/#senders)).

## Setting a workspace's sender

On **Studio → Data connections**, the Workspaces card has **Sender** on each workspace's row. It
needs **Manage database connections**. The sheet lists where this server can send from, then four
fields:

| Field | What it is |
|---|---|
| **Sender name** | Who the mail says it is from, such as Kiln Street Pottery |
| **From address** | Required. It must be an address this server can send from (below) |
| **Reply-to** | Where replies go. Blank means the From address |
| **Postal address** | Printed at the foot of this workspace's marketing mail. Blank means the server's |

The From address is what makes a sender: until it is saved, the workspace's mail goes from the
server's sender. **Use the server's sender** clears it. The footer always says how the workspace
sends now: "Its mail goes from hello@kilnstreet.example."

If the server has no mail set up yet, the sheet says so and links to the email settings: a workspace
cannot have a sender of its own before the server has one.

## Which addresses are accepted

A workspace's From must be an address the server's own mail settings can already send for. The
sheet lists them as "Any address at:" a list of domains, and "Or exactly:" single addresses. They
come from three places:

- the server's SMTP From address;
- the **senders** listed under **Studio → Settings → Email**;
- the domains the server holds a DKIM key for.

The rules:

- Any address is accepted at the domain of a listed sender, or at a domain with a DKIM key here. If
  `orders@kilnstreet.example` is a sender, `hello@kilnstreet.example` is accepted.
- **A public mailbox never opens its whole domain.** If `ana.potter@gmail.com` is a sender, only that
  exact address is accepted, never another `@gmail.com` address.
- **A subdomain is not accepted on its own.** `x@mail.kilnstreet.example` needs
  `mail.kilnstreet.example` itself to be listed.

Anything else is refused in words, before the form is sent: "This server can only send from
fernhill.example, kilnstreet.example, or ana.potter@gmail.com. Use an address there."

The check runs again on every send. If the server's settings change so that a workspace's From is no
longer covered, its mail goes from the server's sender, and the old address is never handed to the
mail relay.

## Which sender a mail uses

The sender rule, in order:

1. **A template that names a sender goes as it.** See [Send as](#send-as) below.
2. **Mail about a record goes as its database's workspace.** A rule's email about an order on `kiln`
   goes as Kiln. A database in several workspaces goes as **the first of them** in the order of the
   Workspaces card. If that first workspace has no sender, the mail goes as the server, not as a
   later workspace.
3. **Everything else goes as the server.** That covers a database in no workspace, a workspace with
   no sender, and every mail that is about no record: sign-in links, password resets, invitations,
   notices and other system mail.

"About a record" means:

| Mail | Its database |
|---|---|
| A rule's email step (to the record, to fixed addresses, to staff, to listed people) and its digest step | The record's, else the rule's |
| An app's outbox | The app copy's database |
| A document sent by mail | The document's |
| A campaign to a table's people | The audience's database |
| An invoice's pay link and receipt | The invoice's |
| A form's sign-up confirmation | The form's |
| A booking confirmation | The database of the public key that booked |

A campaign to the server's own people, and a test send from the template editor, are about no
database: only Send as applies to them.

### What the sender changes

- **From, name and reply-to.** A rule's own reply-to (such as a reply to the rep) or an app's house
  address still wins. Then the workspace's reply-to, then the marketing reply-to.
- **The DKIM signature** follows the From address's domain, so Kiln's mail is signed for
  `kilnstreet.example` when the server holds that key.
- **Marketing mail** prints the chosen sender's postal address in its footer, and names its business
  in the unsubscribe line ("Unsubscribe from Kiln Street Pottery's newsletter"). The mailto
  unsubscribe uses the sender's reply-to.
- **Pay mail** names the workspace's business, so Kiln's pay link reads "Kiln Street Pottery", not
  the server's business name.
- **An app's outbox** keeps the app's own business name when the app sets one, and uses the
  workspace's postal address.

## Send as

A template can name who it goes as, whatever its record. **Send as** sits in the email editor's
**Brand & sender** panel, under the From address:

- **By the record's workspace**: the sender rule above. The default.
- **The server**: every mail of this template goes from the server's sender.
- **A workspace**: every mail of this template goes from that workspace's sender. A workspace with no
  sender yet is marked "no sender yet", and the template then goes as the server.

Send as applies to every language of the template at once, and is saved as soon as you choose it,
apart from the editor's own Save. It is shown only when the server has workspaces, and needs
**Manage server settings**.

Mail about no record (sign-in, invitations, system mail) always goes as the server, whatever its
template says, so a choice made here can never change how people sign in.

When a workspace is deleted, templates that named it go back to **By the record's workspace**.

## The do-not-email list is server-wide

Each workspace has its own sender, but **the do-not-email list belongs to the whole server**.
Someone who unsubscribes from Kiln's newsletter gets no marketing mail from Kiln or from Fernhill,
by campaign or by a rule's marketing email. The sheet says so beside the sender fields.

This is on purpose: one list is the only way to be sure an address that asked to stop never hears
from this server again. Service mail (an order confirmation, a receipt) is not marketing and still
goes. See [A person's data](/guides/email/privacy/) for what the list keeps.

## Limits

- The sender name is at most 120 characters; the postal address at most 300.
- The From address is stored in lower case.
- **Check again** under the marketing settings checks the DNS of the server's own senders only, not
  a workspace's From. A workspace From at a domain the server already signs for uses that domain's
  DKIM key.

Through the API: `GET /api/v1/workspaces/sender-domains`, `PUT` and `DELETE /api/v1/workspaces/:id/sender`,
`PUT /api/v1/email-templates/:id/send-as` and `GET /api/v1/email-templates/send-as-options`. See the
[REST API reference](/reference/rest-api/).
