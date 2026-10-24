<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Whose a row is; do not edit -->

# Manifest spec: Whose a row is

A role can be held to some rows of a table (see [Whose a row is](https://docs.adminium.dev/guides/apps/whose-a-row-is/)).
Five words say how. They need Adminium 0.3.28.

**A staff column** holds a staff member's id. It is a text column, and the only kind of column
a person is read from:

```json
{ "ref": "owner_id", "type": "text", "maxLength": 36, "nullable": true, "rules": { "staff": true } }
```

**`belongs`**, on a table, lists the ways a person belongs to one of its rows. Any one is enough:

```json
"belongs": [
  { "column": "owner_id", "set": "team" },
  { "through": { "table": "deal_members", "link": "deal_id", "user": "user_id" } },
  { "through": { "table": "covers", "link": "owner_id", "on": "owner_id", "user": "cover_id", "from": "starts_on", "to": "ends_on" } },
  { "via": "company_id" }
]
```

| Way | Fields |
|---|---|
| a column | `column`: a staff column of this table. `set` says whom a writer limited on the table may put there: `self` (the default: only themselves), `team` (somebody in a team they lead) or `anyone`. With `person`, `column` is instead a link to a row of the app, and `person` names the staff column on that row (a ticket's `assignee_id` to an agent's `user_id`). |
| a listing | `through`: `table` lists people against rows; `link` is the listing's column that equals this row's key, or this row's `on` column when it is not the key; `user` is the listing's staff column (or, with `person`, a link to a row that holds one). `from` and `to` are date columns of the listing: the listing counts from the first to the second, by the business's day, and either may be empty. `while` makes a listing row count only while another column of it holds one of some values (`{ "column": "kind", "in": ["helper"] }`) or is empty, or not (`{ "column": "ended_on", "isNull": true }`, for a nullable column): a member row whose end is set lists nobody, from that moment, on every read. Not the `user` or the `link` column. `while` needs Adminium 0.3.28. |
| a parent | `via`: a link of this table. Whoever reaches the row it points at reaches this one. |

A row is reached through at most two links (`via` of a table that is itself reached `via`
another). The listing a way goes through cannot itself be reached through the table it lists
for. Each staff column a way names, and each link a `via` follows, should be first in one of the
table's [`indexes`](https://docs.adminium.dev/reference/manifest/#tables): a limited list is as fast as an unlimited one with the index, and
several times slower without it.

**`private`**, on a table, with a `belongs` of plain staff columns only (no `via`, `through` or
`person`): its rows are read by their own people and by nothing else. No other table's rows are
reached through a private table but by those same people (below), nothing is copied out of it,
no total of its rows is kept elsewhere, and it is not exported, imported, reported on a schedule,
drawn into a document, read by a rule or handed to an owner's code. An update of the app is the
only thing that sets or removes the mark.

**A row hung on a private row, reached by its own people.** Another table may say its rows are
reached through a link to a private table, with `person` naming one of that private table's own
`belongs` columns: exactly the people who already read the private row. A step of a coaching
area is the rep's and the manager's of that area:

```json
{ "ref": "coaching_steps", "belongs": [{ "column": "area_id", "person": "rep_id" }, { "column": "area_id", "person": "manager_id" }], "columns": [ ... ] }
```

Any other staff column of the private row as `person` is refused, as are a `through` listing or a
`via` through it. Such a way is never widened by a team: a `team` reach of the steps reaches,
through the private row, only the rows whose private row names the reader, never one that names
somebody they lead (another manager's one-to-one with her rep stays out). A writer held to some
rows may set the link only to a private row that names them; with several such ways on one link,
any one that names them is enough. Needs Adminium 0.3.35.

**`rows`**, in a role's [`limits`](https://docs.adminium.dev/reference/manifest/#roles) for a table, says which rows its read, update and
delete reach, each on its own:

```json
"limits": { "deals": { "rows": { "read": { "reach": "team", "unowned": true }, "update": { "reach": "own" } } } }
```

`reach` is `own`, `team` or `all`; `unowned: true` adds the rows nobody belongs to; `while`
(`{ "column", "in": [...] }`) holds the reach to rows whose column has one of those values now,
and `all` is written only with a `while`. An action left out reaches every row. The table must
declare `belongs`. A manifest is refused when a role holds a limit on a table of which another
table keeps a stored total (a [`rollup`](https://docs.adminium.dev/reference/manifest/#column-rules)), unless that table is reached `via` the
very link the total adds up by.

`by` narrows a reach of `own` or `team` to the rows a staff column of the table names the person
in (with `team`, somebody they lead). It is for a table reached through a parent, where everybody
on the parent reads every row and each changes only their own:

```json
"limits": { "notes": { "rows": {
  "read":   { "reach": "own" },
  "update": { "reach": "own", "by": "author_id" } } } }
```

A rep reads every note of the deals they reach, and changes the ones `author_id` names them in.
The column must be a staff column (`rules.staff`).

`notBy`, on an update or a delete reach, takes out the rows a staff column names the person in: of
the row itself, or `<link>.<staff column>` of the row one of its foreign keys names. A sales
manager changes her team's targets and never her own, and any starter's goal but her own:

```json
"limits": {
  "targets":       { "rows": { "read": { "reach": "team" }, "update": { "reach": "team", "notBy": "rep_id" } } },
  "starter_goals": { "rows": { "update": { "reach": "all", "notBy": "starter_id.user_id" } } } }
```

It judges the person alone, never the people they lead, and `all` takes it in place of a `while`.
It holds on every door the reach holds on (a change on a page, a bulk edit, a file brought in, a
record's button): a row it leaves out is a row that is not there to them (`404`, and a file's line
is not matched). It also judges the row as a write leaves it: a target made for herself, or a
colleague's moved onto her, is refused (`403` `COLUMN_FORBIDDEN`, reason `not-by`, naming the
column). A record page does not show her the buttons of a row whose own staff column names her,
where every reach of hers says so. Never on a read, a private table, or a grant on an add-on's
table. Needs Adminium 0.3.35 (`rows.notBy`).

**`via`** beside `by` judges a row of a table that hangs off a parent (its `belongs` has
`{ "via": "<link>" }`) by a staff column of THAT parent, and by nothing else: `by` then names a
column of the row the link points at. A sales manager reaches the visits of the deals somebody
she leads owns, and not a visit on another team's deal, even where her rep helps on that deal or
the visit itself names her rep:

```json
"limits": {
  "deals":       { "rows": { "read": { "reach": "team", "by": "owner_id" }, "update": { "reach": "team", "by": "owner_id" } } },
  "site_visits": { "rows": { "read": { "reach": "team", "via": "deal_id", "by": "owner_id" },
                             "update": { "reach": "team", "via": "deal_id", "by": "owner_id" } } } }
```
