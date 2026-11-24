---
title: Text templates and the length counter
description: Edit the words of the texts your apps send, in each language. What a text may not say, how its length is counted in segments, and what happens when an app updates.
---

From Adminium 0.3.76.

A text template is the words of one kind of text, such as a visit reminder, in each language it is
written in. Apps bring their own templates when you install them. You edit them on **Studio → Texts
→ Templates**. You need the **Set up text messages** permission.

A text template is separate from an email template. Editing one never changes the other.

## Editing a template

Open a template, choose a language, and change **The text**. Placeholders such as `{{name}}` or
`{{appointment.starts_at.time}}` are filled from the record when the text is sent. **Insert** adds
one the template can read.

The **Preview** shows the finished text: the placeholders filled with sample values you can change,
and the opt-out line the product adds. Choose the **Country** and the sender (**Sent from**) to see
what a person there gets.

Each language is saved on its own. **Save as empty** removes a language, and people who read it get
the US English text instead. US English is what every language falls back to, so it cannot be
emptied.

An edited template is yours. An app update does not overwrite it, and removing the app leaves it in
place.

## The opt-out line

You do not write the opt-out line. Adminium adds it to every text, in the template's language,
after the placeholders are filled:

- "Reply STOP to opt out." from a number that can receive replies;
- "To stop these texts, contact" and your phone or e-mail otherwise.

If your words already tell the person to reply STOP, nothing is added. When the text goes from a
sender name, which cannot take a reply, any sentence of yours that offers "Reply STOP" is taken out,
because it would promise something that cannot happen. See
[What each text carries](/guides/texts/#what-each-text-carries).

## What a text may not say

A text is not private, and phone numbers are passed on to new owners. So the editor refuses, and the
send path refuses again for every text:

- a **sign-in link**, a survey link, a review link or any other link made for one person;
- a **code** of any kind, or a QR value;
- a sentence that asks the person to **reply YES**. A provider reads a YES reply as an opt-in, and
  it can lift a stop. Ask people to agree on a form instead.

A placeholder that has no value stops the text: it is never sent with `{{name}}` in it. Give the
placeholder a backup, `{{name|there}}`, or take it out. A value that holds a link is refused too.

Adminium has no link shortener. Carriers filter public short links, so leave them out.

## The length counter

A text is sent in **segments**, and your provider bills each one. The counter under the editor shows
the characters, the segments and how many characters are left in the last one. It counts the
finished text, with the placeholders filled and the opt-out line added, because one customer's name
can change the count.

| Characters used | One segment | Each segment of a longer text |
|---|---|---|
| Standard (most Latin letters, digits and common signs) | 160 | 153 |
| Unicode (any other character) | 70 | 67 |

One character outside the standard set makes the whole text Unicode. The counter names it, so you
can swap it for a plain one. In practice:

- English, German and Danish texts are usually standard.
- French is standard unless it uses an accent outside the set, such as `ê` or `ç`.
- Czech, Arabic and Chinese texts are Unicode, so a 160-character text is three segments.

Some routes count differently, so the counter is an **estimate**: Canadian long codes allow 136
characters per segment, and US and Canadian toll-free numbers 152 (or 66 in Unicode) when a text is
split. **Counted as** chooses the table.

**A text over 6 segments is never sent.** The list of templates shows the most segments any
language may take, counted with the sample values.

## Languages

An app's text goes in the language of the person it is for, when the app knows it, else in the
business's language. A text from an automation goes in the business's language. A template with no
words in that language sends its US English. The opt-out line is written in the same language as
the template.
