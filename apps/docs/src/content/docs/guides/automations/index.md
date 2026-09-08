---
title: Automations
description: Rules that run themselves — what starts one, how to branch and wait, what a step can do, and the one thing about watching a table that everybody needs to know.
---

An **automation rule** is a trigger and a list of steps. Something happens —
a row appears, a clock ticks — and Adminium walks the steps: send an email,
wait two days, check something, take one of two paths.

Open **Automations** in the sidebar. The left column lists your rules; the
right one shows the flow of whichever is selected.

## What starts a rule

A rule has exactly one trigger, and there are two kinds.

### When a record changes

*A record is created / updated / deleted in a table.* This is the common one.
You can narrow it further:

- **Only when this column changes** (updates only) — the rule fires when
  `status` changes, and stays quiet when somebody fixes a typo in the notes.
- **Only when** — a condition on the row itself. A rule that only wants trial
  sign-ups says so here rather than filtering later.

### On a schedule

*Every 5 / 10 / 15 / 30 / 60 minutes*, or *daily / weekly / monthly at a time*
in a timezone you choose. A schedule can also scan a table: **For each record
of `appointments` where `starts_at` is within the next 2 hours** starts one run
per matching row.

**Once per record** is the setting that makes that safe. An appointment ninety
minutes away matches four consecutive fifteen-minute ticks; with "once per
record" on, the reminder goes exactly once. With it off, every tick is its own
run — which is what a rule like "every hour, for each overdue invoice, post to
Slack" actually wants.

## Watching a table

This is the part worth reading twice.

A record trigger normally hears only the writes **Adminium** made — a row
somebody created in the dashboard, or through the API. If your own application
writes directly to the same database, Adminium never sees it.

So a rule can also **watch** the table: once a minute it looks for rows that
appeared since it last checked. The trigger panel tells you exactly which
world you are in:

> *Also watches for rows written outside Adminium · every minute · via
> `created_at`*

or

> *Watching is off: this table has no `created_at`-shaped column or increasing
> key, so only writes made through Adminium trigger this rule*

A table can be watched when it has a creation or update timestamp, or an
increasing integer primary key — that column is how "since last time" is
answered without scanning the whole table. Deleted rows cannot be watched at
all: there is nothing left to find.

**Watching starts from now.** Switching a rule on does not send a welcome
email to every user who ever signed up.

**A row Adminium wrote and the watcher then saw is one run, not two.** Both
sides compute the same identity for the same occurrence, and only the first
one through creates the run.

## Waiting

*Wait / delay* holds the run — minutes, hours or days, up to **30 days**. The
run is not sitting in memory: it is a scheduled job, so a restart costs it
nothing, and Workflow logs shows it as *Waiting · resumes in 4 hours*.

Two things happen when a waiting run wakes up:

- **The record is read again.** A run that waited two days acts on the row as
  it is now, not as it was. A row that has since been deleted ends the run
  *Skipped*, with the reason in the trace.
- **The rule is checked again.** A rule switched off while a run of it was
  waiting does not resume; the run ends *Cancelled*.

## Conditions

A condition compares something to a value. There are two shapes.

**This record** — a column of the row the run is about, with `is`, `is not`,
`contains`, `is greater than`, `is less than`, `is empty`, `is not empty`. On a
date column you also get four relative operators: *within the next*, *within
the last*, *was more than … ago*, *is more than … from now*.

**Related records** — a count of rows in another table:

> Count of `offer_claims` where `user_id` is this record's `id` — is greater
> than 0

That is how a rule asks "did they claim it?" or "has this patient missed an
appointment before?".

Two comparisons behave slightly differently depending on where they run.
`is` matches without regard to letter case everywhere. `is not` compares
exactly when it runs as part of a schedule scan (there is no
case-insensitive "not equal" in the query language) and without regard to case
when it runs against a record in memory. If case matters to you, put the
comparison in a **filter step** rather than in a scan's `where`.

### Filter versus branch

*Only continue if* stops the run when its condition does not match — the run
still ends **successfully**, because the rule did exactly what it was told, and
the later steps show as skipped.

*If / else branch* takes one of two paths. A branch cannot contain another
branch.

## What a step can do

| Step | What it does |
|---|---|
| **Send email** | Renders one of your email templates and sends it. The relay's reply becomes the step's log line. |
| **Send notification** | An in-app notice to everyone with a role, or to chosen people. It respects each person's notification preferences. |
| **Create record** | Adds a row to a table. |
| **Update field** | Writes back to the record the run is about. |
| **Call webhook** | POST or PUT to a URL, with the default JSON payload or your own text. |
| **Slack message** | The same thing, with a `{ text }` body and a `hooks.slack.com` URL. |

### Values and tokens

Anywhere a step takes text — an address, a webhook body, a column value, a
notification title — you can pull from the record:

```
{{record.email}}   {{record.full_name}}   {{now}}   {{ruleName}}   {{recordLabel}}
```

Email templates read the same names, so there is one grammar to learn. A token
Adminium does not recognise is left exactly as you typed it, which is how you
find a mistake.

For a date column you can also pick **Now** instead of typing a value;
Adminium writes the timestamp your database expects.

A column the product masks (an email address, a phone number) can be *read* by
a rule and *sent to*, but never *written* by one.

## Switching a rule on

A rule saves at any stage — a half-built flow is a normal thing to leave
overnight. It only **runs** once every step is finished, and the toggle says
so: *Finish "Send welcome email" before switching this rule on.*

Changes to a flow are saved when you press **Save** (or ⌘S). Leaving the page
with unsaved changes asks first.

## Testing

**Test** runs the rule against the newest row of its table and **executes
nothing**. Emails are rendered but not sent, writes are prepared but not
written, webhooks are guarded but not called — and the flow lights up along
the path the rule would actually take, including which side of a branch it
would choose.

## Undo, loops and the things that could go wrong

- **Undo.** A record you create in the dashboard can be undone for 60 seconds,
  so a rule triggered by one starts a minute late. If you undo inside that
  window, the run is dropped and Workflow logs shows it as *Skipped*.
- **Loops.** A rule's own writes are events too. A rule never re-enters itself,
  and a chain of rules writing into each other's tables stops after three hops
  with a line in the audit log.
- **Imports** do not fire record triggers. A watching rule sees the imported
  rows anyway, on its next tick.
- **Bulk edits** do fire them, once per row.

## Who can use this

**Automations** and **Workflow logs** are behind a single permission,
*Manage automations and their logs*, seeded to Super Admin. A super admin can
grant it to another role on the Roles page.

A rule runs as the system, so it is not limited by the table permissions of
whoever wrote it — which is why the **save** is checked instead: you cannot
save a rule that reads or writes a table you yourself cannot.

See also: [Workflow logs](/guides/automations/workflow-logs/).
