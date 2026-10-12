---
title: Telling the person on the row
description: Rules that tell a record's own person, once per spell, at once or after their quiet hours; a summary for each person; and mentions in a text.
---

An app that gives each record to a person (a deal to its owner, a job to its fitter) can tell
that person, and only that person, when something about the record changes. Everything here is
written in the app's [manifest](/reference/manifest/#automations) and needs
`minAdminiumVersion` `0.3.27`.

## Tell the owner, not the whole role

Mark the column that holds the person as a staff column, then address a notice or an email to it:

```json
{ "ref": "owner_id", "type": "text", "maxLength": 36, "nullable": true, "rules": { "staff": true } }
```

```json
{ "kind": "notification", "to": { "column": "owner_id" }, "title": { "en-US": "Quiet: {{record.name}}" } }
```

On a table that links to the record, go one link further: `"deal_id.owner_id"` on a follow-up is
the deal's owner. A record with nobody in the column tells nobody, and the run's log says so.

## Once each time it happens

A rule by the clock that visits "deals with nothing done for 14 days" would tell the owner every
time it runs. `"once": true` tells them once ever. `"once": "per-spell"` tells them once each time
the deal goes quiet: when it is worked on and then goes quiet again, they are told again.

```json
"trigger": { "kind": "schedule", "schedule": { "kind": "daily", "time": "08:00" },
  "forEach": { "table": "deals", "once": "per-spell",
    "where": [{ "left": { "field": "last_touch_at" }, "op": "more_than_ago", "right": { "amount": 14, "unit": "days" } }] } }
```

## Quiet hours

Each person sets their own quiet hours under **Account → Notifications**, a window for each
weekday on their own clock. A notice that arrives at 19:00 to somebody whose evening is quiet
from 18:00 to 08:00 is in the app at once; its email is sent at 08:00. Add `"urgent": true` to a
notice that cannot wait (today's day sheet changed): it is never held. A person can also mark a
kind of notice "always tell me".

## A summary for each person

A `digest` step sends each person who holds one of its roles an email of their own rows: the
deals they own that close this week, the follow-ups due today. It is read as that person when it
is sent, so it never lists a row they could not open, and it is sent on the weekday and at the
time they chose. See [the reference](/reference/manifest/#a-summary-for-each-person).

## One rule, several rows

Give a "create a record" step a `name` and the steps after it read the row it made:

```json
{ "kind": "record.create", "table": "contacts", "name": "contact", "values": { "name": "{{record.name}}" } },
{ "kind": "record.create", "table": "deals", "name": "deal",
  "values": { "name": "Deal for {{steps.contact.name}}", "contact_id": "{{steps.contact.id}}" } },
{ "kind": "record.create", "table": "follow_ups", "values": { "deal_id": "{{steps.deal.id}}" } }
```

## Mentions

Mark a text column `"rules": { "mentions": true }` and its box offers the people who sign in as
the writer types `@`. Each person newly named is told who mentioned them and on which record. The
notice never carries the text, and somebody who cannot open the record gets it with no link: a
mention is a way to ask a colleague, not a way round what their role reads. On a comments table,
`{ "mentions": { "about": "deal_id" } }` makes the notice name and open the deal the comment is on.
