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
`person`): its rows are read by their own people and by nothing else. Nothing may be reached
through a private table, no total of its rows is kept elsewhere, and it is not exported,
imported, reported on a schedule, drawn into a document, read by a rule or handed to an owner's
code. An update of the app is the only thing that sets or removes the mark.

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

An action may name **several reaches**, as a list of one to four: any one of them is enough, and
each is its own whole test (its `while`, `unowned` and `by` hold for it alone), as two roles'
reaches are. An account manager reads every won deal, and an open one only while he is listed on
it:

```json
"limits": { "deals": { "rows": { "read": [
  { "reach": "all", "while": { "column": "state", "in": ["won"] } },
  { "reach": "own" } ] } } }
```

No reach of the list is written twice, and the checks above hold for each. A private table's
reach stays `{ "reach": "own" }` alone. A list needs Adminium 0.3.28.

A row of a table reached through its parent (`via`) is hung, by a writer held to some rows of it,
only under a parent their reach of THAT table reaches: a parent that is theirs (or somebody's
they lead, with `team`), or nobody's when the reach takes `unowned` rows. Reading the parent is
not enough: the account manager above reads every won deal and comments only on a deal he is on
(403, reason `parent-not-theirs`). A row a staff column of its own names them in (a stamp of
its maker, say) is theirs whatever its parent; a table that also lists people `through`, or reads
a person from a linked row, is not judged this way.

Apart from any limit, **the columns that decide whose a row is** (the staff columns the table's
own `belongs` names) are changed only by somebody the stored row names in one of them, or who
leads that person where the role's reach is `team`. Somebody who reaches the row another way (a
helper listed on it, a cover, the owner of its parent) works on the row and cannot give it away
or take it. A record's `handOver` button frees whom the row may go to, not who may hand it over.

Where such a column is kept as a copy of the row's parent (`copy` with `mode: "always"`), the
person is decided by the link: a writer held to some rows sets that link only to a parent that
names them there (or somebody they lead, with `set: "team"`), and is refused 403 with reason
`parent-not-theirs` otherwise. And the person column of a table that another table's `belongs`
reads `through` takes only somebody who reads at least one of those tables (422, the field
marked `cannot-open`), whoever writes. See
[Whose a row is](https://docs.adminium.dev/guides/apps/whose-a-row-is/).

**`handOver`**, on one of a table's [`states.actions`](https://docs.adminium.dev/reference/manifest/#states), marks the one write in which a
person limited to their own rows may name a colleague: the button asks for a staff column and
sets it to anybody.

```json
{ "id": "hand-over", "label": { "en-US": "Hand over" }, "set": {}, "in": ["open"], "ask": ["owner_id"], "handOver": true }
```

Anybody, that is, who can work the row: an active person whose roles read and change the table,
with a reach that holds the row in the state it is in (an account manager who reaches a deal
once it is won is not given an open one). Anyone else is refused 422, the field marked
`cannot-open`. A writer held to some rows who names somebody by a plain change, in a column
whose `belongs` way says `set: "anyone"`, is held to the same: the button is not the only door
to the column.
