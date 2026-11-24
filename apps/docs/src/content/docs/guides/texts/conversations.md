---
title: Conversations and replies
description: Read and answer the texts customers send back, who may see them, each app's replies switch, the fixed "this number is not read" answer, and "Send a text" on a record.
---

From Adminium 0.3.76.

When a customer replies to a text, the reply can be kept in a conversation that staff read and
answer on **Studio → Texts → Conversations**. Each app decides whether its replies are read at all.

Replies reach Adminium only on a server with a public `https` address. A server without one sends,
but never hears an answer, and the page says so. See
[A server with no public address](/guides/texts/#a-server-with-no-public-address).

## One conversation per number and app

A reply belongs to the app that texted the number last. So a clinic's patient and a hotel's guest on
one server never share a conversation, and a role given one app's conversations reads that app's
alone. The texts an app sent show in the conversation by their template, because their words are not
kept.

A STOP or a START shows in the conversation too, with the one confirmation if it went. A stopped
person cannot be answered.

## Answering

An answer goes through the same send path as every text: the do-not-text list, the words, the
length, the sending hours and the daily limit all apply, and it ends with the opt-out line. A person
who wrote in the last seven days has asked for an answer, so they need no yes of their own. A
service answer to a reply that arrived in the last hour may go outside the sending hours.

Every read and every answer is recorded in the audit log. The record names the conversation and a
masked number, never the words.

## Who may see them

A customer can write anything, a symptom included. So only the Super Admin can read conversations
until someone is given the right on purpose:

| Permission | What it allows |
|---|---|
| **Read customers' texts** | Every conversation. |
| **Answer customers' texts** | Every conversation, answering it, and texting the number on a record the person can open. |
| An app role's `texts` read or reply grant | That app's conversations alone. The app may give it to its own roles. |

A conversation that belongs to no app is read with the first two alone. Answering always includes
reading. An API key never reads or answers a customer's text.

## Each app's replies switch

Each app has a switch for its replies, under **Studio → Texts**. It starts where the app says:
**Clinic starts with it off**, because patients may text symptoms. You need **Set up text messages**
to change it.

When an app's replies are **off**:

- a reply is not kept at all;
- the person gets one fixed answer, in the business's language: "This number is not read. Contact
  us:" and your phone or e-mail. It goes at most once in 30 days to a number, never to a number on the
  do-not-text list, and never to your own sender;
- a HELP reply gets the same answer, unless the provider answered HELP itself;
- a STOP still works as always.

The answer, a STOP's confirmation and a country's opt-out line name the business by the name chosen
for texts: the app's own name for texts (a neutral name a clinic saves, `outbox.settings.textName`),
else the sender name set in Studio → Texts, else the business's name. The name an app's emails are
signed with is never used in a text.

A reply to no app is treated as off when any installed app's replies are off. A server that runs a
clinic keeps no stranger's symptoms either.

## Send a text from a record

An app can offer **Send a text** on a record's page. Sales CRM has it beside **Log the call**. It texts
the number in a phone column of the record, through the same send path, and the text joins that
number's conversation. It needs **Answer customers' texts**, or the app's reply grant, and a record
the person can open. Someone who may not see the number is not shown it afterwards either.

`POST /api/v1/texts/send` names the record by `connection`, `table`, `row` and the phone `column`.
The table may be named by its id, by its name as the data routes take it, or, on an app's own page
that sends `X-Adminium-Install`, by the app's own name for it (`contacts`).

## What is kept

The number and every message's words are kept encrypted. A message is kept for 365 days. A
conversation with no messages left is then removed. Erasing the person by their number removes their
conversations at once. See [Consent, STOP and the do-not-text list](/guides/texts/stop-and-consent/#erasing-a-person).
