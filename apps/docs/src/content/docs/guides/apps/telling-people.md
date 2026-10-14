---
title: Telling the person on the row
description: Rules that tell a record's own person, its lead or the people listed on it, once per spell, at once or after their quiet hours; a summary for each person; and mentions in a text.
---

An app that gives each record to a person (a deal to its owner, a job to its fitter) can tell
that person, and only that person, when something about the record changes. Everything here is
written in the app's [manifest](/reference/manifest/#automations) and needs
`minAdminiumVersion` `0.3.28`.

## Tell the owner, not the whole role

Mark the column that holds the person as a staff column, then address a notice or an email to it:

```json
{ "ref": "owner_id", "type": "text", "maxLength": 36, "nullable": true, "rules": { "staff": true } }
```

```json
{ "kind": "notification", "to": { "column": "owner_id" }, "title": { "en-US": "Quiet: {{record.name}}" } }
```

On a table that links to the record, go one link further: `"deal_id.owner_id"` on a follow-up is
the deal's owner. A record with nobody in the column tells nobody, and the run's log says so. So
does one whose person cannot open it (an approver whose role reaches only his own deals): add
`"else": { "roles": [...] }` to tell those roles instead.

A notice to a role goes only to the people of the role who can open the record: a manager whose
role reads her own team's deals is not told of another team's. Each is told the record as they
read it: a column their role is not shown is empty in theirs, so give it a backup,
`{{record.cost|-}}`.

## Tell the person's team lead

"Approval asked" goes to the asker's team lead, never the asker:

```json
{ "kind": "notification", "to": { "column": "asked_by_id", "lead": true, "else": { "roles": ["admin"] } },
  "title": { "en-US": "{{asked_by_id.name}} asks you to approve {{record.number}}" } }
```

The lead is whoever leads a team the asker is in (Settings → Teams) and can open the quote. With
none (she leads her own team and nobody leads her, or she is in no team), the `else` roles are told,
and still never she. Somebody who leads a team with her is not her lead. `{{asked_by_id.name}}` is
her name.

## Tell the people listed on it

A deal's people (`deal_members`), a visit's crew (`crew_members`, through the visit's crew): when
the record's table reads a listing `through` one of its `belongs` ways, a step can tell the people
it lists for the record.

```json
{ "kind": "notification", "to": { "listed": "crew_members" }, "urgent": true,
  "title": { "en-US": "Your day sheet changed: {{record.what}}" } }
```

```json
{ "kind": "email", "templateKey": "crm-deal-news", "to": { "kind": "listed", "table": "deal_members" } }
```

Only those listed who can sign in and **open the record when the step runs** are told; being put
on a list is not enough. Somebody whose role reads no visit, or reads only won deals, is passed
over. A cover with two dates counts only between them, on the business's day.

## Say what it was

A rule run by a change reads the record as it was: `{{was.stage}}`. Copy it into a column of its
own (`"values": { "came_from": "{{was.stage}}" }`) or say it: "moved from {{was.stage}} to
{{record.stage}}". An e-mail step to a person may carry `{{recordUrl}}`, the record's address,
and is sent only to somebody who can open the record, as they read it. The run keeps only the
columns as they were that the rule reads, never a secret one.

## Once each time it happens

A rule by the clock that visits "deals with nothing done for 14 days" would tell the owner every
time it runs. `"once": true` tells them once ever. `"once": "per-spell"` tells them once each time
the deal goes quiet: when it is worked on and then goes quiet again, they are told again.

```json
"trigger": { "kind": "schedule", "schedule": { "kind": "daily", "time": "08:00" },
  "forEach": { "table": "deals", "once": "per-spell",
    "where": [{ "left": { "field": "last_touch_at" }, "op": "more_than_ago", "right": { "amount": 14, "unit": "days" } }] } }
```

The 14 may be the business's to choose: `"right": { "amount": 14, "unit": "days", "setting":
{ "table": "settings", "column": "nudge_quiet_days" } }` reads it from the app's settings row (the
one with the lowest key) at each tick, and keeps 14 while the setting is empty. A secret or
personal column, or a private table, holds no such number.

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

A manager's summary is the same step with a section that reads further, and only as far as the
manager does:

```json
{ "key": "reps", "table": "deals", "owner": "owner_id", "reach": "team", "by": "owner",
  "where": [{ "left": { "field": "state" }, "op": "is", "right": "open" }],
  "sum": ["weighted_value"],
  "target": { "table": "targets", "owner": "rep_id", "column": "amount", "year": "year", "of": "weighted_value" } }
```

- `"reach": "team"` reads the person's rows and those of the people they lead when it is sent.
  It is never "all rows", whatever their role reads.
- `sum` adds a column up over every row of the section, not the rows listed: `{{sum.reps.weighted_value}}`.
- `"by": "owner"` lists a line a person: `{{row.owner}}`, `{{row.count}}`, `{{row.sum.weighted_value}}`.
- `target` measures the sum against those people's targets, read through the reader's own reach
  of that table: `{{row.target}}`, `{{row.cover}}`, `{{target.reps}}`, `{{cover.reps}}`.

A figure the reader's role cannot answer is left out of their mail, never written as zero, so
give a target and its cover a backup: `{{cover.reps|not set}}`. The mail says when its figures
were read (`{{readAt}}`, or a last line of its own). A person asks for theirs at any time with
`POST /api/v1/me/summaries/{ruleId}/send`, three times an hour: that is what a "Send me a test"
button on an app's own screen calls. What a summary does not do is listed
[in the reference](/reference/manifest/#what-a-summary-does-not-do).

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
notice never carries the text, and somebody who cannot open the record gets it with the table's
name only (never the record's) and no link: a mention is a way to ask a colleague, not a way round
what their role reads. On a comments table,
`{ "mentions": { "about": "deal_id" } }` makes the notice name and open the deal the comment is on.

## Where a notice lands

A notice about a record, and the button of its email, open the dashboard's record page. When the
app has a screen of its own for the record, say so on the staff side and they open that instead:

```json
{ "side": "staff", "kind": "spa", "entry": "index.html",
  "records": { "deals": "/deals/{id}", "quotes": "/quotes/{id}" } }
```

A rule's notice about a deal then lands on `/deals/12` of the staff side for everybody whose role
opens that side (`app:@:staff`), and on the dashboard's page for everybody else. Somebody who is
signed out is sent to sign in and brought back. Each notice of `GET /api/v1/me/notifications`
carries the address in `actionUrl`, and `opens.path` (`/deals/12`) for the app's own bell to go
there in place. A notice about a table with no address is unchanged. The rule itself says nothing
about this: the address belongs to the table, so every notice, mention and search hit about a deal
goes to the same screen. See [Where a record opens](/reference/manifest/#where-a-record-opens).
