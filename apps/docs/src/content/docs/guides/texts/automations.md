---
title: '"Send text" in automations'
description: Add a step to an automation that texts the number on the record, from one of your text templates. What it checks, when it waits, and what the run log says.
---

From Adminium 0.3.76.

An [automation](/guides/automations/) can send a text with the **Send text** step: one text
template, to the phone number in a column of the record the rule runs for.

## Add the step

1. Connect a provider first, in **Studio → Texts**. Until then, the step says so.
2. In the rule's flow, add a step and choose **Send text**.
3. Choose the **Text template**. Only templates an installed app brought are offered.
4. Choose the **Phone number column** of the record.
5. Fill any placeholder the record does not fill: a text, or a column of the record.
6. Optional: **Never send after**, a date-and-time column of the record. The text is never sent
   after that moment, for example the start of a visit.

The step shows an estimate of the length for a sample record. See
[the length counter](/guides/texts/templates/#the-length-counter).

## What happens when it runs

The step sends nothing by itself. It hands the text to the same send path every app's text uses,
which checks, in order:

- that the number can be read and can receive a text, and is not in mainland China (+86);
- that the person agreed to texts and is not on the do-not-text list;
- the template's words and the values filled into it;
- that a way to opt out can be given for this sender;
- the sending hours, and today's limit.

A text that may not go is **skipped**, and the run goes on. A person who said stop is the rule
working, not a fault. The step **fails** only when its template is gone or switched off, or when the
checks themselves could not be read.

Outside the sending hours the text is held until they open, unless that is after **Never send
after**. Then it is skipped.

A run walked again never sends a second text: the rule, the run and the step together make one
text.

The step sends a **service** text, written in the business's language. Marketing texts go from the
[Marketing](/guides/texts/marketing/) tab, never from an automation.

## The run log

Each line names the number only as `+49 ••• 789`, and never a word of the text:

- "Text queued for +49 ••• 789";
- "Text held for +49 ••• 789 until 08:00: outside the sending hours";
- "No text sent: this person asked for no more texts (stopped)", with the reason the send path gave.

A **Test** of the rule says what it would do ("Would send a text to …") and sends nothing.

A sample row is never texted: its number belongs to nobody who agreed to anything.

## In an app's manifest

An app can ship a rule with this step. See
[Automations in the manifest reference](/reference/manifest/#automations).
