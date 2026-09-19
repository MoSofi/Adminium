---
title: The page assistant
description: An assistant that knows the page you opened it from — it drafts emails, invoice templates, invoices and reports in that page's own format, and it never saves anything itself.
---

Open an Adminium page that builds documents — Email templates, Invoice
templates, Invoices, Report builder — and there is an **Ask** button in the
header. It opens an assistant that already knows what that page holds: the
templates in it, the format they are written in, your branding, and which
tables your role can read.

It drafts. **It never saves.** Every button that would change something is
locked until you turn actions on for that session, needs the same permission
the page's own Save needs, and asks once more before it runs.

## Where the button is

| Page | Where |
|---|---|
| Email templates, and its editor | In the header, before *Duplicate* |
| Invoices, and its editor | In the header, before the language menu |
| Report builder, and its editor | In the header, before *Duplicate* |

The button appears only for a role that holds the assistant permission. It
does **not** disappear when no AI provider is configured — the window opens and
tells you what is missing and who can fix it, because a button that vanishes
teaches nobody anything.

## What it reads

Always:

- **The page's own documents** — names, and the one you have open.
- **The document format** the page accepts, generated from the page's own
  validator, so a draft that passes there is a draft the editor can open.
- **Your database schema** — tables, columns and their types, for the tables
  your role can read.

Only when an administrator turns it on:

- **Rows from those tables.** Masked, at most 50 per request, and every table
  a turn touched is listed under **Sources read** on the result.

The switch is in **Settings → AI**, off by default, and it is not carried by an
exported bundle: importing somebody else's configuration can never turn it on
for you.

Everything it reads goes to the AI provider **you** configured. If that matters
for your data, leave the row switch off — the assistant still drafts from your
documents and your schema.

## What it never does

- **It never writes.** The model's last move is a draft. Creating the row is a
  separate action you take, behind a confirmation.
- **It never sends anything to your customers.** *Send test email* goes to your
  own address and nowhere else.
- **It never publishes.** A saved draft is a draft: an email template arrives
  disabled, an invoice and a report arrive with status `draft`.
- **It never changes existing rows.** A draft invoice changes no customer
  record, and the window says so.

## Permission, and who has it

The assistant is gated by a system permission, seeded on a fresh install to
**Super Admin** and **Admin** — not to Editor or Viewer. Opening it sends your
documents, and (with the switch on) rows you can read, to a third-party model;
withholding that from a role is a decision an operator has to be able to make.
Grant or revoke it on **Studio → Roles**.

Saving is a **second** permission — the same one the page's own Save button
needs, which on a stock install only Super Admin holds. So a role that can
draft but cannot save is the ordinary case, not an edge:

> Your role can look, draft and preview here, but not save.

Everything still works — questions, drafts, previews, and (in an editor) putting
a draft straight onto the screen so you can save it yourself. Only the buttons
that write are locked, and they say why.

## The trail

Every action that changes something writes an audit row, so *who asked for this
draft, and who saved it* is answerable months later. The window says so in its
footer. Reading is not audited; saving, sending a test and adding a language
variation are.

Each conversation is stored as a session with its turns, and swept away on the
retention schedule you set for the workspace.

## You need a provider

The assistant uses the same AI provider Adminium's schema enrichment uses —
configure one in **Settings → AI**. There is no bring-your-own copy-paste path
here: a conversation is many round trips, and pasting each one is not a
workflow anybody would want. [LLM assist](/guides/llm-assist/) covers the
enrichment paths, where BYO **is** a first-class option.

## When it will not open

| What you see | What it means | What fixes it |
|---|---|---|
| *No AI provider is configured yet.* | Nobody has set one up on this instance. | An administrator configures one in **Settings → AI**. |
| *Outbound network features are off on this instance.* | This install is air-gapped, or outbound calls are switched off. | A change to the instance's configuration — the assistant needs to reach a provider. |
| *You do not have permission to use …* | Your role does not hold the assistant permission. | Whoever manages roles grants it on **Studio → Roles**. |

## Naming it

**Settings → AI** also decides what the assistant is called. The name shows on
the Ask button and throughout the window. It is per instance, so a workspace
can call it whatever suits the people using it.

The reasoning behind the shape of all this is on
[the assistant proposes, a person saves](/anatomy/decisions/assistant-proposes/).
