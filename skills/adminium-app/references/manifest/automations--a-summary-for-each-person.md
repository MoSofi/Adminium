<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — A summary for each person; do not edit -->

# Manifest spec: Automations — A summary for each person

### A summary for each person

```json
{ "kind": "digest", "templateKey": "crm-week", "to": { "roles": ["rep", "sales-manager"] },
  "sections": [
    { "key": "open", "table": "deals", "owner": "owner_id",
      "where": [{ "left": { "field": "state" }, "op": "is", "right": "open" }],
      "orderBy": { "column": "expected_close" }, "limit": 20 }
  ] }
```

The step runs in a rule by the clock with no `forEach`. For each person who holds one of the
roles it queues one email, sent at the day and time that person chose (at once for a person who
chose none). When it is sent, each section is read **as that person**: the rows of `table` whose
`owner` staff column names them, that meet `where`, among the rows their roles reach and with the
columns their roles show. A manager who reads every deal still gets a summary of their own; a
person who lost the role between the run and the send gets none; a person with nothing in any
section gets no email unless `"sendEmpty": true`. A summary that is waiting for its hour is not sent
once its rule is switched off or deleted, or its part is off. `{{count.<section>}}` is how many rows
there are, also when the section lists fewer.

The template draws each section with a rows block that names it, `{ "block": "email.rows",
"data": { "section": "open", "row": { "title": "{{row.name}}" }, "empty": "…" } }`, and may read
`{{name}}`, `{{appName}}`, `{{ruleName}}`, `{{readAt}}` and `{{count.<section>}}`. Up to 6 sections
of up to 50 rows. The validator refuses a section whose `owner` is not a staff column, a section no
rows block draws, and a rows block that names no section.

#### A section of a team, with sums, a line a person and target cover

Four more words on a section, each read from Adminium 0.3.28 (and `within`, below, from 0.3.35):

```json
{ "key": "reps", "table": "deals", "owner": "owner_id",
  "reach": "team",
  "where": [{ "left": { "field": "state" }, "op": "is", "right": "open" }],
  "sum": ["amount", "weighted_value"],
  "by": "owner",
  "target": { "table": "targets", "owner": "rep_id", "column": "amount", "year": "year", "of": "weighted_value" } }
```

| Key | What it does |
|---|---|
| `"reach": "team"` | The rows whose `owner` is the person **or somebody they lead when the summary is sent** (the other members of every team they lead). Default `"own"`. There is no `"all"`: somebody whose role reads every row still gets their own, or their team's. Somebody who leads nobody gets their own. |
| `"sum": [columns]` | Up to 4 number columns, each added up by the database over **every** row of the section, not over the rows it lists: `{{sum.<section>.<column>}}`, written as money where the column is money and as a number otherwise. A section with no row sums to 0. |
| `"by": "owner"` | The section lists one line a person instead of one a row, by name: `{{row.owner}}` (their name in Adminium), `{{row.count}}`, `{{row.sum.<column>}}`, and with a `target`, `{{row.target}}` and `{{row.cover}}`. Such a section has no `orderBy`; `limit` is the most lines. |
| `"target"` | What the sum `of` is measured against: `column` of the rows of `table` whose `owner` staff column names the same people. `year`, a whole-number column, keeps only the rows of the calendar year the business is in. Fills `{{target.<section>}}` and `{{cover.<section>}}` (the sum as a share of the target, a whole percentage), and each line's own. |

#### A section of this year, or of the last days

`"within"` holds a section to the rows whose date column falls in the **current calendar year**, or
in the **last N days**, on the business's calendar (the connection's time zone), from Adminium 0.3.35:

```json
{ "key": "won", "table": "deals", "owner": "owner_id",
  "where": [{ "left": { "field": "state" }, "op": "is", "right": "won" }],
  "within": { "column": "closed_on", "this": "year" }, "sum": ["amount"] }
```

| Form | The rows it keeps |
|---|---|
| `{ "column": <col>, "this": "year" }` | From the business's midnight on 1 January of the year it is in when the rule runs, to the next 1 January. A summary made at 01:00 on 1 January in Auckland counts the new year, whatever the server's clock says. |
| `{ "column": <col>, "lastDays": N }` | Today and the N − 1 days before it, each a whole day on the business's calendar (1 to 366). `"lastDays": 7` made on a Monday is that Monday and the six days before it. |

The column is a `date` or a `timestamptz` of the section's table; a date is compared with the
business's days, a moment with the instants its midnights begin. Like every condition of a section,
it is counted from when the rule ran (a summary held for its reader's hour counts the same days),
and its rows, counts and sums are the reader's own reach. The validator refuses a column that is
not a date, and any other form.

**Everything is the reader's own reach or nothing.** Each figure is read through the same row limit
and the same columns as a list the person opens: a sum is never of a row they could not open, a
line never names somebody whose rows they do not reach, and a target is read through their reach
of the targets' table (their own for a rep, their team's for a manager whose role reads the
team's). A figure that cannot be answered for a person is **left out, never written as zero**:

- a column their role does not show is not added up, and nothing is measured by it;
- a section that chooses or sorts rows by a column their role does not show lists nothing and
  counts nothing;
- rows in more than one currency (a `currency` column) have no single sum;
- a person with no target they reach has no `{{row.target}}` and no `{{row.cover}}`, and the
  section has no `{{cover.<section>}}` while anybody whose rows are in its sum has none.

So a template writes `{{target.<section>}}` and `{{cover.<section>}}` with a backup
(`{{cover.reps|not set}}`) or in a block tied to them with `showWhen`: the validator refuses them
bare. It also refuses a sum of a column that is not a number, a `target.of` that is not one of
the section's sums, a `target.owner` that is not a staff column, and a line of a `"by": "owner"`
section that reads a column of a row.

#### When the figures were read, and "send me mine now"

A summary may wait hours for the end of its reader's quiet hours. Every summary therefore says the
moment its figures were read, in the reader's language and on the business's clock: where the
template writes `{{readAt}}`, or as a last line ("Figures read on …") when it does not.

A signed-in person asks for their own summary with `POST /api/v1/me/summaries/{ruleId}/send`
(`GET /api/v1/me/summaries` lists the rules that make them one). It takes no body: the rule's own
sections, read as that person at that moment, sent to their own address, also when nothing is in
any section and also while the rule is switched off. Three an hour for each person and rule. A
rule that is not there and a rule that writes to roles the person does not hold answer the same
`404`.

#### What a summary does not do
